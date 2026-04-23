import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import { Request, Response } from 'express';

type CheckStatus = string | Array<{ name: string; status: string }>;

type DiagnoseReport = {
  timestamp: string;
  checks: {
    env_variables?: Array<{ name: string; status: string }>;
    supabase_connection?: CheckStatus;
    supabase_write_test?: CheckStatus;
    gemini_ai?: CheckStatus;
    gemini_model_attempts?: Array<{ model: string; status: string }>;
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

function normalizeModelName(raw: string): string {
  return raw.startsWith('models/') ? raw.slice('models/'.length) : raw;
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

  const requiredVars = ['GEMINI_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
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
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is missing.');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const candidateModels = [
      process.env.GEMINI_MODEL,
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.5-pro',
      'gemini-1.5-flash-latest',
      'gemini-1.5-flash',
      'gemini-1.5-flash-8b',
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite',
    ].filter((item, index, arr): item is string => Boolean(item) && arr.indexOf(item) === index);

    try {
      const listModelsFn = (genAI as unknown as { listModels?: () => Promise<unknown> }).listModels;
      if (listModelsFn) {
        const listResult = (await listModelsFn.call(genAI)) as {
          models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
        };

        const discoveredModels = (listResult.models || [])
          .filter((model) => (model.supportedGenerationMethods || []).includes('generateContent'))
          .map((model) => normalizeModelName(model.name || ''))
          .filter((name) => name.toLowerCase().includes('gemini'));

        for (const discoveredModel of discoveredModels) {
          if (!candidateModels.includes(discoveredModel)) {
            candidateModels.push(discoveredModel);
          }
        }
      }
    } catch {
      // listModels may not be available depending on SDK/runtime; fallback attempts still run.
    }

    const attempts: Array<{ model: string; status: string }> = [];
    let successModel = '';

    for (const modelName of candidateModels) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent('Hi, are you working?');
        const response = await result.response;
        const text = response.text();

        if (text) {
          attempts.push({ model: modelName, status: 'OK' });
          successModel = modelName;
          break;
        }

        attempts.push({ model: modelName, status: 'FAIL: empty response' });
      } catch (attemptError) {
        const message = attemptError instanceof Error ? attemptError.message : 'unknown error';
        attempts.push({ model: modelName, status: `FAIL: ${message}` });
      }
    }

    report.checks.gemini_model_attempts = attempts;
    if (successModel) {
      report.checks.gemini_ai = `OK: AI responded with ${successModel}`;
    } else if (attempts.some((attempt) => attempt.status.includes('User location is not supported'))) {
      report.checks.gemini_ai = 'FAIL: blocked by user location restriction for Gemini API';
    } else {
      report.checks.gemini_ai = 'FAIL: all candidate models failed';
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    report.checks.gemini_ai = `FAIL: ${message}`;
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