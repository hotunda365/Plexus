import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from 'dotenv';
import { resolve } from 'path';

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
    const genAI = new GoogleGenerativeAI(requireEnv('GEMINI_API_KEY'));
    return { supabase, genAI };
}

// 加上這行診斷，看看環境變量到底有沒有讀到
console.log("Current Key Prefix:", process.env.GEMINI_API_KEY?.substring(0, 7));

export async function processIncomingMessage(tenantCode: string, customerMsg: string) {
    console.log(`[Plexus] 正在處理 ${tenantCode} 的新訊息: "${customerMsg}"`);
    const { supabase, genAI } = getClients();

    // 1. 找到對應的甲方資料
    const { data: tenant, error: tenantError } = await supabase
        .from('px_tenants')
        .select('*')
        .eq('org_code', tenantCode)
        .single();

    if (tenantError || !tenant) {
        return console.error("找不到該甲方:", tenantCode, tenantError?.message);
    }

    // 2. 呼叫 Gemini 生成建議 (帶入脈絡)
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
    const prompt = `你是 \${tenant.name} 的 AI 客服。
    客戶問：\${customerMsg}
    請提供一個專業的回覆建議。`;

    try {
        const result = await model.generateContent(prompt);
        const aiSuggestion = result.response.text();

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
        console.error("Gemini API 呼叫失敗:", apiError);
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
