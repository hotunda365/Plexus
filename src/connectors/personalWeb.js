const path = require("path");
const qrcode = require("qrcode-terminal");
const QRCode = require("qrcode");
const { Client, LocalAuth } = require("whatsapp-web.js");
const { prisma } = require("../db");

function toDateTime(ts) {
  return ts ? new Date(ts * 1000) : null;
}

function parsePersonalMessage(msg) {
  const fromId = msg.from || null;
  const toId = msg.to || null;
  const chatId = msg.fromMe ? toId : fromId;
  const groupId = chatId && chatId.endsWith("@g.us") ? chatId : null;
  const vCards = Array.isArray(msg.vCards) ? msg.vCards : [];
  const mediaMimeType = msg._data?.mimetype || null;

  return {
    externalMessageId: msg.id?._serialized || null,
    chatId,
    fromNumber: fromId,
    toNumber: toId,
    senderName: msg.notifyName || msg._data?.notifyName || msg._data?.pushname || null,
    text: msg.body || null,
    messageType: msg.type || "unknown",
    isGroup: Boolean(groupId),
    groupId,
    groupName: null,
    mediaType: msg.hasMedia ? (msg.type || "media") : null,
    mediaMimeType,
    mediaId: msg.id?._serialized || null,
    mediaSha256: msg._data?.filehash || null,
    mediaCaption: msg.body || null,
    contactName: vCards[0]?.fn || null,
    contactPhone: null,
    contacts: vCards.length > 0 ? vCards : null,
    payload: {
      id: msg.id?._serialized || null,
      from: msg.from,
      to: msg.to,
      author: msg.author || null,
      body: msg.body,
      type: msg.type,
      timestamp: msg.timestamp,
      fromMe: msg.fromMe,
      hasMedia: msg.hasMedia,
      notifyName: msg.notifyName || null,
      data: msg._data || null,
      vCards
    },
    sentAt: toDateTime(msg.timestamp)
  };
}

async function upsertPersonalAccountInfo({ accountId, phoneNumber = null, displayName = null, metadata = null }) {
  await prisma.accountInfo.upsert({
    where: { accountId },
    update: {
      connector: "personal",
      displayName: displayName || null,
      phoneNumber: phoneNumber || null,
      metadata: metadata || null
    },
    create: {
      accountId,
      connector: "personal",
      displayName: displayName || null,
      phoneNumber: phoneNumber || null,
      metadata: metadata || null
    }
  });
}

function createPersonalConnector(config) {
  const accountId = config.accountId;
  const sessionDir = config.sessionDir || ".wwebjs_auth";

  let initialized = false;
  let latestQr = null;
  let latestQrCreatedAt = null;

  const client = new Client({
    authStrategy: new LocalAuth({
      dataPath: path.resolve(process.cwd(), sessionDir)
    }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    }
  });

  client.on("qr", (qr) => {
    latestQrCreatedAt = new Date();
    QRCode.toDataURL(qr)
      .then((dataUrl) => {
        latestQr = dataUrl;
      })
      .catch(() => {
        latestQr = null;
      });
    qrcode.generate(qr, { small: true });
  });

  client.on("ready", async () => {
    initialized = true;
    latestQr = null;
    latestQrCreatedAt = null;

    const selfPhone = client.info?.wid?.user || null;
    await upsertPersonalAccountInfo({
      accountId,
      phoneNumber: selfPhone,
      displayName: client.info?.pushname || null,
      metadata: {
        sessionDir,
        wid: client.info?.wid || null
      }
    });

    await prisma.eventLog.create({
      data: {
        accountId,
        platform: "whatsapp_personal",
        direction: "system",
        eventType: "ready",
        payload: { message: "Personal connector is ready" }
      }
    });
  });

  client.on("message", async (msg) => {
    const details = parsePersonalMessage(msg);

    await prisma.message.create({
      data: {
        accountId,
        platform: "whatsapp_personal",
        direction: "inbound",
        externalMessageId: details.externalMessageId,
        chatId: details.chatId,
        fromNumber: details.fromNumber,
        toNumber: details.toNumber,
        senderName: details.senderName,
        accountPhone: client.info?.wid?.user || null,
        text: details.text,
        messageType: details.messageType,
        isGroup: details.isGroup,
        groupId: details.groupId,
        groupName: details.groupName,
        mediaType: details.mediaType,
        mediaMimeType: details.mediaMimeType,
        mediaId: details.mediaId,
        mediaSha256: details.mediaSha256,
        mediaCaption: details.mediaCaption,
        contactName: details.contactName,
        contactPhone: details.contactPhone,
        contacts: details.contacts,
        payload: details.payload,
        sentAt: details.sentAt
      }
    });
  });

  client.on("message_create", async (msg) => {
    if (!msg.fromMe) {
      return;
    }

    const details = parsePersonalMessage(msg);

    await prisma.message.create({
      data: {
        accountId,
        platform: "whatsapp_personal",
        direction: "outbound",
        externalMessageId: details.externalMessageId,
        chatId: details.chatId,
        fromNumber: details.fromNumber,
        toNumber: details.toNumber,
        senderName: details.senderName,
        accountPhone: client.info?.wid?.user || null,
        text: details.text,
        messageType: details.messageType,
        isGroup: details.isGroup,
        groupId: details.groupId,
        groupName: details.groupName,
        mediaType: details.mediaType,
        mediaMimeType: details.mediaMimeType,
        mediaId: details.mediaId,
        mediaSha256: details.mediaSha256,
        mediaCaption: details.mediaCaption,
        contactName: details.contactName,
        contactPhone: details.contactPhone,
        contacts: details.contacts,
        payload: details.payload,
        sentAt: details.sentAt
      }
    });
  });

  function isReady() {
    return initialized;
  }

  function getQrStatus() {
    return {
      accountId,
      ready: initialized,
      hasQr: Boolean(latestQr),
      qrDataUrl: latestQr,
      qrCreatedAt: latestQrCreatedAt
    };
  }

  async function init() {
    await client.initialize();
  }

  async function sendMessage({ to, text }) {
    if (!initialized) {
      throw new Error("Personal WhatsApp connector is not ready. Scan QR first.");
    }

    const chatId = to.includes("@") ? to : `${to}@c.us`;
    const result = await client.sendMessage(chatId, text);

    return {
      id: result.id?._serialized || null,
      to: chatId,
      body: result.body,
      timestamp: result.timestamp
    };
  }

  async function destroy() {
    initialized = false;
    latestQr = null;
    latestQrCreatedAt = null;

    try {
      await client.destroy();
    } catch (_error) {
      // Ignore teardown errors so account deletion can continue.
    }
  }

  return {
    accountId,
    name: "personal",
    sessionDir,
    isReady,
    getQrStatus,
    init,
    sendMessage,
    destroy
  };
}

module.exports = { createPersonalConnector };
