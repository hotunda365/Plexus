import * as dotenv from 'dotenv';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { resolve } from 'path';
import { processIncomingMessage } from './processMessage';

dotenv.config({ path: resolve(__dirname, '../.env') });

const port = Number(process.env.PORT || 3000);

function sendJson(res: ServerResponse, statusCode: number, payload: Record<string, unknown>) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function sendHtml(res: ServerResponse, html: string) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const method = req.method || 'GET';
  const url = req.url || '/';

  if (method === 'GET' && url === '/') {
    return sendHtml(
      res,
      `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PlexusAI Demo Console</title>
    <style>
      :root {
        --bg: #f4f7ff;
        --card: #ffffff;
        --ink: #1a2440;
        --muted: #5a678a;
        --brand: #0b64ff;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", "Noto Sans TC", sans-serif;
        background: radial-gradient(circle at 20% 20%, #e8eeff, transparent 35%),
          radial-gradient(circle at 80% 0%, #dff6ff, transparent 30%),
          var(--bg);
        color: var(--ink);
      }
      .wrap {
        max-width: 780px;
        margin: 40px auto;
        padding: 0 16px;
      }
      .card {
        background: var(--card);
        border: 1px solid #dbe4ff;
        border-radius: 14px;
        padding: 20px;
        box-shadow: 0 10px 30px rgba(20, 60, 150, 0.08);
      }
      h1 { margin: 0 0 8px; font-size: 28px; }
      p { margin: 0 0 16px; color: var(--muted); }
      label { display: block; font-weight: 600; margin: 12px 0 6px; }
      input, textarea {
        width: 100%;
        border: 1px solid #cfd9f5;
        border-radius: 10px;
        padding: 10px 12px;
        font-size: 15px;
      }
      textarea { min-height: 120px; resize: vertical; }
      button {
        margin-top: 14px;
        border: 0;
        background: var(--brand);
        color: white;
        padding: 10px 16px;
        border-radius: 10px;
        font-size: 15px;
        cursor: pointer;
      }
      pre {
        margin-top: 16px;
        background: #0f172a;
        color: #d1f3ff;
        border-radius: 10px;
        padding: 12px;
        overflow: auto;
      }
      .hint { margin-top: 12px; font-size: 13px; color: var(--muted); }
      code { color: #0d4ddb; }
    </style>
  </head>
  <body>
    <main class="wrap">
      <section class="card">
        <h1>PlexusAI 測試介面</h1>
        <p>這是 Zeabur 部署後的簡易 UI，可直接測試 <code>/process</code> API。</p>
        <label for="tenantCode">Tenant Code</label>
        <input id="tenantCode" value="DEMO001" />
        <label for="customerMsg">Customer Message</label>
        <textarea id="customerMsg">請問你們辦公室在哪裡？</textarea>
        <button id="sendBtn">送出到 /process</button>
        <pre id="result">尚未送出</pre>
        <div class="hint">Health check: <code>/health</code></div>
      </section>
    </main>
    <script>
      const button = document.getElementById('sendBtn');
      const output = document.getElementById('result');
      button.addEventListener('click', async () => {
        const tenantCode = document.getElementById('tenantCode').value;
        const customerMsg = document.getElementById('customerMsg').value;
        output.textContent = '處理中...';
        try {
          const response = await fetch('/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantCode, customerMsg }),
          });
          const data = await response.json();
          output.textContent = JSON.stringify(data, null, 2);
        } catch (error) {
          output.textContent = String(error);
        }
      });
    </script>
  </body>
</html>`
    );
  }

  if (method === 'GET' && url === '/health') {
    return sendJson(res, 200, { ok: true, service: 'plexusai' });
  }

  if (method === 'POST' && url === '/process') {
    try {
      const rawBody = await readBody(req);
      const body = rawBody ? JSON.parse(rawBody) : {};
      const tenantCode = String(body.tenantCode || '');
      const customerMsg = String(body.customerMsg || '');

      if (!tenantCode || !customerMsg) {
        return sendJson(res, 400, {
          ok: false,
          error: 'tenantCode and customerMsg are required',
        });
      }

      await processIncomingMessage(tenantCode, customerMsg);
      return sendJson(res, 200, { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      return sendJson(res, 500, { ok: false, error: message });
    }
  }

  return sendJson(res, 404, { ok: false, error: 'not found' });
});

server.listen(port, () => {
  console.log(`PlexusAI server listening on port ${port}`);
});
