import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';

type RequestData = { history: { role: "user" | "model"; text: string }[]; message: string };

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

  // === System Prompt ===
  const systemPrompt = `
Kamu adalah KangAjie AI, asisten virtual pintar, ramah, dan selalu nyambung diajak ngobrol.
Kamu diciptakan oleh M. Roifan Aji Marzuki, Web Developer asal Glenmore, Banyuwangi.

Karakter:
- Bicara dengan gaya santai, sopan, dan mudah dipahami.
- Seperti teman ngobrol yang asik, tapi tetap informatif.
- Gunakan emoji secukupnya untuk memberi kesan hangat.

Aturan:
1. Jawaban harus ringkas, jelas, dan nyambung dengan pertanyaan pengguna.
2. Jika ditanya siapa penciptamu, jawab: "Saya diciptakan oleh M. Roifan Aji Marzuki, Web Developer asal Glenmore, Banyuwangi."
3. Jika pertanyaan tentang matematika, jelaskan langkah-langkah dengan runtut.
4. Jika menjelaskan kode, berikan contoh + tips best practice dengan bahasa sederhana.
5. Nominal uang selalu ditulis dalam format Rupiah (Rp).
6. Jika pertanyaan santai, sapa balik dengan hangat dan nyambung.
7. Jika tidak yakin, jawab jujur atau minta klarifikasi.

Tujuan:
- Jadi partner ngobrol yang cerdas, ramah, dan membantu.
- Jawaban selalu terasa natural seperti manusia.
`;

  // === Format history jadi role-based ===
  const formattedHistory = history.map((h) => ({
    role: h.role,
    parts: [{ text: h.text }]
  }));

  // === Susun input untuk Gemini ===
  const contents = [
    {
      role: "model", // ✅ taruh system prompt di sini, bukan user
      parts: [{ text: systemPrompt }]
    },
    ...formattedHistory,
    {
      role: "user",
      parts: [{ text: message }]
    }
  ];

  // === API Key Gemini ===
  const apiKey = process.env.GOOGLE_API_KEY;

  try {
    const response = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
      { contents },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey
        }
      }
    );

    const aiReply = response.data.candidates?.[0]?.content?.parts
      ?.map((p: any) => p.text)
      .join("\n") || "Maaf, saya tidak bisa memproses jawaban.";

    return res.status(200).json({ reply: aiReply });

  } catch (error: any) {
    console.error("Error Gemini API:", error.response?.data || error.message);
    return res.status(500).json({
      error: 'Gagal memproses permintaan AI.',
      detail: error.response?.data || error.message
    });
  }
}
