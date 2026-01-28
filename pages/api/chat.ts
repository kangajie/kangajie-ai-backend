// @ts-nocheck
import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';

// Import Library Pembaca File (Kita pakai require biar gak error TS)
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const officeParser = require('officeparser');

type Part = { text?: string; inline_data?: { mime_type: string; data: string } };
type RequestData = { history: any[]; message: string; fileData?: string; mimeType?: string };

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

  // Ambil data termasuk fileData dan mimeType
  const { history, message, fileData, mimeType } = req.body as RequestData;

  // === 1. SYSTEM PROMPT (Tetap Punya Kamu) ===
  const systemPrompt = `
    Kamu adalah Kang Ajie AI, asisten virtual cerdas, ramah, dan nyambung seperti teman.
    Kamu diciptakan oleh M. Roifan Aji Marzuki, Web Developer asal Glenmore, Banyuwangi.

    Tugas utama:
    1. Jawab santai tapi jelas dan informatif.
    2. Matematika: Jelaskan langkah demi langkah.
    3. Uang: Format Rupiah (Rp).
    4. Kode: WAJIB gunakan Code Block (\`\`\`).
    5. Jangan gunakan Bold/Italic, TAPI WAJIB Code Block untuk kodingan.
    6. Analisis file yang dikirim dengan detail.
  `;

  // === 2. LOGIKA BACA FILE (EXTRACTION) ===
  let fileTextContext = ""; // Penampung teks dari Word/Excel/PPT
  let imagePart = null;     // Penampung untuk Gambar/PDF (Inline Data)

  if (fileData && mimeType) {
    // Bersihkan header base64
    const cleanBase64 = fileData.replace(/^data:.+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');

    // A. GAMBAR & PDF (Untuk dikirim Native via JSON)
    if (mimeType.startsWith('image/') || mimeType === 'application/pdf') {
      imagePart = {
        inline_data: {
          mime_type: mimeType,
          data: cleanBase64
        }
      };
    }
    
    // B. WORD (.docx) -> Ekstrak jadi Teks
    else if (mimeType.includes('word') || mimeType.includes('doc')) {
      try {
        const result = await mammoth.extractRawText({ buffer });
        fileTextContext = `\n\n[ISI FILE WORD]:\n${result.value}\n`;
      } catch (e) { console.error("Word Fail:", e); }
    }

    // C. EXCEL (.xlsx) -> Ekstrak jadi CSV Teks
    else if (mimeType.includes('sheet') || mimeType.includes('excel')) {
      try {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
        fileTextContext = `\n\n[ISI FILE EXCEL]:\n${csv}\n`;
      } catch (e) { console.error("Excel Fail:", e); }
    }

    // D. PPT (.pptx) -> Ekstrak jadi Teks
    else if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) {
      try {
        const pptText = await new Promise((resolve, reject) => {
          officeParser.parseOfficeBuffer(buffer, (data, err) => {
            if (err) reject(err); else resolve(data);
          });
        });
        fileTextContext = `\n\n[ISI FILE PPT]:\n${pptText}\n`;
      } catch (e) { console.error("PPT Fail:", e); }
    }

    // E. Text/Coding -> Decode Teks
    else if (mimeType.startsWith('text/') || mimeType.includes('json') || mimeType.includes('xml')) {
      fileTextContext = `\n\n[ISI FILE TEKS]:\n${buffer.toString('utf-8')}\n`;
    }
  }

  // === 3. RAKIT TEXT PROMPT ===
  // Gabungkan: System Prompt + History (jika array string) + Pesan User + Isi File (Jika ada)
  
  // Tips: History biasanya array object, kita ambil text-nya saja untuk digabung ke prompt sederhana
  // Atau jika format history kamu string array, biarkan join.
  let historyText = "";
  if (Array.isArray(history)) {
      // Cek apakah history isinya string atau object
      historyText = history.map(h => (typeof h === 'string' ? h : h.parts?.[0]?.text || "")).join("\n");
  }

  const finalPromptText = `${systemPrompt}\n${historyText}\nUser: ${message}\n${fileTextContext}`;

  // === 4. RAKIT PARTS UNTUK AXIOS ===
  const partsToSend: any[] = [];
  
  // Jika ada gambar/PDF, masukkan duluan
  if (imagePart) {
    partsToSend.push(imagePart);
  }
  
  // Masukkan teks prompt
  partsToSend.push({ text: finalPromptText });

  const apiKey = process.env.GOOGLE_API_KEY;

  try {
    // === 5. KIRIM KE GEMINI (AXIOS) ===
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        contents: [
          {
            parts: partsToSend
          }
        ]
      },
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );

    // Ambil jawaban
    const candidates = response.data.candidates;
    if (!candidates || candidates.length === 0) {
      return res.status(200).json({ reply: "Maaf, saya tidak bisa memberikan jawaban saat ini." });
    }

    const aiReply = candidates[0].content.parts.map((p: any) => p.text).join("\n");
    return res.status(200).json({ reply: aiReply });

  } catch (error: any) {
    console.error("Error Axios Gemini:", error.response?.data || error.message);
    return res.status(500).json({ 
      error: 'Gagal memproses.', 
      detail: error.response?.data || error.message 
    });
  }
}