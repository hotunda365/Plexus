import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../.env') });

type TenantRow = {
  id: string;
  name: string;
  org_code: string | null;
};

type ConnectionRow = {
  id: string;
  phone_number_id: string | null;
  access_token: string | null;
};

type MessageRow = {
  id: string;
  tenant_id: string | null;
  connection_id: string | null;
  customer_phone: string | null;
  raw_message: string | null;
  ai_suggestion: string | null;
  final_response: string | null;
  status: string | null;
  created_at: string | null;
};

type SendResult = {
  contacts?: Array<{ wa_id?: string; input?: string }>;
  messages?: Array<{ id?: string; message_status?: string }>;
  [key: string]: unknown;
};

export type ReviewMessage = {
  id: string;
  tenant: string;
  tenantCode: string;
  customer: string;
  text: string;
  aiSuggestion: string;
  finalResponse: string;
  status: string;
  timestamp: string;
  createdAt: string | null;
  priority: 'low' | 'medium' | 'high';
};

const PENDING_STATUSES = ['pending', 'pending_review'];

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

function inferPriority(text: string): 'low' | 'medium' | 'high' {
  const normalized = text.toLowerCase();
  if (/投訴|complain|urgent|緊急|退款|slow|慢|爛|差/.test(normalized)) {
    return 'high';
  }
  if (/請問|hello|查詢|價錢|時間|地址/.test(normalized)) {
    return 'medium';
  }
  return 'low';
}

function formatTime(timestamp: string | null): string {
  if (!timestamp) {
    return 'N/A';
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return 'N/A';
  }

  return new Intl.DateTimeFormat('zh-HK', {
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function mapReviewMessages(
  messages: MessageRow[],
  tenants: Map<string, TenantRow>,
): ReviewMessage[] {
  return messages.map((message) => {
    const tenant = message.tenant_id ? tenants.get(message.tenant_id) : undefined;
    const rawText = message.raw_message || '';
    const aiSuggestion = message.ai_suggestion || '';
    const finalResponse = message.final_response || aiSuggestion;

    return {
      id: message.id,
      tenant: tenant?.name || 'Unknown Tenant',
      tenantCode: tenant?.org_code || 'N/A',
      customer: message.customer_phone || 'Unknown',
      text: rawText,
      aiSuggestion,
      finalResponse,
      status: message.status || 'pending_review',
      timestamp: formatTime(message.created_at),
      createdAt: message.created_at,
      priority: inferPriority(rawText),
    };
  });
}

export async function getReviewMessages() {
  const supabase = getSupabaseAdmin();
  const { data: messages, error: messagesError } = await supabase
    .from('px_messages')
    .select('id, tenant_id, connection_id, customer_phone, raw_message, ai_suggestion, final_response, status, created_at')
    .in('status', PENDING_STATUSES)
    .order('created_at', { ascending: false })
    .limit(50);

  if (messagesError) {
    throw new Error(`Failed to fetch messages: ${messagesError.message}`);
  }

  const tenantIds = Array.from(new Set((messages || []).map((message) => message.tenant_id).filter(Boolean)));
  const tenantsById = new Map<string, TenantRow>();

  if (tenantIds.length > 0) {
    const { data: tenants, error: tenantsError } = await supabase
      .from('px_tenants')
      .select('id, name, org_code')
      .in('id', tenantIds);

    if (tenantsError) {
      throw new Error(`Failed to fetch tenants: ${tenantsError.message}`);
    }

    for (const tenant of tenants || []) {
      tenantsById.set(tenant.id, tenant as TenantRow);
    }
  }

  return mapReviewMessages((messages || []) as MessageRow[], tenantsById);
}

function getWhatsAppCredentials(connection?: ConnectionRow) {
  const accessToken = connection?.access_token || process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = connection?.phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!accessToken || !phoneNumberId) {
    throw new Error('Missing WhatsApp credentials. Set px_connections values or WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID.');
  }

  return { accessToken, phoneNumberId };
}

async function sendWhatsAppTextMessage(to: string, body: string, connection?: ConnectionRow) {
  const apiVersion = process.env.WHATSAPP_API_VERSION || 'v21.0';
  const { accessToken, phoneNumberId } = getWhatsAppCredentials(connection);
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
      text: {
        body,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`WhatsApp send failed: ${response.status} ${text}`);
  }

  return response.json();
}

async function insertOutboundMessageWithFallback(params: {
  tenantId: string | null;
  connectionId: string | null;
  customerPhone: string;
  responseText: string;
  phoneNumberId: string;
  sendResult: SendResult;
}) {
  const supabase = getSupabaseAdmin();
  const waMessageId = String(params.sendResult?.messages?.[0]?.id || '');
  const waMessageStatus = String(params.sendResult?.messages?.[0]?.message_status || 'sent');
  const waToPhone = String(params.sendResult?.contacts?.[0]?.wa_id || params.customerPhone || '');

  const fullInsertPayload = {
    tenant_id: params.tenantId,
    connection_id: params.connectionId,
    customer_phone: params.customerPhone,
    customer_name: null,
    raw_message: params.responseText,
    raw_payload: params.sendResult,
    ai_suggestion: null,
    final_response: params.responseText,
    status: 'sent',
    wa_message_id: waMessageId || null,
    wa_message_type: 'text',
    wa_message_timestamp: new Date().toISOString(),
    wa_message_status: waMessageStatus,
    message_direction: 'outbound',
    wa_business_phone_number_id: params.phoneNumberId || null,
    wa_business_display_phone: null,
    wa_from_phone: params.phoneNumberId || null,
    wa_to_phone: waToPhone || null,
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
    raw_message: params.responseText,
    final_response: params.responseText,
    status: 'sent',
    wa_message_id: waMessageId || null,
    wa_message_type: 'text',
    wa_message_timestamp: new Date().toISOString(),
  });

  if (fallbackError) {
    throw new Error(fallbackError.message);
  }
}

export async function approveAndSendMessage(messageId: string, finalResponse: string) {
  const supabase = getSupabaseAdmin();
  const { data: message, error: messageError } = await supabase
    .from('px_messages')
    .select('id, tenant_id, connection_id, customer_phone, ai_suggestion, status')
    .eq('id', messageId)
    .single();

  if (messageError || !message) {
    throw new Error(`Message not found: ${messageError?.message || messageId}`);
  }

  const responseText = finalResponse.trim() || message.ai_suggestion || '';
  if (!responseText) {
    throw new Error('finalResponse is required.');
  }

  if (!message.customer_phone) {
    throw new Error('Message has no customer phone number.');
  }

  let connection: ConnectionRow | undefined;
  if (message.connection_id) {
    const { data: connectionRow, error: connectionError } = await supabase
      .from('px_connections')
      .select('id, phone_number_id, access_token')
      .eq('id', message.connection_id)
      .single();

    if (connectionError) {
      throw new Error(`Failed to load connection: ${connectionError.message}`);
    }

    connection = connectionRow as ConnectionRow;
  }

  const sendResult = (await sendWhatsAppTextMessage(message.customer_phone, responseText, connection)) as SendResult;

  const usedPhoneNumberId = connection?.phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  await insertOutboundMessageWithFallback({
    tenantId: message.tenant_id || null,
    connectionId: message.connection_id || null,
    customerPhone: message.customer_phone,
    responseText,
    phoneNumberId: usedPhoneNumberId,
    sendResult,
  });

  const { error: updateError } = await supabase
    .from('px_messages')
    .update({
      final_response: responseText,
      status: 'replied',
    })
    .eq('id', messageId);

  if (updateError) {
    throw new Error(`Failed to update message status: ${updateError.message}`);
  }

  return {
    ok: true,
    provider: 'whatsapp',
    sendResult,
  };
}

export async function ignoreMessage(messageId: string) {
  const supabase = getSupabaseAdmin();
  const { data: message, error: messageError } = await supabase
    .from('px_messages')
    .select('id, status')
    .eq('id', messageId)
    .single();

  if (messageError || !message) {
    throw new Error(`Message not found: ${messageError?.message || messageId}`);
  }

  const { error: updateError } = await supabase
    .from('px_messages')
    .update({ status: 'ignored' })
    .eq('id', messageId);

  if (updateError) {
    throw new Error(`Failed to ignore message: ${updateError.message}`);
  }

  return {
    ok: true,
    id: messageId,
    status: 'ignored',
  };
}