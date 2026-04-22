import express from 'express';
import { handleWhatsAppWebhook } from './whatsappWebhook';

const app = express();
app.use(express.json());

// 設定 Webhook 路徑
app.all('/webhook', handleWhatsAppWebhook);

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, service: 'plexusai' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Plexus AI 正在 ${PORT} 端口運行`);
});
