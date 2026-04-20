const path = require("path");
const qrcode = require("qrcode-terminal");
const QRCode = require("qrcode");
const { Client, LocalAuth } = require("whatsapp-web.js");
const { prisma } = require("../db");

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
    await prisma.message.create({
      data: {
        accountId,
        platform: "whatsapp_personal",
        direction: "inbound",
        externalMessageId: msg.id?._serialized || null,
        chatId: msg.from,
        fromNumber: msg.from,
        toNumber: msg.to || null,
        text: msg.body || null,
        messageType: msg.type || "unknown",
        payload: {
          from: msg.from,
          to: msg.to,
          body: msg.body,
          type: msg.type,
          timestamp: msg.timestamp
        },
        sentAt: msg.timestamp ? new Date(msg.timestamp * 1000) : null
      }
    });
  });

  client.on("message_create", async (msg) => {
    if (!msg.fromMe) {
      return;
    }

    await prisma.message.create({
      data: {
        accountId,
        platform: "whatsapp_personal",
        direction: "outbound",
        externalMessageId: msg.id?._serialized || null,
        chatId: msg.to,
        fromNumber: msg.from || null,
        toNumber: msg.to || null,
        text: msg.body || null,
        messageType: msg.type || "unknown",
        payload: {
          from: msg.from,
          to: msg.to,
          body: msg.body,
          type: msg.type,
          timestamp: msg.timestamp
        },
        sentAt: msg.timestamp ? new Date(msg.timestamp * 1000) : null
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
