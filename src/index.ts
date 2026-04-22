import express from 'express';
import { handleWhatsAppWebhook } from './whatsappWebhook';

const app = express();
app.use(express.json());

app.get('/', (_req, res) => {
  res.status(200).type('html').send(`<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Plexus AI</title>
    <style>
      body { font-family: "Segoe UI", "Noto Sans TC", sans-serif; margin: 0; background: #f4f7fb; color: #1f2937; }
      .wrap { max-width: 760px; margin: 48px auto; padding: 0 16px; }
      .card { background: #fff; border: 1px solid #dbe3ee; border-radius: 14px; padding: 24px; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06); }
      h1 { margin: 0 0 8px; }
      p { margin: 0 0 12px; color: #4b5563; }
      ul { margin: 0; padding-left: 20px; }
      a { color: #1d4ed8; text-decoration: none; }
    </style>
  </head>
  <body>
    <main class="wrap">
      <section class="card">
        <h1>Plexus AI 運行中</h1>
        <p>服務已啟動，你可以使用以下路徑：</p>
        <ul>
          <li><a href="/health">/health</a>：健康檢查</li>
          <li><a href="/webhook?hub.mode=subscribe&hub.verify_token=PlexusAI_2026_Verify&hub.challenge=12345">/webhook</a>：Meta 驗證測試</li>
        </ul>
      </section>
    </main>
  </body>
</html>`);
});

// 設定 Webhook 路徑
app.all('/webhook', handleWhatsAppWebhook);

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, service: 'plexusai' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Plexus AI 正在 ${PORT} 端口運行`);
});
