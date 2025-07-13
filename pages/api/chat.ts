import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';

// Format data riwayat chat dari frontend
type Part = { text: string };
type Message = {
  role: 'user' | 'model' | 'system';
  parts: Part[];
};

type RequestData = {
  history: Message[];
  message: string;
};

// Fungsi utama
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Hanya izinkan POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { history, message } = req.body as RequestData;

  if (!history || !Array.isArray(history) || !message) {
    return res.status(400).json({ error: 'Format request tidak valid.' });
  }

  // ✅ Pakai model andalan kamu
  const model = 'nousresearch/nous-hermes-2-mixtral-8x7b-dpo';

  // ✅ Prompt sistem awal
  const systemMessage: Message = {
    role: 'system',
    parts: [
      {
        text:
          'Kamu adalah Kang Ajie AI, asisten AI cerdas yang dapat menjawab pertanyaan dari berbagai topik. Jawabanmu harus sopan, profesional, dan mudah dimengerti, dalam bahasa Indonesia.',
      },
    ],
  };

  // Gabungkan sistem prompt dengan riwayat pengguna
  const fullHistory: Message[] = [systemMessage, ...history];

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
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://ai.kangajie.site', // Ganti sesuai domain kamu
          'X-Title': 'KangAjie AI',
        },
      }
    );

    const aiReply = response.data.choices?.[0]?.message?.content || '...';

    return res.status(200).json({ reply: aiReply });
  } catch (error: any) {
    console.error('OpenRouter Error:', error.response?.data || error.message);
    return res.status(500).json({ error: 'Gagal memproses permintaan AI' });
  }
}
