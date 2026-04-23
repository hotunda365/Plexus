import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { getAIResponse } from './services/aiService';

type ParsedInboundMessage = {
  messageType: string;
  rawMessage: string;
  aiInput: string;
  mediaId: string;
  mediaMimeType: string;
  mediaSha256: string;
  mediaCaption: string;
  mediaFilename: string;
};

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

async function hasMessageId(waMessageId: string): Promise<boolean> {
  if (!waMessageId) {
    return false;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('px_messages')
    .select('id')
    .eq('wa_message_id', waMessageId)
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }

  return Array.isArray(data) && data.length > 0;
}

async function upsertStatusEvent(params: {
  body: unknown;
  phoneNumberId: string;
  businessDisplayPhone: string;
  statusItem: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdmin();
  const waMessageId = String(params.statusItem?.id || '');
  const waMessageStatus = String(params.statusItem?.status || '');
  const waToPhone = String(params.statusItem?.recipient_id || '');
  const timestamp = String(params.statusItem?.timestamp || '');

  if (!waMessageId) {
    return;
  }

  const { data: existing, error: readError } = await supabase
    .from('px_messages')
    .select('id')
    .eq('wa_message_id', waMessageId)
    .limit(1);

  if (readError) {
    throw new Error(readError.message);
  }

  if (Array.isArray(existing) && existing.length > 0) {
    const { error: updateError } = await supabase
      .from('px_messages')
      .update({
        wa_message_status: waMessageStatus || null,
        wa_message_timestamp: timestamp || null,
        raw_payload: params.body,
      })
      .eq('wa_message_id', waMessageId);

    if (updateError && !isMissingColumnError(updateError.message)) {
      throw new Error(updateError.message);
    }
    return;
  }

  const fullInsertPayload = {
    tenant_id: (await resolveTenantIdByPhoneNumberId(params.phoneNumberId)) || (await resolveDefaultTenantId()),
    connection_id: await resolveConnectionIdByPhoneNumberId(params.phoneNumberId),
    customer_phone: waToPhone || null,
    raw_message: null,
    final_response: null,
    status: waMessageStatus || 'sent',
    wa_message_id: waMessageId,
    wa_message_type: 'status',
    wa_message_timestamp: timestamp || null,
    wa_message_status: waMessageStatus || null,
    message_direction: 'outbound',
    wa_business_phone_number_id: params.phoneNumberId || null,
    wa_business_display_phone: params.businessDisplayPhone || null,
    wa_from_phone: params.phoneNumberId || null,
    wa_to_phone: waToPhone || null,
    raw_payload: params.body,
  };

  const { error: insertError } = await supabase.from('px_messages').insert(fullInsertPayload);
  if (insertError && !isMissingColumnError(insertError.message)) {
    throw new Error(insertError.message);
  }
}

function parseInboundMessage(msg: Record<string, unknown>): ParsedInboundMessage {
  const messageType = String(msg?.type || 'unknown');

  if (messageType === 'text') {
    const body = String((msg as any)?.text?.body || '');
    return {
      messageType,
      rawMessage: body,
      aiInput: body,
      mediaId: '',
      mediaMimeType: '',
      mediaSha256: '',
      mediaCaption: '',
      mediaFilename: '',
    };
  }

  if (messageType === 'image') {
    const image = (msg as any)?.image || {};
    const caption = String(image?.caption || '');
    return {
      messageType,
      rawMessage: caption ? `[image] ${caption}` : '[image]',
      aiInput: caption,
      mediaId: String(image?.id || ''),
      mediaMimeType: String(image?.mime_type || ''),
      mediaSha256: String(image?.sha256 || ''),
      mediaCaption: caption,
      mediaFilename: '',
    };
  }

  if (messageType === 'audio') {
    const audio = (msg as any)?.audio || {};
    return {
      messageType,
      rawMessage: '[audio]',
      aiInput: '',
      mediaId: String(audio?.id || ''),
      mediaMimeType: String(audio?.mime_type || ''),
      mediaSha256: String(audio?.sha256 || ''),
      mediaCaption: '',
      mediaFilename: '',
    };
  }

  if (messageType === 'video') {
    const video = (msg as any)?.video || {};
    const caption = String(video?.caption || '');
    return {
      messageType,
      rawMessage: caption ? `[video] ${caption}` : '[video]',
      aiInput: caption,
      mediaId: String(video?.id || ''),
      mediaMimeType: String(video?.mime_type || ''),
      mediaSha256: String(video?.sha256 || ''),
      mediaCaption: caption,
      mediaFilename: '',
    };
  }

  if (messageType === 'document') {
    const doc = (msg as any)?.document || {};
    const filename = String(doc?.filename || '');
    const caption = String(doc?.caption || '');
    const text = ['[document]', filename, caption].filter(Boolean).join(' ');
    return {
      messageType,
      rawMessage: text || '[document]',
      aiInput: caption,
      mediaId: String(doc?.id || ''),
      mediaMimeType: String(doc?.mime_type || ''),
      mediaSha256: String(doc?.sha256 || ''),
      mediaCaption: caption,
      mediaFilename: filename,
    };
  }

  if (messageType === 'sticker') {
    const sticker = (msg as any)?.sticker || {};
    return {
      messageType,
      rawMessage: '[sticker]',
      aiInput: '',
      mediaId: String(sticker?.id || ''),
      mediaMimeType: String(sticker?.mime_type || ''),
      mediaSha256: String(sticker?.sha256 || ''),
      mediaCaption: '',
      mediaFilename: '',
    };
  }

  return {
    messageType,
    rawMessage: `[${messageType}]`,
    aiInput: '',
    mediaId: '',
    mediaMimeType: '',
    mediaSha256: '',
    mediaCaption: '',
    mediaFilename: '',
  };
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
  businessPhoneNumberId: string;
  businessDisplayPhone: string;
  mediaId: string;
  mediaMimeType: string;
  mediaSha256: string;
  mediaCaption: string;
  mediaFilename: string;
}): Promise<{ stored: boolean; duplicate?: boolean }> {
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
    wa_message_status: 'received',
    wa_media_id: params.mediaId || null,
    wa_media_mime_type: params.mediaMimeType || null,
    wa_media_sha256: params.mediaSha256 || null,
    wa_media_caption: params.mediaCaption || null,
    wa_media_filename: params.mediaFilename || null,
    message_direction: 'inbound',
    wa_business_phone_number_id: params.businessPhoneNumberId || null,
    wa_business_display_phone: params.businessDisplayPhone || null,
    wa_from_phone: params.customerPhone || null,
    wa_to_phone: params.businessDisplayPhone || params.businessPhoneNumberId || null,
    customer_name: params.customerName || null,
    raw_payload: params.body,
  };

  const { error: fullInsertError } = await supabase.from('px_messages').insert(fullInsertPayload);
  if (!fullInsertError) {
    return { stored: true };
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
    wa_message_id: params.messageId || null,
    wa_message_type: params.messageType || null,
    wa_message_timestamp: params.messageTimestamp || null,
    wa_media_id: params.mediaId || null,
  });

  if (fallbackError) {
    throw new Error(fallbackError.message);
  }

  return { stored: true };
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
      const msg = value?.messages?.[0] as Record<string, unknown> | undefined;
      const phoneNumberId = String(value?.metadata?.phone_number_id || '');
      const businessDisplayPhone = String(value?.metadata?.display_phone_number || '');
      const statuses = Array.isArray(value?.statuses) ? value.statuses : [];

      if (statuses.length > 0) {
        for (const statusItem of statuses) {
          await upsertStatusEvent({
            body,
            phoneNumberId,
            businessDisplayPhone,
            statusItem: statusItem as Record<string, unknown>,
          });
        }
        return res.sendStatus(200);
      }

      const from = String((msg as any)?.from || '');
      if (!msg || !from) {
        return res.sendStatus(200);
      }

      const parsed = parseInboundMessage(msg);
      const messageId = String(msg?.id || '');
      const messageType = parsed.messageType;
      const messageTimestamp = String(msg?.timestamp || '');
      const customerName = String(value?.contacts?.[0]?.profile?.name || '');

      {
        const customerMsg = parsed.rawMessage;
        const customerPhone = from;

        try {
          const isDuplicate = await hasMessageId(messageId);
          if (isDuplicate) {
            console.log(`ℹ️ 重複訊息已略過: ${messageId}`);
            return res.sendStatus(200);
          }

          const aiDraft = parsed.aiInput
            ? await getAIResponse(parsed.aiInput)
            : 'AI 暫無文字可分析（media only）';
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
            businessPhoneNumberId: phoneNumberId,
            businessDisplayPhone,
            mediaId: parsed.mediaId,
            mediaMimeType: parsed.mediaMimeType,
            mediaSha256: parsed.mediaSha256,
            mediaCaption: parsed.mediaCaption,
            mediaFilename: parsed.mediaFilename,
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
