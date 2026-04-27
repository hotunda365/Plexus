import express from 'express';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { approveAndSendMessage, getReviewMessages, ignoreMessage } from './adminPortal';
import { diagnoseHandler } from './pages/api/diagnose';
import { handleWhatsAppWebhook, processWhatsAppWebhookBody } from './whatsappWebhook';

const app = express();
app.use(express.json());

app.use((error: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  const syntaxError = error as SyntaxError & { status?: number; body?: unknown };
  if (syntaxError instanceof SyntaxError && syntaxError.status === 400 && 'body' in syntaxError) {
    return res.status(400).json({
      ok: false,
      error: 'Invalid JSON payload',
    });
  }

  return next(error);
});

const frontendDistPath = resolve(__dirname, '../frontend/dist');
const frontendIndexPath = resolve(frontendDistPath, 'index.html');
const hasFrontendBuild = existsSync(frontendIndexPath);

type RuntimeTestLog = {
  id: string;
  created_at: string;
  message_direction: 'inbound' | 'outbound';
  status: string;
  customer_phone: string | null;
  raw_message: string | null;
  final_response: string | null;
  wa_message_id: string | null;
  wa_message_type: string;
  wa_from_phone: string | null;
  wa_to_phone: string | null;
  source: 'runtime';
};

const runtimeTestLogs: RuntimeTestLog[] = [];

function hasSupabaseConfig(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function pushRuntimeTestLog(log: Omit<RuntimeTestLog, 'id' | 'created_at' | 'source'>) {
  runtimeTestLogs.unshift({
    id: `runtime-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    created_at: new Date().toISOString(),
    source: 'runtime',
    ...log,
  });

  if (runtimeTestLogs.length > 200) {
    runtimeTestLogs.length = 200;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getSupabaseAdmin() {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'));
}

// 設定 Webhook 路徑
app.all('/webhook', handleWhatsAppWebhook);

app.get('/api/messages', async (_req, res) => {
  try {
    const messages = await getReviewMessages();
    res.status(200).json({ ok: true, messages });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ ok: false, error: message });
  }
});

app.post('/api/messages/:id/approve-send', async (req, res) => {
  try {
    const result = await approveAndSendMessage(req.params.id, String(req.body.finalResponse || ''));
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ ok: false, error: message });
  }
});

app.post('/api/messages/:id/ignore', async (req, res) => {
  try {
    const result = await ignoreMessage(req.params.id);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ ok: false, error: message });
  }
});

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, service: 'plexusai' });
});

// Sync tenants with wa_phone_number_id into px_connections
app.post('/api/connections/sync', async (_req, res) => {
  try {
    const supabase = getSupabaseAdmin();

    const { data: tenants, error: tenantError } = await supabase
      .from('px_tenants')
      .select('id, name, wa_phone_number_id, wa_access_token')
      .not('wa_phone_number_id', 'is', null);

    if (tenantError) throw new Error(tenantError.message);

    const results: Array<{ tenant: string; status: string }> = [];

    for (const tenant of tenants || []) {
      const { data: existing } = await supabase
        .from('px_connections')
        .select('id')
        .eq('phone_number_id', tenant.wa_phone_number_id)
        .eq('platform', 'whatsapp')
        .single();

      if (existing?.id) {
        results.push({ tenant: tenant.name, status: 'already_exists' });
        continue;
      }

      const { error: insertError } = await supabase.from('px_connections').insert({
        tenant_id: tenant.id,
        platform: 'whatsapp',
        phone_number_id: tenant.wa_phone_number_id,
        access_token: tenant.wa_access_token || '',
        connection_status: 'active',
        last_heartbeat: new Date().toISOString(),
      });

      if (insertError) {
        results.push({ tenant: tenant.name, status: `error: ${insertError.message}` });
      } else {
        results.push({ tenant: tenant.name, status: 'created' });
      }
    }

    res.status(200).json({ ok: true, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ ok: false, error: message });
  }
});

app.get('/api/diagnose', diagnoseHandler);

app.post('/api/test/outbound', async (req, res) => {
  try {
    const to = String(req.body?.to || '').trim();
    const text = String(req.body?.text || '').trim();
    if (!to || !text) {
      return res.status(400).json({ ok: false, error: 'to and text are required' });
    }

    const accessToken = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
    const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
    if (!accessToken || !phoneNumberId) {
      return res.status(400).json({
        ok: false,
        error: 'Missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID in environment',
      });
    }

    const apiVersion = process.env.WHATSAPP_API_VERSION || 'v21.0';
    const response = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
    });

    const body = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ ok: false, error: body });
    }

    pushRuntimeTestLog({
      message_direction: 'outbound',
      status: 'sent',
      customer_phone: to,
      raw_message: text,
      final_response: text,
      wa_message_id: String((body as any)?.messages?.[0]?.id || ''),
      wa_message_type: 'text',
      wa_from_phone: phoneNumberId || null,
      wa_to_phone: to,
    });

    return res.status(200).json({
      ok: true,
      direction: 'outbound',
      to,
      text,
      result: body,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ ok: false, error: message });
  }
});

app.post('/api/test/inbound', async (req, res) => {
  try {
    const from = String(req.body?.from || '').trim();
    const text = String(req.body?.text || '').trim();
    const senderName = String(req.body?.senderName || 'Test Customer').trim();
    if (!from || !text) {
      return res.status(400).json({ ok: false, error: 'from and text are required' });
    }

    const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || 'TEST_PHONE_NUMBER_ID');
    const displayPhone = String(process.env.WHATSAPP_DISPLAY_PHONE || 'TEST_DISPLAY_PHONE');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const messageId = `wamid.TEST.${Date.now()}`;

    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'test-entry',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: displayPhone,
                  phone_number_id: phoneNumberId,
                },
                contacts: [
                  {
                    profile: { name: senderName },
                    wa_id: from,
                  },
                ],
                messages: [
                  {
                    from,
                    id: messageId,
                    timestamp,
                    type: 'text',
                    text: { body: text },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const result = await processWhatsAppWebhookBody(payload);

    pushRuntimeTestLog({
      message_direction: 'inbound',
      status: 'received',
      customer_phone: from,
      raw_message: text,
      final_response: null,
      wa_message_id: messageId,
      wa_message_type: 'text',
      wa_from_phone: from,
      wa_to_phone: phoneNumberId,
    });

    return res.status(200).json({
      ok: true,
      direction: 'inbound',
      from,
      text,
      messageId,
      processed: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ ok: false, error: message });
  }
});

app.get('/api/test/logs', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 200));
    const direction = String(req.query.direction || '').trim().toLowerCase();
    const runtimeLogs = runtimeTestLogs
      .filter((row) => !direction || direction === row.message_direction)
      .slice(0, limit);

    if (!hasSupabaseConfig()) {
      return res.status(200).json({
        ok: true,
        source: 'runtime',
        count: runtimeLogs.length,
        logs: runtimeLogs,
      });
    }

    const supabase = getSupabaseAdmin();

    let query = supabase
      .from('px_messages')
      .select('id, created_at, status, message_direction, customer_phone, raw_message, final_response, wa_message_id, wa_message_type, wa_from_phone, wa_to_phone')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (direction === 'inbound' || direction === 'outbound') {
      query = query.eq('message_direction', direction);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(error.message);
    }

    return res.status(200).json({
      ok: true,
      source: 'supabase',
      count: Array.isArray(data) ? data.length : 0,
      logs: Array.isArray(data) && data.length > 0 ? data : runtimeLogs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const runtimeLogs = runtimeTestLogs.slice(0, Math.max(1, Math.min(Number(req.query.limit || 50), 200)));
    return res.status(200).json({
      ok: true,
      source: 'runtime_fallback',
      warning: message,
      count: runtimeLogs.length,
      logs: runtimeLogs,
    });
  }
});

if (hasFrontendBuild) {
  app.use(express.static(frontendDistPath));

  app.get('/', (_req, res) => {
    res.sendFile(frontendIndexPath);
  });

  app.get(/^\/(?!api|webhook|health).*/, (_req, res) => {
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
