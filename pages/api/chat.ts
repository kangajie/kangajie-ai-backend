// @ts-nocheck
import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import mammoth from 'mammoth'; // Baca Word
import * as XLSX from 'xlsx';  // Baca Excel

// Kita skip officeparser dulu untuk mencegah server hang
// import officeParser from 'officeparser'; 

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb', // Penting! Izinkan file agak besar
    },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', 'https://ai.kangajie.site');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  console.log("1. Request Masuk..."); // LOGGING

  try {
    const { history, message, fileData, mimeType } = req.body;
    const apiKey = process.env.GOOGLE_API_KEY;

    if (!apiKey) throw new Error("API Key hilang!");

    // === SYSTEM PROMPT ===
    const systemPrompt = `
      Kamu adalah Kang Ajie AI. Dibuat oleh M. Roifan Aji Marzuki (Web Developer, Glenmore).
      Jawab santai, jelas, Rupiah (Rp), dan gunakan Code Block (\`\`\`) untuk kodingan.
    `;

    // === LOGIKA FILE ===
    let fileTextContext = "";
    let inlineImagePart = null;

    if (fileData && mimeType) {
      console.log(`2. Ada file terdeteksi: ${mimeType}`); // LOGGING
      
      const cleanBase64 = fileData.replace(/^data:.+;base64,/, '');
      const buffer = Buffer.from(cleanBase64, 'base64');

      // A. GAMBAR / PDF -> Kirim sebagai Inline Data
      if (mimeType.startsWith('image/') || mimeType === 'application/pdf') {
        console.log("   - Tipe Visual (Gambar/PDF)");
        inlineImagePart = {
          inline_data: {
            mime_type: mimeType,
            data: cleanBase64
          }
        };
      } 
      // B. WORD -> Ekstrak Teks
      else if (mimeType.includes('word') || mimeType.includes('doc')) {
        console.log("   - Tipe Word, mencoba ekstrak...");
        try {
          const result = await mammoth.extractRawText({ buffer });
          fileTextContext = `\n\n[ISI FILE WORD]:\n${result.value}\n`;
        } catch (e) {
          console.error("   ! Gagal baca Word:", e);
          fileTextContext = "\n[Gagal membaca file Word, mungkin file rusak]\n";
        }
      }
      // C. EXCEL -> Ekstrak Teks
      else if (mimeType.includes('sheet') || mimeType.includes('excel')) {
        console.log("   - Tipe Excel, mencoba ekstrak...");
        try {
          const workbook = XLSX.read(buffer, { type: 'buffer' });
          const sheetName = workbook.SheetNames[0];
          const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
          fileTextContext = `\n\n[ISI FILE EXCEL]:\n${csv}\n`;
        } catch (e) {
          console.error("   ! Gagal baca Excel:", e);
        }
      }
      // D. PPT (SKIP DULU AGAR STABIL)
      else if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) {
         fileTextContext = "\n[Info: Untuk file PPT, mohon 'Save As PDF' lalu upload ulang agar bisa saya baca]\n";
      }
      // E. TEXT
      else if (mimeType.startsWith('text/') || mimeType.includes('json')) {
        fileTextContext = `\n\n[ISI FILE TEKS]:\n${buffer.toString('utf-8')}\n`;
      }
    }

    // === RAKIT PROMPT (GAYA AXIOS LAMA) ===
    console.log("3. Merakit Prompt..."); // LOGGING
    
    // Gabung history jadi satu string panjang (ini cara paling aman buat Axios manual)
    const historyText = Array.isArray(history) 
      ? history.map(h => (typeof h === 'string' ? h : h.parts?.[0]?.text || "")).join("\n") 
      : "";

    // Prompt Akhir
    const finalPrompt = `${systemPrompt}\n${historyText}\nUser: ${message}\n${fileTextContext}`;

    // Susun Parts untuk JSON Gemini
    const parts = [];
    if (inlineImagePart) parts.push(inlineImagePart); // Masukkan gambar/pdf kalau ada
    parts.push({ text: finalPrompt });                // Masukkan teks

    // === KIRIM AXIOS ===
    console.log("4. Mengirim ke Google Gemini..."); // LOGGING
    
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        contents: [{ parts: parts }]
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000 // Timeout 60 detik biar gak gampang putus
      }
    );

    console.log("5. Dapat Balasan!"); // LOGGING

    if (response.data?.candidates?.[0]?.content?.parts) {
      const reply = response.data.candidates[0].content.parts.map((p: any) => p.text).join("\n");
      return res.status(200).json({ reply });
    } else {
      return res.status(200).json({ reply: "Maaf, tidak ada respon dari AI." });
    }

  } catch (error: any) {
    console.error("!!! ERROR BACKEND !!!", error.response?.data || error.message);
    
    // Kirim pesan error ke frontend biar muncul di chat bubble
    return res.status(200).json({ 
      reply: `⚠️ **Sistem Error:**\n${error.message || "Gagal memproses permintaan."}\n(Cek Terminal untuk detail)` 
    });
  }
}