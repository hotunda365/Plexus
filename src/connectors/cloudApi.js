const axios = require("axios");
const { prisma } = require("../db");

function extractCloudMessageDetails(msg = {}, value = {}) {
  const metadata = value.metadata || {};
  const accountPhone = metadata.display_phone_number || null;
  const accountPhoneId = metadata.phone_number_id || null;

  const messageType = msg.type || "unknown";
  const text = msg.text?.body || null;
  const image = msg.image || null;
  const video = msg.video || null;
  const audio = msg.audio || null;
  const document = msg.document || null;
  const sticker = msg.sticker || null;
  const contacts = Array.isArray(msg.contacts) ? msg.contacts : [];
  const firstContact = contacts[0] || null;
  const firstContactPhone = firstContact?.phones?.[0]?.wa_id || firstContact?.phones?.[0]?.phone || null;

  const mediaNode = image || video || audio || document || sticker;

  return {
    messageType,
    text,
    senderName: firstContact?.profile?.name || null,
    accountPhone,
    accountPhoneId,
    isGroup: Boolean(msg.context?.group_id),
    groupId: msg.context?.group_id || null,
    groupName: null,
    mediaType: mediaNode ? messageType : null,
    mediaMimeType: mediaNode?.mime_type || null,
    mediaId: mediaNode?.id || null,
    mediaSha256: mediaNode?.sha256 || null,
    mediaCaption: image?.caption || video?.caption || document?.caption || null,
    contactName: firstContact?.name?.formatted_name || firstContact?.profile?.name || null,
    contactPhone: firstContactPhone,
    contacts: contacts.length > 0 ? contacts : null
  };
}

async function upsertCloudAccountInfo({ accountId, displayName = null, phoneNumber = null, phoneNumberId = null, metadata = null }) {
  await prisma.accountInfo.upsert({
    where: { accountId },
    update: {
      connector: "cloud",
      displayName: displayName || null,
      phoneNumber: phoneNumber || null,
      phoneNumberId: phoneNumberId || null,
      metadata: metadata || null
    },
    create: {
      accountId,
      connector: "cloud",
      displayName: displayName || null,
      phoneNumber: phoneNumber || null,
      phoneNumberId: phoneNumberId || null,
      metadata: metadata || null
    }
  });
}

function createCloudApiConnector(config) {
  const {
    accountId,
    phoneNumberId,
    accessToken,
    verifyToken
  } = config;

  function isReady() {
    return Boolean(phoneNumberId && accessToken && verifyToken);
  }

  async function verifyWebhook(req, res) {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === verifyToken) {
      return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
  }

  async function handleWebhook(req, res) {
    const payload = req.body;

    await prisma.eventLog.create({
      data: {
        accountId,
        platform: "whatsapp_cloud",
        direction: "inbound",
        eventType: "webhook",
        payload
      }
    });

    const entries = payload.entry || [];

    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        const value = change.value || {};
        await upsertCloudAccountInfo({
          accountId,
          phoneNumber: value.metadata?.display_phone_number || null,
          phoneNumberId: value.metadata?.phone_number_id || phoneNumberId || null,
          metadata: { source: "webhook" }
        });

        const messages = value.messages || [];

        for (const msg of messages) {
          const fromNumber = msg.from || null;
          const details = extractCloudMessageDetails(msg, value);

          await prisma.message.create({
            data: {
              accountId,
              platform: "whatsapp_cloud",
              direction: "inbound",
              externalMessageId: msg.id || null,
              chatId: fromNumber,
              fromNumber,
              toNumber: details.accountPhone,
              senderName: details.senderName,
              accountPhone: details.accountPhone,
              accountPhoneId: details.accountPhoneId,
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
              payload: {
                message: msg,
                metadata: value.metadata || null,
                contacts: value.contacts || null,
                statuses: value.statuses || null
              },
              sentAt: msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : null
            }
          });
        }
      }
    }

    return res.sendStatus(200);
  }

  async function sendMessage({ to, text }) {
    if (!isReady()) {
      throw new Error("Cloud API connector is not configured.");
    }

    const url = `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`;
    const requestPayload = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text }
    };

    const response = await axios.post(url, requestPayload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      }
    });

    const externalMessageId = response.data?.messages?.[0]?.id || null;

    await upsertCloudAccountInfo({
      accountId,
      phoneNumberId,
      metadata: { source: "outbound-send" }
    });

    await prisma.message.create({
      data: {
        accountId,
        platform: "whatsapp_cloud",
        direction: "outbound",
        externalMessageId,
        chatId: to,
        toNumber: to,
        accountPhoneId: phoneNumberId || null,
        text,
        messageType: "text",
        mediaType: null,
        payload: response.data,
        sentAt: new Date()
      }
    });

    return response.data;
  }

  return {
    accountId,
    phoneNumberId,
    name: "cloud",
    isReady,
    verifyWebhook,
    handleWebhook,
    sendMessage
  };
}

module.exports = { createCloudApiConnector };
