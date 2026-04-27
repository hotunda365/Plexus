import { getAIResponse } from './services/aiService';

export async function getPlexusResponse(customerMessage: string, tenantContext: string) {
  const prompt = `
    你現在是 "Plexus AI (脈絡智聯)" 旗下的專業 AI 客服訓練生。
    以下是這家公司的背景資訊：
    \${tenantContext}

    客戶問：\${customerMessage}

    請根據背景資訊給出專業、有禮貌的回答。如果資訊不足，請引導客戶留下聯絡方式，或等待人工客服接入。
  `;

  return getAIResponse(prompt);
}
