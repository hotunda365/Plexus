type OpenRouterMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type OpenRouterChoice = {
  message?: {
    content?: string;
  };
};

type OpenRouterResponse = {
  choices?: OpenRouterChoice[];
  error?: {
    message?: string;
  };
};

export async function getAIResponse(userPrompt: string): Promise<string> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': process.env.SITE_URL || '',
        'X-Title': process.env.SITE_NAME || 'Plexus AI',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || 'google/gemini-flash-1.5',
        messages: [
          { role: 'system', content: '你是一位專業的客戶服務助手。' } as OpenRouterMessage,
          { role: 'user', content: userPrompt } as OpenRouterMessage,
        ],
      }),
    });

    const data = (await response.json()) as OpenRouterResponse;

    if (!response.ok || data.error) {
      throw new Error(data.error?.message || `HTTP ${response.status}`);
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenRouter returned empty content');
    }

    return content;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('OpenRouter Error:', message);
    return `AI 暫時無法回應: ${message}`;
  }
}