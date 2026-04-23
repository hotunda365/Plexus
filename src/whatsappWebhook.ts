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
      const msg = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

      if (msg?.text?.body) {
        const customerMsg = String(msg.text.body);
        const customerPhone = String(msg.from || '');

        try {
          const aiDraft = await getAIResponse(customerMsg);
          const tenantId = await resolveDefaultTenantId();
          const supabase = getSupabaseAdmin();

          const { error: insertError } = await supabase.from('px_messages').insert({
            customer_phone: customerPhone,
            raw_message: customerMsg,
            ai_suggestion: aiDraft,
            status: 'pending',
            tenant_id: tenantId,
          });

          if (insertError) {
            throw new Error(insertError.message);
          }

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
