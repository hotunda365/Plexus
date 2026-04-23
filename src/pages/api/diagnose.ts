import { createClient } from '@supabase/supabase-js';
import { Request, Response } from 'express';

type CheckStatus = string | Array<{ name: string; status: string }>;

type DiagnoseReport = {
  timestamp: string;
  checks: {
    env_variables?: Array<{ name: string; status: string }>;
    supabase_connection?: CheckStatus;
    supabase_write_test?: CheckStatus;
    ai_service?: CheckStatus;
    whatsapp_token?: CheckStatus;
    whatsapp_send_scope?: CheckStatus;
  };
};

function toBooleanQueryFlag(value: unknown): boolean {
  if (value === true || value === 'true' || value === '1') {
    return true;
  }
  return false;
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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    report.checks.supabase_connection = `FAIL: ${message}`;
    if (report.checks.supabase_write_test === undefined) {
      report.checks.supabase_write_test = `FAIL: ${message}`;
    }
  }

  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY is missing.');
    }

    const aiTest = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': process.env.SITE_URL || '',
        'X-Title': process.env.SITE_NAME || 'Plexus AI',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || 'google/gemini-flash-1.5',
        messages: [{ role: 'user', content: 'Check' }],
        max_tokens: 10,
      }),
    });

    const resData = (await aiTest.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    if (aiTest.ok && resData.choices?.length) {
      report.checks.ai_service = 'OK: OpenRouter + Gemini reachable';
    } else {
      report.checks.ai_service = `FAIL: ${resData.error?.message || `HTTP ${aiTest.status}`}`;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    report.checks.ai_service = `FAIL: ${message}`;
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