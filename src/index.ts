import express from 'express';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { handleWhatsAppWebhook } from './whatsappWebhook';

const app = express();
app.use(express.json());

const frontendDistPath = resolve(__dirname, '../frontend/dist');
const frontendIndexPath = resolve(frontendDistPath, 'index.html');
const hasFrontendBuild = existsSync(frontendIndexPath);

// 設定 Webhook 路徑
app.all('/webhook', handleWhatsAppWebhook);

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, service: 'plexusai' });
});

if (hasFrontendBuild) {
  app.use(express.static(frontendDistPath));

  app.get('/', (_req, res) => {
    res.sendFile(frontendIndexPath);
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Plexus AI 正在 ${PORT} 端口運行`);
  if (!hasFrontendBuild) {
    console.log('frontend/dist 未找到，目前只提供 API 路由。');
  }
});
