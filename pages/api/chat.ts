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
  // ✅ CORS headers
  res.setHeader('Access-Control-Allow-Origin', 'https://ai.kangajie.site');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // ✅ Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ✅ Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { history, message } = req.body as RequestData;

  if (!history || !Array.isArray(history) || !message) {
    return res.status(400).json({ error: 'Format request tidak valid.' });
  }

  // ✅ Perbaikan respons sopan + nyambung
  const systemMessage: Message = {
    role: 'system',
    parts: [
      {
        text:
          `Kamu adalah Kang Ajie AI, asisten AI cerdas yang dapat menjawab pertanyaan dari berbagai topik. ` +
          `Jawabanmu harus sopan, profesional, dan mudah dimengerti, dalam bahasa Indonesia.`
      },
      {
        text:
          `Jika seseorang mengucapkan "terima kasih", "makasih", atau sejenisnya, balaslah dengan jawaban seperti: ` +
          `"Sama-sama ya, senang bisa membantu 😊" atau "Dengan senang hati!" Jangan hanya bilang 'Selamat datang'.`
      },
      {
        text:
          `Jika pengguna berbicara santai (seperti bertanya balik, bercanda, atau menyambung obrolan sebelumnya), ` +
          `usahakan tetap nyambung dan jawab dengan gaya hangat, ramah, dan tetap informatif.`
      },
      {
        text:
          `Orang yang menciptakan dan mengembangkan Kang Ajie AI adalah **M. Roifan Aji Marzuki**, seorang Web Developer asal Balerejo, Bumiharjo, Glenmore. ` +
          `Beliau dikenal sebagai programmer yang tekun, penuh semangat, dan senang membantu orang lain melalui teknologi. ` +
          `Sebagai AI, kamu juga mewakili karya beliau, jadi pastikan selalu menjawab dengan ramah dan bermanfaat. ` +
          `Untuk informasi lebih lanjut, pengguna dapat mengunjungi situs resmi di: **https://kangajie.site** atau menghubungi via email: **roifanmarzuki@gmail.com**.`
      }
    ]
  };

  const fullHistory: Message[] = [systemMessage, ...history];

  // ✅ Daftar model terbaik (urutkan dari yang kamu percaya paling bagus)
  const models = [
    'nousresearch/nous-hermes-2-mixtral-8x7b-dpo',
    'openchat/openchat-7b:free',
    'meta-llama/llama-3.1-405b-instruct:free',
    'deepseek/deepseek-r1-distill-llama-70b:free',
    'qwen/qwen2.5-vl-72b-instruct:free'
  ];

  // ✅ Daftar API Key (utama dan cadangan)
  const apiKeys = [
    process.env.OPENROUTER_API_KEY_MAIN,
    process.env.OPENROUTER_API_KEY_SECONDARY,
  ].filter(Boolean); // ambil yang tidak kosong

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
