const axios = require("axios");
const { prisma } = require("../db");

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
        const messages = value.messages || [];

        for (const msg of messages) {
          const fromNumber = msg.from || null;
          const toNumber = value.metadata?.display_phone_number || null;
          const messageType = msg.type || "unknown";
          const text = msg.text?.body || null;

          await prisma.message.create({
            data: {
              accountId,
              platform: "whatsapp_cloud",
              direction: "inbound",
              externalMessageId: msg.id || null,
              chatId: fromNumber,
              fromNumber,
              toNumber,
              text,
              messageType,
              payload: msg,
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

    await prisma.message.create({
      data: {
        accountId,
        platform: "whatsapp_cloud",
        direction: "outbound",
        externalMessageId,
        chatId: to,
        toNumber: to,
        text,
        messageType: "text",
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
