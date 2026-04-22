import { GoogleGenerativeAI } from "@google/generative-ai";

// 初始化 Gemini (請確保環境變量已設置)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// 如果你想手動指定 API 版本（選做，通常修改名稱即可）
const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash-latest",
});

// 加上這行診斷，看看環境變量到底有沒有讀到
console.log("Current Key Prefix:", process.env.GEMINI_API_KEY?.substring(0, 7));

export async function getPlexusResponse(customerMessage: string, tenantContext: string) {
  const prompt = `
    你現在是 "Plexus AI (脈絡智聯)" 旗下的專業 AI 客服訓練生。
    以下是這家公司的背景資訊：
    \${tenantContext}

    客戶問：\${customerMessage}

    請根據背景資訊給出專業、有禮貌的回答。如果資訊不足，請引導客戶留下聯絡方式，或等待人工客服接入。
  `;

  const result = await model.generateContent(prompt);
  const response = await result.response;
  return response.text();
}
