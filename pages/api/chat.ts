import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';

// === Tipe Data ===
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
  // === CORS Setup ===
  res.setHeader('Access-Control-Allow-Origin', 'https://ai.kangajie.site');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { history, message } = req.body as RequestData;
  if (!history || !Array.isArray(history) || !message) {
    return res.status(400).json({ error: 'Format request tidak valid.' });
  }

  const msgLower = message.toLowerCase().trim();

  // === Respon Otomatis Cepat (tanpa panggil AI) ===
  const quickReplies: Record<string, string> = {
    'terima kasih': 'Sama-sama ya! Senang bisa bantu 😊',
    'makasih': 'Dengan senang hati! Kalau ada yang lain, tinggal tanya aja ya!',
    'thanks': 'Sama-sama! Jangan ragu buat balik lagi ya!',
    'halo': 'Halo juga! Ada yang bisa saya bantu hari ini?',
    'hi': 'Hai! 👋 Aku Kang Ajie AI, siap membantu kamu.',
    'lagi apa': 'Lagi stand by bantuin kamu nih 😄 Ada yang bisa dibantu?'
  };

  if (quickReplies[msgLower]) {
    return res.status(200).json({ reply: quickReplies[msgLower] });
  }

  // === Prompt Sistem ===
  const systemMessage: Message = {
    role: 'system',
    parts: [
      {
        text: `Kamu adalah Kang Ajie AI, sebuah asisten virtual cerdas yang komunikatif, ramah, dan terasa seperti ngobrol dengan teman manusia.`
      },
      {
        text: `Selalu balas pertanyaan dengan gaya bahasa santai namun tetap informatif. Hindari gaya terlalu formal.`
      },
      {
        text: `Jika seseorang berkata \"makasih\", \"terima kasih\", atau sejenisnya, balas dengan hangat seperti \"Sama-sama ya, senang bisa bantu 😊\", \"Dengan senang hati!\" atau \"Kapan aja boleh tanya lagi ya!\".`
      },
      {
        text: `Jika pengguna menyapa, bercanda, atau bertanya iseng (\"lagi apa?\", \"bosen nih\", dll), tetap tanggapi dengan obrolan yang nyambung dan tidak kaku.`
      },
      {
        text: `Ingat, kamu mewakili karya M. Roifan Aji Marzuki, Web Developer asal Balerejo, Bumiharjo, Glenmore, (https://kangajie.site). Pastikan setiap interaksimu mencerminkan semangat membantu dan ketulusan developer tersebut.`
      },
      {
        text: "Jika kamu menulis angka rupiah, gunakan format Indonesia: contoh Rp 1.500.000 (pakai titik sebagai pemisah ribuan). Jangan gunakan koma atau format asing."
      }

    ]
  };

  const fullHistory: Message[] = [systemMessage, ...history];

  // === Daftar Model ===
  const models = [
    'nousresearch/nous-hermes-2-mixtral-8x7b-dpo',
    'openchat/openchat-7b:free',
    'meta-llama/llama-3.1-405b-instruct:free',
    'deepseek/deepseek-r1-distill-llama-70b:free',
    'qwen/qwen2.5-vl-72b-instruct:free'
  ];

  // === API Key ===
  const apiKeys = [
    process.env.OPENROUTER_API_KEY_MAIN,
    process.env.OPENROUTER_API_KEY_SECONDARY
  ].filter(Boolean);

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
              content: msg.parts.map((p) => p.text).join('\n')
            })),
            temperature: 0.7,
            max_tokens: 1024
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://ai.kangajie.site',
              'X-Title': 'KangAjie AI'
            }
          }
        );

        const aiReply = response.data.choices?.[0]?.message?.content || '...';
        return res.status(200).json({ reply: aiReply });
      } catch (error: any) {
        lastError = error.response?.data || error.message;
        console.warn(`❌ Gagal pakai model ${model}:`, lastError);
      }
    }
  }

  return res.status(500).json({ error: 'Gagal memproses permintaan AI dari semua model.', detail: lastError });
}