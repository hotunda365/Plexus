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
