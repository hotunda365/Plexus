require("dotenv").config();

const path = require("path");
const express = require("express");
const { prisma } = require("./db");
const { createCloudApiConnector } = require("./connectors/cloudApi");
const { createPersonalConnector } = require("./connectors/personalWeb");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.resolve(__dirname, "../public")));

const port = Number(process.env.PORT || 3000);
const mode = process.env.CONNECTOR_MODE || "both";
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
const DEFAULT_CLOUD_ACCOUNT_ID = "cloud-default";
const DEFAULT_PERSONAL_ACCOUNT_ID = "personal-default";

const cloudConnectors = new Map();
const personalConnectors = new Map();

function safeParseArrayEnv(value) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function loadCloudConfigs() {
  const multi = safeParseArrayEnv(process.env.WA_CLOUD_ACCOUNTS_JSON);
  if (multi.length > 0) {
    return [{
      accountId: DEFAULT_CLOUD_ACCOUNT_ID,
      phoneNumberId: multi[0].phoneNumberId,
      accessToken: multi[0].accessToken,
      verifyToken: multi[0].verifyToken
    }];
  }

  if (
    process.env.WA_CLOUD_PHONE_NUMBER_ID &&
    process.env.WA_CLOUD_ACCESS_TOKEN &&
    process.env.WA_CLOUD_VERIFY_TOKEN
  ) {
    return [{
      accountId: DEFAULT_CLOUD_ACCOUNT_ID,
      phoneNumberId: process.env.WA_CLOUD_PHONE_NUMBER_ID,
      accessToken: process.env.WA_CLOUD_ACCESS_TOKEN,
      verifyToken: process.env.WA_CLOUD_VERIFY_TOKEN
    }];
  }

  return [];
}

function loadPersonalConfigs() {
  const multi = safeParseArrayEnv(process.env.WA_PERSONAL_ACCOUNTS_JSON);
  if (multi.length > 0) {
    return [{
      accountId: DEFAULT_PERSONAL_ACCOUNT_ID,
      sessionDir: multi[0].sessionDir
    }];
  }

  if (process.env.WA_PERSONAL_SESSION_DIR) {
    return [{
      accountId: DEFAULT_PERSONAL_ACCOUNT_ID,
      sessionDir: process.env.WA_PERSONAL_SESSION_DIR
    }];
  }

  return [];
}

function registerCloudConnector(config) {
  const accountId = String(config.accountId || DEFAULT_CLOUD_ACCOUNT_ID).trim();
  if (!accountId) {
    throw new Error("cloud accountId is required");
  }

  const connector = createCloudApiConnector({
    accountId,
    phoneNumberId: config.phoneNumberId,
    accessToken: config.accessToken,
    verifyToken: config.verifyToken
  });

  cloudConnectors.clear();
  cloudConnectors.set(accountId, connector);
  return connector;
}

function registerPersonalConnector(config) {
  const accountId = String(config.accountId || DEFAULT_PERSONAL_ACCOUNT_ID).trim();
  if (!accountId) {
    throw new Error("personal accountId is required");
  }

  for (const existing of personalConnectors.values()) {
    if (existing.accountId !== accountId) {
      existing.destroy?.().catch(() => {
        // Ignore teardown errors when replacing the single connector.
      });
    }
  }

  const connector = createPersonalConnector({
    accountId,
    sessionDir: config.sessionDir
  });

  personalConnectors.clear();
  personalConnectors.set(accountId, connector);
  return connector;
}

function bootstrapConnectorMaps() {
  for (const cfg of loadCloudConfigs()) {
    try {
      registerCloudConnector(cfg);
    } catch (error) {
      console.error("Invalid cloud connector config", error.message);
    }
  }

  for (const cfg of loadPersonalConfigs()) {
    try {
      registerPersonalConnector(cfg);
    } catch (error) {
      console.error("Invalid personal connector config", error.message);
    }
  }
}

function maskToken(token) {
  if (!token) {
    return "";
  }
  if (token.length <= 8) {
    return "********";
  }
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function firstConnector(map) {
  const values = [...map.values()];
  return values.length > 0 ? values[0] : null;
}

function getCloudConnector(accountId) {
  if (accountId && cloudConnectors.has(accountId)) {
    return cloudConnectors.get(accountId);
  }
  return firstConnector(cloudConnectors);
}

function getPersonalConnector(accountId) {
  if (accountId && personalConnectors.has(accountId)) {
    return personalConnectors.get(accountId);
  }
  return firstConnector(personalConnectors);
}

async function upsertAccountInfo({ accountId, connector, displayName = null, phoneNumber = null, phoneNumberId = null, metadata = null }) {
  await prisma.accountInfo.upsert({
    where: { accountId },
    update: {
      connector,
      displayName: displayName || null,
      phoneNumber: phoneNumber || null,
      phoneNumberId: phoneNumberId || null,
      metadata: metadata || null
    },
    create: {
      accountId,
      connector,
      displayName: displayName || null,
      phoneNumber: phoneNumber || null,
      phoneNumberId: phoneNumberId || null,
      metadata: metadata || null
    }
  });
}

app.get("/health", async (_req, res) => {
  const totalMessages = await prisma.message.count();
  res.json({
    ok: true,
    mode,
    connectors: {
      cloudCount: cloudConnectors.size,
      personalCount: personalConnectors.size,
      cloudReady: [...cloudConnectors.values()].filter((item) => item.isReady()).length,
      personalReady: [...personalConnectors.values()].filter((item) => item.isReady()).length
    },
    stats: {
      totalMessages
    }
  });
});

app.get("/accounts", async (_req, res) => {
  const infoRows = await prisma.accountInfo.findMany();
  const infoMap = new Map(infoRows.map((row) => [row.accountId, row]));

  const cloud = [...cloudConnectors.values()].map((item) => ({
    accountId: item.accountId,
    connector: "cloud",
    ready: item.isReady(),
    phoneNumber: infoMap.get(item.accountId)?.phoneNumber || null,
    phoneNumberId: infoMap.get(item.accountId)?.phoneNumberId || null,
    displayName: infoMap.get(item.accountId)?.displayName || null
  }));

  const personal = [...personalConnectors.values()].map((item) => {
    const qr = item.getQrStatus();
    return {
      accountId: item.accountId,
      connector: "personal",
      ready: item.isReady(),
      hasQr: qr.hasQr,
      qrCreatedAt: qr.qrCreatedAt,
      phoneNumber: infoMap.get(item.accountId)?.phoneNumber || null,
      phoneNumberId: infoMap.get(item.accountId)?.phoneNumberId || null,
      displayName: infoMap.get(item.accountId)?.displayName || null
    };
  });

  res.json([...cloud, ...personal]);
});

app.get("/accounts/personal/:accountId/qr", (req, res) => {
  const connector = getPersonalConnector(req.params.accountId);
  if (!connector || connector.accountId !== req.params.accountId) {
    return res.status(404).json({ error: "Personal account not found" });
  }

  return res.json(connector.getQrStatus());
});

app.delete("/accounts/:accountId", async (req, res) => {
  const accountId = String(req.params.accountId || "").trim();
  if (!accountId) {
    return res.status(400).json({ error: "accountId is required" });
  }

  const cloudConnector = cloudConnectors.get(accountId);
  if (cloudConnector) {
    cloudConnectors.delete(accountId);
    await prisma.cloudAccountConfig.deleteMany({ where: { accountId } });
    await prisma.accountInfo.deleteMany({ where: { accountId } });
    return res.json({ ok: true, accountId, connector: "cloud", deleted: true });
  }

  const personalConnector = personalConnectors.get(accountId);
  if (personalConnector) {
    try {
      await personalConnector.destroy?.();
    } finally {
      personalConnectors.delete(accountId);
    }
    await prisma.accountInfo.deleteMany({ where: { accountId } });
    return res.json({ ok: true, accountId, connector: "personal", deleted: true });
  }

  return res.status(404).json({ error: "Account not found" });
});

app.get("/settings/cloud-accounts", async (_req, res) => {
  const config = await prisma.cloudAccountConfig.findFirst({
    where: { accountId: DEFAULT_CLOUD_ACCOUNT_ID }
  });

  const data = config ? [{
    accountId: config.accountId,
    displayName: config.displayName,
    phoneNumberId: config.phoneNumberId,
    accessTokenMasked: maskToken(config.accessToken),
    verifyTokenMasked: maskToken(config.verifyToken),
    ready: cloudConnectors.get(config.accountId)?.isReady() || false,
    webhookUrl: `${baseUrl}/webhook/whatsapp/${config.accountId}`,
    updatedAt: config.updatedAt
  }] : [];

  res.json(data);
});

app.post("/settings/cloud-accounts", async (req, res) => {
  const {
    displayName,
    phoneNumberId,
    accessToken,
    verifyToken
  } = req.body || {};

  const accountId = DEFAULT_CLOUD_ACCOUNT_ID;

  if (!phoneNumberId || !accessToken || !verifyToken) {
    return res.status(400).json({
      error: "phoneNumberId, accessToken, verifyToken are required"
    });
  }

  await prisma.cloudAccountConfig.deleteMany({
    where: { accountId: { not: accountId } }
  });

  await prisma.cloudAccountConfig.upsert({
    where: { accountId },
    update: {
      displayName: displayName || null,
      phoneNumberId,
      accessToken,
      verifyToken
    },
    create: {
      accountId,
      displayName: displayName || null,
      phoneNumberId,
      accessToken,
      verifyToken
    }
  });

  const connector = registerCloudConnector({
    accountId,
    phoneNumberId,
    accessToken,
    verifyToken
  });

  await upsertAccountInfo({
    accountId,
    connector: "cloud",
    displayName: displayName || null,
    phoneNumberId,
    metadata: { source: "settings-cloud-accounts" }
  });

  return res.status(201).json({
    accountId: connector.accountId,
    ready: connector.isReady(),
    webhookUrl: `${baseUrl}/webhook/whatsapp/${connector.accountId}`
  });
});

app.get("/webhook/whatsapp/:accountId", (req, res) => {
  const connector = getCloudConnector(req.params.accountId);
  if (!connector) {
    return res.status(404).json({ error: "Cloud account not found" });
  }
  return connector.verifyWebhook(req, res);
});

app.post("/webhook/whatsapp/:accountId", (req, res) => {
  const connector = getCloudConnector(req.params.accountId);
  if (!connector) {
    return res.status(404).json({ error: "Cloud account not found" });
  }
  return connector.handleWebhook(req, res);
});

app.get("/webhook/whatsapp", (req, res) => {
  const connector = getCloudConnector();
  if (!connector) {
    return res.status(404).json({ error: "No cloud account configured" });
  }
  return connector.verifyWebhook(req, res);
});

app.post("/webhook/whatsapp", (req, res) => {
  const connector = getCloudConnector();
  if (!connector) {
    return res.status(404).json({ error: "No cloud account configured" });
  }
  return connector.handleWebhook(req, res);
});

app.post("/messages/send", async (req, res) => {
  try {
    const { accountId, connector, to, text } = req.body || {};

    if (!connector || !to || !text) {
      return res.status(400).json({ error: "connector, to, text are required" });
    }

    if (connector === "cloud") {
      const target = getCloudConnector(accountId);
      if (!target) {
        return res.status(404).json({ error: "Cloud account not found" });
      }
      const response = await target.sendMessage({ to, text });
      return res.json({ connector, accountId: target.accountId, response });
    }

    if (connector === "personal") {
      const target = getPersonalConnector(accountId);
      if (!target) {
        return res.status(404).json({ error: "Personal account not found" });
      }
      const response = await target.sendMessage({ to, text });
      return res.json({ connector, accountId: target.accountId, response });
    }

    return res.status(400).json({ error: "Unknown connector" });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/messages", async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 100), 500);
  const accountId = req.query.accountId ? String(req.query.accountId) : undefined;
  const where = accountId ? { accountId } : undefined;
  const messages = await prisma.message.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit
  });
  res.json(messages);
});

app.get("/events", async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 100), 500);
  const accountId = req.query.accountId ? String(req.query.accountId) : undefined;
  const where = accountId ? { accountId } : undefined;
  const events = await prisma.eventLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit
  });
  res.json(events);
});

async function bootstrap() {
  bootstrapConnectorMaps();

  const savedCloudAccount = await prisma.cloudAccountConfig.findFirst({
    where: { accountId: DEFAULT_CLOUD_ACCOUNT_ID }
  });

  if (savedCloudAccount) {
    try {
      registerCloudConnector(savedCloudAccount);
      await upsertAccountInfo({
        accountId: savedCloudAccount.accountId,
        connector: "cloud",
        displayName: savedCloudAccount.displayName || null,
        phoneNumberId: savedCloudAccount.phoneNumberId,
        metadata: { source: "bootstrap-cloud-config" }
      });
    } catch (error) {
      console.error(`Failed to restore cloud connector ${savedCloudAccount.accountId}`, error);
    }
  }

  if (mode === "personal" || mode === "both") {
    for (const connector of personalConnectors.values()) {
      connector.init().catch((err) => {
        console.error(`Failed to initialize personal connector ${connector.accountId}`, err);
      });
    }
  }

  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

bootstrap();
