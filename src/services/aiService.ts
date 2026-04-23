export const getAIResponse = async (prompt: string) => {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://plexus-connect.zeabur.app',
      'X-Title': 'Plexus AI',
    },
    body: JSON.stringify({
      model: 'google/gemini-flash-1.5',
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await response.json();
  return data.choices[0]?.message?.content || 'AI 暫時無法回應';
}