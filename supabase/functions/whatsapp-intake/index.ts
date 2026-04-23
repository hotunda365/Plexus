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

async function getAIResponse(prompt: string): Promise<string> {
  const apiKey = requireEnv("OPENROUTER_API_KEY");
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
    throw new Error(message);
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

    const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const text = msg?.text?.body;
    const from = msg?.from;

    if (!text || !from) {
      return jsonResponse(200, { ok: true, skipped: "No inbound text message" });
    }

    const customerMsg = String(text);
    const customerPhone = String(from);
    const aiDraft = await getAIResponse(customerMsg);
    const tenantId = await resolveDefaultTenantId();

    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("px_messages").insert({
      customer_phone: customerPhone,
      raw_message: customerMsg,
      ai_suggestion: aiDraft,
      status: "pending",
      tenant_id: tenantId,
    });

    if (error) {
      throw new Error(error.message);
    }

    return jsonResponse(200, { ok: true, stored: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse(500, { ok: false, error: message });
  }
});
