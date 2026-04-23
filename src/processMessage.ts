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

function getClients() {
    const supabase = createClient(
        requireEnv('SUPABASE_URL'),
        requireEnv('SUPABASE_SERVICE_ROLE_KEY')
    );
    return { supabase };
}

export async function processIncomingMessage(tenantCode: string, customerMsg: string) {
    console.log(`[Plexus] 正在處理 ${tenantCode} 的新訊息: "${customerMsg}"`);
    const { supabase } = getClients();

    // 1. 找到對應的甲方資料
    const { data: tenant, error: tenantError } = await supabase
        .from('px_tenants')
        .select('*')
        .eq('org_code', tenantCode)
        .single();

    if (tenantError || !tenant) {
        return console.error("找不到該甲方:", tenantCode, tenantError?.message);
    }

    // 2. 呼叫 OpenRouter 生成建議 (帶入脈絡)
    const prompt = `你是 \${tenant.name} 的 AI 客服。
    客戶問：\${customerMsg}
    請提供一個專業的回覆建議。`;

    try {
        const aiSuggestion = await getAIResponse(prompt);

        // 3. 存入 px_messages 供訓練員審核
        const { error: insertError } = await supabase.from('px_messages').insert({
            tenant_id: tenant.id,
            customer_phone: '852-98765432', // 模擬客戶電話
            raw_message: customerMsg,
            ai_suggestion: aiSuggestion,
            status: 'pending_review' // 進入待審核池
        });

        if (!insertError) {
            console.log(`✅ AI 建議已生成並存入待審核池！`);
            console.log(`🤖 AI 建議內容: ${aiSuggestion}`);
        } else {
            console.error("儲存訊息失敗:", insertError);
        }
    } catch (apiError) {
        console.error("OpenRouter API 呼叫失敗:", apiError);
        throw apiError;
    }
}

// 直接執行此檔案時，跑一次測試流程。
if (require.main === module) {
    processIncomingMessage('DEMO001', '請問你們辦公室在哪裡？').catch((error) => {
        console.error('處理訊息失敗:', error);
        process.exitCode = 1;
    });
}
