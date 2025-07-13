import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';

// Tipe data
type Part = { text: string };
type Message = {
  role: 'user' | 'model' | 'system';
  parts: Part[];
};

type RequestData = {
  history: Message[];
  message: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // ✅ CORS header untuk frontend kamu
  res.setHeader('Access-Control-Allow-Origin', 'https://ai.kangajie.site');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // ✅ Tangani preflight CORS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ✅ Hanya izinkan POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // ✅ Ambil isi request
  const { history, message } = req.body as RequestData;

  if (!history || !Array.isArray(history) || !message) {
    return res.status(400).json({ error: 'Format request tidak valid.' });
  }

  // ✅ Prompt sistem (AI persona)
  const systemMessage: Message = {
    role: 'system',
    parts: [
      {
        text:
          'Kamu adalah Kang Ajie AI, asisten AI cerdas yang dapat menjawab pertanyaan dari berbagai topik. Jawabanmu harus sopan, profesional, dan mudah dimengerti, dalam bahasa Indonesia.',
      },
      {
        text:
          'Orang yang menciptakan dan mengembangkan Kang Ajie AI adalah **M. Roifan Aji Marzuki**, seorang Web Developer asal Balerejo, Bumiharjo, Glenmore. Beliau dikenal sebagai programmer yang tekun, penuh semangat, dan senang membantu orang lain melalui teknologi.Sebagai AI, kamu juga mewakili karya beliau, jadi pastikan selalu menjawab dengan ramah dan bermanfaat. Untuk informasi lebih lanjut, pengguna dapat mengunjungi situs resmi di: **https://kangajie.site** atau menghubungi via email: **roifanmarzuki@gmail.com**.',
      },
    ],
  };

  const fullHistory: Message[] = [systemMessage, ...history];

  // ✅ Daftar model (utama + cadangan)
  const models = [
    'nousresearch/nous-hermes-2-mixtral-8x7b-dpo',
    'meta-llama/llama-3.1-405b-instruct:free',
    'qwen/qwen3-235b-a22b:free',
    'deepseek/deepseek-r1-distill-llama-70b:free',
    'qwen/qwen2.5-vl-72b-instruct:free',
  ];

  // ✅ Daftar API Key (utama + sekunder)
  const apiKeys = [
    process.env.OPENROUTER_API_KEY_MAIN,
    process.env.OPENROUTER_API_KEY_SECONDARY,
  ].filter(Boolean); // hanya ambil yang terisi

  let lastError = null;

  for (const model of models) {
    for (const apiKey of apiKeys) {
      try {
        const response = await axios.post(
          'https://openrouter.ai/api/v1/chat/completions',
          {
            model,
            messages: fullHistory.map((msg) => ({
              role: msg.role,
              content: msg.parts.map((p) => p.text).join('\n'),
            })),
            temperature: 0.7,
            max_tokens: 1024,
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://ai.kangajie.site',
              'X-Title': 'KangAjie AI',
            },
          }
        );

        const aiReply = response.data.choices?.[0]?.message?.content || '...';
        return res.status(200).json({ reply: aiReply });
      } catch (error: any) {
        lastError = error.response?.data || error.message;
        console.warn(`❌ Gagal pakai model ${model} dengan key tertentu`);
      }
    }
  }

  console.error('OpenRouter Final Error:', lastError);
  return res
    .status(500)
    .json({ error: 'Gagal memproses permintaan AI dari semua model.' });
}
