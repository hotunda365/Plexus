import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { getAIResponse } from './services/aiService';

dotenv.config({ path: resolve(__dirname, '../.env') });

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

function isMissingColumnError(message: string): boolean {
  return message.includes('column') && (message.includes('does not exist') || message.includes('schema cache'));
}

async function resolveDefaultTenantId() {
  const supabase = getSupabaseAdmin();
  const tenantCode = process.env.DEFAULT_TENANT_CODE || 'DEMO001';
  const { data, error } = await supabase
    .from('px_tenants')
    .select('id')
    .eq('org_code', tenantCode)
    .single();

  if (error || !data?.id) {
    return null;
  }

  return String(data.id);
}

async function resolveTenantIdByPhoneNumberId(phoneNumberId: string) {
  if (!phoneNumberId) {
    return null;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('px_tenants')
    .select('id')
    .eq('wa_phone_number_id', phoneNumberId)
    .single();

  if (error || !data?.id) {
    return null;
  }

  return String(data.id);
}

async function resolveConnectionIdByPhoneNumberId(phoneNumberId: string) {
  if (!phoneNumberId) {
    return null;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('px_connections')
    .select('id')
    .eq('phone_number_id', phoneNumberId)
    .eq('platform', 'whatsapp')
    .single();

  if (error || !data?.id) {
    return null;
  }

  return String(data.id);
}

async function insertMessageWithFallback(params: {
  tenantId: string | null;
  connectionId: string | null;
  customerPhone: string;
  rawMessage: string;
  aiDraft: string;
  body: unknown;
  messageId: string;
  messageType: string;
  messageTimestamp: string;
  customerName: string;
}) {
  const supabase = getSupabaseAdmin();

  const fullInsertPayload = {
    tenant_id: params.tenantId,
    connection_id: params.connectionId,
    customer_phone: params.customerPhone,
    raw_message: params.rawMessage,
    ai_suggestion: params.aiDraft,
    status: 'pending',
    wa_message_id: params.messageId || null,
    wa_message_type: params.messageType || null,
    wa_message_timestamp: params.messageTimestamp || null,
    customer_name: params.customerName || null,
    raw_payload: params.body,
  };

  const { error: fullInsertError } = await supabase.from('px_messages').insert(fullInsertPayload);
  if (!fullInsertError) {
    return;
  }

  if (!isMissingColumnError(fullInsertError.message)) {
    throw new Error(fullInsertError.message);
  }

  const { error: fallbackError } = await supabase.from('px_messages').insert({
    tenant_id: params.tenantId,
    connection_id: params.connectionId,
    customer_phone: params.customerPhone,
    raw_message: params.rawMessage,
    ai_suggestion: params.aiDraft,
    status: 'pending',
  });

  if (fallbackError) {
    throw new Error(fallbackError.message);
  }
}

// 這是在 Meta 開發者後台你自己設定的隨機字串
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'PlexusAI_2026_Verify';

export const handleWhatsAppWebhook = async (req: Request, res: Response) => {
  // --- 處理 Meta 的驗證請求 (GET) ---
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('Webhook 驗證成功');
        return res.status(200).send(challenge);
      }
      return res.sendStatus(403);
    }
  }

  // --- 處理來自客戶的訊息 (POST) ---
  if (req.method === 'POST') {
    const body = req.body;

    // 檢查這是否為 WhatsApp 的訊息事件
    if (body.object === 'whatsapp_business_account') {
      const value = body.entry?.[0]?.changes?.[0]?.value;
      const msg = value?.messages?.[0];
      const phoneNumberId = String(value?.metadata?.phone_number_id || '');
      const messageId = String(msg?.id || '');
      const messageType = String(msg?.type || 'text');
      const messageTimestamp = String(msg?.timestamp || '');
      const customerName = String(value?.contacts?.[0]?.profile?.name || '');

      if (msg?.text?.body) {
        const customerMsg = String(msg.text.body);
        const customerPhone = String(msg.from || '');

        try {
          const aiDraft = await getAIResponse(customerMsg);
          const tenantId =
            (await resolveTenantIdByPhoneNumberId(phoneNumberId)) ||
            (await resolveDefaultTenantId());
          const connectionId = await resolveConnectionIdByPhoneNumberId(phoneNumberId);

          await insertMessageWithFallback({
            tenantId,
            connectionId,
            customerPhone,
            rawMessage: customerMsg,
            aiDraft,
            body,
            messageId,
            messageType,
            messageTimestamp,
            customerName,
          });

          console.log('✅ 訊息已存入 Supabase，等待管理員審核');
        } catch (error) {
          const message = error instanceof Error ? error.message : 'unknown error';
          console.error(`Webhook 流程失敗: ${message}`);
        }
      }

      return res.sendStatus(200);
    }
    return res.sendStatus(404);
  }

  return res.sendStatus(405);
};
