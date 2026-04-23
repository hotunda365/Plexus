import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type OpenRouterMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

function env(name: string, fallback = ""): string {
  return Deno.env.get(name) ?? fallback;
}

function requireEnv(name: string): string {
  const value = env(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getSupabaseAdmin() {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
}

async function hasMessageId(waMessageId: string): Promise<boolean> {
  if (!waMessageId) {
    return false;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("px_messages")
    .select("id")
    .eq("wa_message_id", waMessageId)
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }

  return Array.isArray(data) && data.length > 0;
}

function isMissingColumnError(message: string): boolean {
  return (
    message.includes("column") &&
    (message.includes("does not exist") || message.includes("schema cache"))
  );
}

async function resolveDefaultTenantId(): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const tenantCode = env("DEFAULT_TENANT_CODE", "DEMO001");

  const { data, error } = await supabase
    .from("px_tenants")
    .select("id")
    .eq("org_code", tenantCode)
    .single();

  if (error || !data?.id) {
    return null;
  }

  return String(data.id);
}

async function resolveTenantIdByPhoneNumberId(phoneNumberId: string): Promise<string | null> {
  if (!phoneNumberId) {
    return null;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("px_tenants")
    .select("id")
    .eq("wa_phone_number_id", phoneNumberId)
    .single();

  if (error || !data?.id) {
    return null;
  }

  return String(data.id);
}

async function resolveConnectionIdByPhoneNumberId(phoneNumberId: string): Promise<string | null> {
  if (!phoneNumberId) {
    return null;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("px_connections")
    .select("id")
    .eq("phone_number_id", phoneNumberId)
    .eq("platform", "whatsapp")
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
}): Promise<{ stored: boolean; duplicate?: boolean }> {
  const supabase = getSupabaseAdmin();

  const fullInsertPayload = {
    tenant_id: params.tenantId,
    connection_id: params.connectionId,
    customer_phone: params.customerPhone,
    raw_message: params.rawMessage,
    ai_suggestion: params.aiDraft,
    status: "pending",
    wa_message_id: params.messageId || null,
    wa_message_type: params.messageType || null,
    wa_message_timestamp: params.messageTimestamp || null,
    customer_name: params.customerName || null,
    raw_payload: params.body,
  };

  const { error: fullInsertError } = await supabase.from("px_messages").insert(fullInsertPayload);
  if (!fullInsertError) {
    return { stored: true };
  }

  if (!isMissingColumnError(fullInsertError.message)) {
    throw new Error(fullInsertError.message);
  }

  const { error: fallbackError } = await supabase.from("px_messages").insert({
    tenant_id: params.tenantId,
    connection_id: params.connectionId,
    customer_phone: params.customerPhone,
    raw_message: params.rawMessage,
    ai_suggestion: params.aiDraft,
    status: "pending",
  });

  if (fallbackError) {
    throw new Error(fallbackError.message);
  }

  return { stored: true };
}

async function getAIResponse(prompt: string): Promise<string> {
  const apiKey = env("OPENROUTER_API_KEY");
  if (!apiKey) {
    return "AI 草稿暫不可用（OPENROUTER_API_KEY 未設定）";
  }

  const model = env("OPENROUTER_MODEL", "openai/gpt-4o-mini");
  const siteUrl = env("SITE_URL", "https://plexus-connect.zeabur.app");
  const siteName = env("SITE_NAME", "Plexus AI");

  const messages: OpenRouterMessage[] = [{ role: "user", content: prompt }];

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": siteUrl,
      "X-Title": siteName,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.4,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    const message = data?.error?.message || `OpenRouter request failed (${response.status})`;
    return `AI 草稿暫不可用（${message}）`;
  }

  return data?.choices?.[0]?.message?.content || "AI 暫時無法回應";
}

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const verifyToken = env("WHATSAPP_VERIFY_TOKEN", "PlexusAI_2026_Verify");

  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === verifyToken && challenge) {
      return new Response(challenge, { status: 200 });
    }

    return jsonResponse(403, { ok: false, error: "Webhook verification failed" });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  try {
    const body = await req.json();
    if (body?.object !== "whatsapp_business_account") {
      return jsonResponse(404, { ok: false, error: "Not a WhatsApp event" });
    }

    const value = body?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    const phoneNumberId = String(value?.metadata?.phone_number_id || "");
    const text = msg?.text?.body;
    const from = msg?.from;
    const messageId = String(msg?.id || "");
    const messageType = String(msg?.type || "text");
    const messageTimestamp = String(msg?.timestamp || "");
    const customerName = String(value?.contacts?.[0]?.profile?.name || "");

    if (!text || !from) {
      return jsonResponse(200, { ok: true, skipped: "No inbound text message" });
    }

    const customerMsg = String(text);
    const customerPhone = String(from);
    const isDuplicate = await hasMessageId(messageId);
    if (isDuplicate) {
      return jsonResponse(200, { ok: true, stored: false, duplicate: true });
    }

    const aiDraft = await getAIResponse(customerMsg);
    const tenantId =
      (await resolveTenantIdByPhoneNumberId(phoneNumberId)) ||
      (await resolveDefaultTenantId());

    const connectionId = await resolveConnectionIdByPhoneNumberId(phoneNumberId);
    const result = await insertMessageWithFallback({
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

    return jsonResponse(200, { ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse(500, { ok: false, error: message });
  }
});
