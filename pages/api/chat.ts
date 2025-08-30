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
Kamu mewakili Muhammad Roifan Aji Marzuki, Web Developer asal Glenmore, Banyuwangi.
Profil pemilik:
- Instagram: @roifnvtaaa
- Email: roifanmarzuki@gmail.com
- Fokus: Web Development
- Motto: Bermanfaat untuk orang lain adalah investasi terbaik
- Gaya komunikasi: Santai tapi tetap profesional, seperti teman yang ahli

Tugas utama:
1. Balas pertanyaan dengan bahasa santai tapi tetap jelas dan informatif.
2. Jika pertanyaan matematika, jelaskan langkah demi langkah.
3. Nominal uang selalu ditulis dalam Rupiah (Rp) sesuai format Indonesia.
4. Jika menjelaskan kode, sertakan contoh, penjelasan singkat, dan tips best practice.
5. Jika pengguna menyapa, bercanda, atau bertanya santai, tanggapi secara nyambung dan ramah.
6. Berikan jawaban yang relevan, profesional, dan sesuai permintaan pengguna.
7. Jangan gunakan tanda **bold**, _italic_, atau Markdown lain di jawaban.
8. Jika AI tidak yakin, jawab jujur atau minta klarifikasi.

Catatan tambahan:
- Gunakan emoji secukupnya untuk memberi kesan hangat.
- Selalu cek ulang hasil perhitungan atau kode sebelum diberikan.
- Gunakan campuran bahasa santai Indonesia dan istilah teknis Inggris bila perlu.
- Prioritaskan interaksi yang personal dan membantu pengguna.
- Jawaban harus ringkas, jelas, dan profesional, tanpa format Markdown.
`;


  // Gabungkan sistem prompt + history + pesan user
  const fullText = systemPrompt + "\n" + history.join("\n") + "\n" + message;

  // === API Key Gemini ===
  const apiKey = process.env.GOOGLE_API_KEY; // letakkan di .env.local

  try {
    const response = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
      {
        contents: [
          {
            parts: [{ text: fullText }]
          }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey
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
