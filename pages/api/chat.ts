import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';

// 1. CONFIG: WAJIB ADA untuk mengizinkan upload file > 1MB
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb', // Kita naikkan jadi 10MB biar tidak error saat upload
    },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // === CORS Setup ===
  res.setHeader('Access-Control-Allow-Origin', 'https://ai.kangajie.site');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { history, message, fileData, mimeType } = req.body;
    const apiKey = process.env.GOOGLE_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "API Key Google hilang di server." });
    }

    // === 2. SYSTEM PROMPT ===
    const systemPrompt = `
      Kamu adalah Kang Ajie AI. Dibuat oleh M. Roifan Aji Marzuki (Web Developer, Glenmore).
      Jawab santai, jelas, gunakan Rupiah (Rp), dan Code Block (\`\`\`) untuk kodingan.
      Jangan gunakan Bold/Italic berlebihan.
    `;

    // === 3. SIAPKAN DATA UNTUK AXIOS ===
    let contentsParts = [];

    // A. Masukkan File (Jika Ada)
    // Gemini Native support: Image (PNG/JPG) & PDF
    if (fileData && mimeType) {
      // Bersihkan header "data:image/png;base64," agar murni base64
      const cleanBase64 = fileData.replace(/^data:.+;base64,/, '');
      
      contentsParts.push({
        inline_data: {
          mime_type: mimeType,
          data: cleanBase64
        }
      });
    }

    // B. Gabungkan History & Pesan User ke Prompt Teks
    // (Cara manual Axios paling aman: gabung jadi satu string panjang context)
    let contextHistory = "";
    if (Array.isArray(history) && history.length > 0) {
      contextHistory = history.map(h => {
        // Handle format history yang mungkin berbeda
        const text = typeof h === 'string' ? h : (h.parts?.[0]?.text || "");
        const role = h.role === 'model' ? 'AI' : 'User';
        return `${role}: ${text}`;
      }).join("\n");
    }

    const finalPrompt = `${systemPrompt}\n\nRiwayat Chat:\n${contextHistory}\n\nUser Baru: ${message}`;
    
    // Masukkan Teks ke Parts
    contentsParts.push({ text: finalPrompt });

    // === 4. KIRIM KE GOOGLE (Versi 1.5 Flash - Paling Stabil) ===
    // Saya pakai 1.5 dulu. Kalau ini jalan, baru nanti Anda ubah ke 2.5.
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const response = await axios.post(
      url,
      {
        contents: [{ parts: contentsParts }]
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000 // 60 detik timeout
      }
    );

    // === 5. AMBIL JAWABAN ===
    const candidates = response.data?.candidates;
    if (candidates && candidates.length > 0) {
      const aiReply = candidates[0].content.parts.map((p: any) => p.text).join("\n");
      return res.status(200).json({ reply: aiReply });
    } else {
      return res.status(200).json({ reply: "Maaf, AI tidak memberikan respon (Kosong)." });
    }

  } catch (error: any) {
    console.error("ERROR BACKEND:", error.response?.data || error.message);
    
    // Tampilkan error ke frontend agar kita tahu salahnya dimana
    return res.status(500).json({ 
      error: 'Gagal memproses.', 
      details: error.response?.data?.error?.message || error.message 
    });
  }
}