import { Request, Response } from 'express';

// 這是在 Meta 開發者後台你自己設定的隨機字串
const VERIFY_TOKEN = 'PlexusAI_2026_Verify';

export const handleWhatsAppWebhook = async (req: Request, res: Response) => {
  // --- 處理 Meta 的驗證請求 (GET) ---
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('Webhook 驗證成功');
        return res.status(200).send(challenge);
      }
      return res.sendStatus(403);
    }
  }

  // --- 處理來自客戶的訊息 (POST) ---
  if (req.method === 'POST') {
    const body = req.body;

    // 檢查這是否為 WhatsApp 的訊息事件
    if (body.object === 'whatsapp_business_account') {
      if (
        body.entry &&
        body.entry[0].changes &&
        body.entry[0].changes[0].value.messages &&
        body.entry[0].changes[0].value.messages[0]
      ) {
        const msg = body.entry[0].changes[0].value.messages[0];
        const from = msg.from; // 客戶電話
        const text = msg.text?.body; // 訊息內容

        console.log(`收到來自 ${from} 的訊息: ${text}`);

        // TODO: 在這裡呼叫你的存入 Supabase 邏輯
        // 暫時不接 AI，直接回傳一個收悉確認即可
      }
      return res.sendStatus(200);
    }
    return res.sendStatus(404);
  }

  return res.sendStatus(405);
};
