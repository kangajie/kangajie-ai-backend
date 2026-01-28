import type { NextApiRequest, NextApiResponse } from 'next';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';

// Inisialisasi Google AI Client
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // === 1. CORS Setup (Penting agar frontend bisa akses) ===
  res.setHeader('Access-Control-Allow-Origin', 'https://ai.kangajie.site'); // Ganti * jika masih dev
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    // === 2. Tangkap Data dari Frontend ===
    const { message, history, fileData, mimeType } = req.body;

    // === 3. Konfigurasi Model ===
    // Gunakan 'gemini-2.5-flash' (Cepat, Murah, Support Gambar/PDF)
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: {
        role: "system",
        parts: [{ text: `
          Kamu adalah Kang Ajie AI, asisten virtual cerdas, ramah, dan nyambung seperti teman.
          Kamu diciptakan oleh M. Roifan Aji Marzuki, Web Developer asal Glenmore, Banyuwangi.

          Aturan Utama:
          1. Jawab santai, jelas, informatif.
          2. Matematika: Jelaskan langkah demi langkah.
          3. Uang: Gunakan format Rupiah (Rp).
          4. Kode: Berikan contoh & best practice.
          5. Style: JANGAN gunakan Markdown Bold (**teks**) atau Italic (*teks*) di narasi biasa agar bersih. 
             TAPI, untuk Kode Program (coding), WAJIB gunakan Code Block (\`\`\`) agar mudah disalin.
          6. Jika ada gambar/dokumen, analisislah sesuai permintaan user.
        `}]
      }
    });

    // === 4. Proses Chat & History ===
    // Ubah format history frontend ke format Gemini SDK
    // Frontend mengirim: [{role: 'user', parts: [{text: '...'}]}, ...]
    // Kita pastikan formatnya aman
    const chatHistory = (history || []).map((msg: any) => ({
      role: msg.role === 'ai' ? 'model' : 'user', // Pastikan mapping role benar
      parts: msg.parts.map((p: any) => ({ text: p.text })) // Hanya ambil teks untuk history (gambar lama tidak perlu dikirim ulang untuk hemat token)
    }));

    const chatSession = model.startChat({
      history: chatHistory,
      generationConfig: {
        maxOutputTokens: 1000,
      },
    });

    // === 5. Siapkan Pesan Baru (Teks + Gambar jika ada) ===
    let parts: any[] = [];

    // A. Cek apakah ada file (Gambar/PDF)
    if (fileData && mimeType) {
      // Frontend mengirim format: "data:image/png;base64,Base64String..."
      // Kita harus membuang header "data:image/..." untuk mendapatkan murni base64
      const base64Data = fileData.split(',')[1]; 

      parts.push({
        inlineData: {
          data: base64Data,
          mimeType: mimeType
        }
      });
    }

    // B. Masukkan Teks User
    if (message) {
      parts.push({ text: message });
    }

    // === 6. Kirim ke AI ===
    const result = await chatSession.sendMessage(parts);
    const response = await result.response;
    const textAnswer = response.text();

    // === 7. Kirim Balasan ke Frontend ===
    return res.status(200).json({ reply: textAnswer });

  } catch (error: any) {
    console.error("Error AI Backend:", error);
    return res.status(500).json({ 
      error: 'Terjadi kesalahan pada AI.', 
      details: error.message 
    });
  }
}