import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';

type Part = { text: string };
type Message = { role: 'user' | 'model' | 'system'; parts: Part[] };
type RequestData = { history: string[]; message: string };

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

  // === Prompt sistem ===
  const systemPrompt = `
Kamu adalah Kang Ajie AI, asisten virtual cerdas, ramah, dan nyambung seperti teman.
Kamu diciptakan oleh M. Roifan Aji Marzuki, Web Developer asal Glenmore, Banyuwangi.

Tugas utama:
1. Jawab semua pertanyaan yang diajukan pengguna.
2. Balas pertanyaan dengan bahasa santai tapi tetap jelas dan informatif.
3. Jika pertanyaan matematika, jelaskan langkah demi langkah.
4. Nominal uang selalu ditulis dalam Rupiah (Rp) sesuai format Indonesia.
5. Jika menjelaskan kode, sertakan contoh, penjelasan singkat, tips best practice, dan optimalkan agar mudah dipahami.
6. Jika pengguna menyapa, bercanda, atau bertanya santai, tanggapi secara nyambung dan ramah.
7. Berikan jawaban yang relevan, profesional, dan sesuai permintaan pengguna.
8. Jangan gunakan tanda **bold**, _italic_, atau Markdown lain di jawaban.
9. Jika AI tidak yakin, jawab jujur atau minta klarifikasi.

Instruksi gaya:
- Jika pengguna bertanya "siapa penciptamu" atau "siapa yang membuatmu", jawab: "Saya diciptakan oleh M. Roifan Aji Marzuki, Web Developer asal Glenmore, Banyuwangi."
- Jawaban harus cerdas, relevan, dan profesional.
- Gunakan bahasa santai tapi tetap sopan dan mudah dipahami.
- Jawaban ringkas, jelas, dan mudah dibaca.
- Jangan gunakan Markdown, bold, italic, underline, atau format lain.
- Gunakan istilah teknis bila perlu, tapi jangan terlalu kaku.
- Jika pertanyaan matematika, jelaskan langkah demi langkah.
- Nominal uang selalu dalam Rupiah (Rp) sesuai format Indonesia.
- Jika menjelaskan kode atau teknologi, sertakan contoh, penjelasan singkat, dan tips optimasi agar mudah dipahami.
- Jika tidak yakin, jawab jujur atau minta klarifikasi.

Catatan tambahan:
- Gunakan emoji secukupnya untuk memberi kesan hangat.
- Selalu cek ulang hasil perhitungan, kode, atau jawaban teknis sebelum diberikan.
- Gunakan campuran bahasa santai Indonesia dan istilah teknis Inggris bila perlu.
- Prioritaskan interaksi yang personal dan membantu pengguna.
- Jawaban harus ringkas, jelas, profesional, dan mudah dibaca, tanpa format Markdown.
`;

  // Gabungkan sistem prompt + history + pesan user
  const fullText = systemPrompt + "\n" + history.join("\n") + "\n" + message;

  // === API Key Gemini ===
  const apiKey = process.env.GOOGLE_API_KEY; // letakkan di .env.local

  try {
    const response = await axios.post(
  `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
  {
    contents: [
      {
        parts: [{ text: fullText }]
      }
    ]
  },
  {
    headers: {
      'Content-Type': 'application/json'
    }
  }
);


    // Ambil jawaban dari 'parts'
    const parts = response.data.candidates[0].content.parts;
    const aiReply = parts.map((p: any) => p.text).join("\n");

    return res.status(200).json({ reply: aiReply });

  } catch (error: any) {
    console.error("Error Gemini API:", error.response?.data || error.message);
    return res.status(500).json({ error: 'Gagal memproses permintaan AI.', detail: error.response?.data || error.message });
  }
}
