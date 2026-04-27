import { createClient } from '@supabase/supabase-js';
import { Request, Response } from 'express';

type CheckStatus = string | Array<{ name: string; status: string }> | Record<string, unknown>;

type DiagnoseReport = {
  timestamp: string;
  checks: {
    env_variables?: Array<{ name: string; status: string }>;
    supabase_connection?: CheckStatus;
    supabase_write_test?: CheckStatus;
    ai_service?: CheckStatus;
    whatsapp_token?: CheckStatus;
    whatsapp_send_scope?: CheckStatus;
    message_flow?: CheckStatus;
  };
};

type MessageFlowRow = {
  message_direction: string | null;
  wa_business_phone_number_id: string | null;
  wa_business_display_phone: string | null;
  status: string | null;
  created_at: string | null;
};

function toBooleanQueryFlag(value: unknown): boolean {
  if (value === true || value === 'true' || value === '1') {
    return true;
  }
  return false;
}

function toMinutesQuery(value: unknown, defaultMinutes: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return defaultMinutes;
  }
  const rounded = Math.floor(parsed);
  if (rounded < 1) {
    return defaultMinutes;
  }
  return Math.min(rounded, 1440);
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.');
  }

  return createClient(url, serviceRoleKey);
}

export async function diagnoseHandler(_req: Request, res: Response) {
  const req = _req;
  const windowMinutes = toMinutesQuery(req.query.minutes, 30);
  const report: DiagnoseReport = {
    timestamp: new Date().toISOString(),
    checks: {},
  };

  const requiredVars = [
    'OPENROUTER_API_KEY',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SITE_URL',
    'SITE_NAME',
  ];
  report.checks.env_variables = requiredVars.map((name) => ({
    name,
    status: process.env[name] ? 'OK: set' : 'MISSING',
  }));

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from('px_messages').select('id').limit(1);
    report.checks.supabase_connection = error
      ? `FAIL: ${error.message}`
      : 'OK: can read px_messages';

    if (toBooleanQueryFlag(req.query.writeTest)) {
      const insertPayload = {
        raw_message: '[diagnose] write test',
        ai_suggestion: 'diagnose',
        customer_phone: '+10000000000',
        status: 'pending',
      };

      const { data: insertedRow, error: insertError } = await supabase
        .from('px_messages')
        .insert(insertPayload)
        .select('id')
        .single();

      if (insertError || !insertedRow) {
        throw new Error(`write test insert failed: ${insertError?.message || 'insert returned no row'}`);
      }

      const { error: deleteError } = await supabase
        .from('px_messages')
        .delete()
        .eq('id', insertedRow.id);

      if (deleteError) {
        throw new Error(`write test cleanup failed: ${deleteError.message}`);
      }

      report.checks.supabase_write_test = 'OK: insert and cleanup succeeded on px_messages';
    } else {
      report.checks.supabase_write_test = 'SKIP: append ?writeTest=1 to run insert/delete test';
    }

    const sinceIso = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
    const { data: rows, error: flowError } = await supabase
      .from('px_messages')
      .select('message_direction, wa_business_phone_number_id, wa_business_display_phone, status, created_at')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(2000);

    if (flowError) {
      report.checks.message_flow = `FAIL: ${flowError.message}`;
    } else {
      const list = (rows || []) as MessageFlowRow[];
      const byBusiness: Record<string, { total: number; inbound: number; outbound: number; unknown: number }> = {};
      const statusCounts: Record<string, number> = {};

      let inbound = 0;
      let outbound = 0;
      let unknown = 0;

      for (const row of list) {
        const direction = String(row.message_direction || '').toLowerCase();
        if (direction === 'inbound') {
          inbound += 1;
        } else if (direction === 'outbound') {
          outbound += 1;
        } else {
          unknown += 1;
        }

        const businessKey = row.wa_business_display_phone || row.wa_business_phone_number_id || 'unknown';
        if (!byBusiness[businessKey]) {
          byBusiness[businessKey] = { total: 0, inbound: 0, outbound: 0, unknown: 0 };
        }
        byBusiness[businessKey].total += 1;
        if (direction === 'inbound') {
          byBusiness[businessKey].inbound += 1;
        } else if (direction === 'outbound') {
          byBusiness[businessKey].outbound += 1;
        } else {
          byBusiness[businessKey].unknown += 1;
        }

        const statusKey = row.status || 'unknown';
        statusCounts[statusKey] = (statusCounts[statusKey] || 0) + 1;
      }

      report.checks.message_flow = {
        window_minutes: windowMinutes,
        since: sinceIso,
        total: list.length,
        inbound,
        outbound,
        unknown,
        by_business: byBusiness,
        status_counts: statusCounts,
        recent_samples: list.slice(0, 5).map((row) => ({
          direction: row.message_direction || 'unknown',
          business: row.wa_business_display_phone || row.wa_business_phone_number_id || 'unknown',
          status: row.status || 'unknown',
          at: row.created_at,
        })),
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    report.checks.supabase_connection = `FAIL: ${message}`;
    if (report.checks.supabase_write_test === undefined) {
      report.checks.supabase_write_test = `FAIL: ${message}`;
    }
  }

  try {
    const aiTest = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-flash-1.5',
        messages: [{ role: 'user', content: 'Ping' }],
      }),
    });

    const resData = await aiTest.json();
    if (resData.choices) {
      report.checks.ai_service = '✅ 正常 (OpenRouter + Gemini 已通)';
    } else {
      report.checks.ai_service = `❌ OpenRouter 報錯: ${resData.error?.message || '未知錯誤'}`;
    }
  } catch (e: any) {
    report.checks.ai_service = `❌ 連線失敗: ${e.message}`;
  }

  report.checks.whatsapp_token = process.env.WHATSAPP_VERIFY_TOKEN
    ? 'OK: set'
    : 'WARN: not set';

  report.checks.whatsapp_send_scope = process.env.WHATSAPP_TEST_NUMBER
    ? 'INFO: WHATSAPP_TEST_NUMBER is set. Verify this number exists in Meta test numbers while app is in Development mode.'
    : 'WARN: set WHATSAPP_TEST_NUMBER and add it in Meta test numbers; Development mode can only send to approved test numbers.';

  res.status(200).json(report);
}

export default diagnoseHandler;