// @ts-nocheck
import type { NextApiRequest, NextApiResponse } from 'next';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Gunakan require untuk library tanpa types agar tidak error
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const officeParser = require('officeparser');

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // === 1. CORS Setup ===
  res.setHeader('Access-Control-Allow-Origin', 'https://ai.kangajie.site');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { message, history, fileData, mimeType } = req.body;

    // === 2. Konfigurasi Model (FIXED TYPESCRIPT ERROR) ===
    // Kita gunakan 'any' untuk mematikan validasi ketat pada config model
    const modelConfig: any = {
      model: "gemini-2.5-flash",
      systemInstruction: {
        parts: [{ text: `
          Kamu adalah Kang Ajie AI, asisten virtual cerdas.
          Dibuat oleh M. Roifan Aji Marzuki (Web Developer, Glenmore Banyuwangi).
          
          Instruksi:
          1. Jawab santai, jelas, informatif.
          2. Matematika: Langkah demi langkah.
          3. Uang: Format Rupiah (Rp).
          4. Kode: WAJIB pakai Code Block (\`\`\`).
          5. Analisis file secara mendalam jika ada.
        `}]
      }
    };

    const model = genAI.getGenerativeModel(modelConfig);

    let promptParts: any[] = [];
    let fileContext = "";

    // === 3. LOGIKA BACA FILE ===
    if (fileData && mimeType) {
      const base64Data = fileData.replace(/^data:.+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');

      // A. GAMBAR & PDF (Vision)
      if (mimeType.startsWith('image/') || mimeType === 'application/pdf') {
        promptParts.push({
          inlineData: {
            data: base64Data,
            mimeType: mimeType
          }
        });
      }
      
      // B. WORD (.docx)
      else if (mimeType.includes('word') || mimeType.includes('doc')) {
        try {
          const result = await mammoth.extractRawText({ buffer: buffer });
          fileContext = `\n\n[ISI FILE WORD]:\n${result.value}\n`;
        } catch (e: any) { console.error("Word Error:", e.message); }
      }

      // C. EXCEL (.xlsx)
      else if (mimeType.includes('sheet') || mimeType.includes('excel')) {
        try {
          const workbook = XLSX.read(buffer, { type: 'buffer' });
          const sheetName = workbook.SheetNames[0];
          const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
          fileContext = `\n\n[ISI FILE EXCEL]:\n${csv}\n`;
        } catch (e: any) { console.error("Excel Error:", e.message); }
      }

      // D. POWERPOINT (.pptx) - FIXED ERROR
      else if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) {
        try {
          const pptText = await new Promise((resolve, reject) => {
            // Gunakan library officeParser yang sudah di-require
            officeParser.parseOfficeBuffer(buffer, (data: any, err: any) => {
              if (err) reject(err);
              else resolve(data);
            });
          });
          fileContext = `\n\n[ISI FILE PPT (Teks Only)]:\n${pptText}\n`;
        } catch (e: any) { 
          console.error("PPT Error:", e);
          fileContext = "\n[Sistem: Gagal baca PPT. Coba ubah ke PDF]\n";
        }
      }

      // E. TEXT / KODING
      else if (mimeType.startsWith('text/') || mimeType.includes('json') || mimeType.includes('xml')) {
        fileContext = `\n\n[ISI FILE TEKS]:\n${buffer.toString('utf-8')}\n`;
      }
    }

    // === 4. GABUNG PESAN ===
    const finalMessage = (message || "Jelaskan isi file ini.") + fileContext;
    promptParts.push({ text: finalMessage });

    // === 5. KIRIM KE AI ===
    const chatHistory = (history || []).map((msg: any) => ({
      role: msg.role === 'ai' || msg.role === 'model' ? 'model' : 'user',
      parts: msg.parts.map((p: any) => ({ text: p.text }))
    }));

    const chatSession = model.startChat({ history: chatHistory });
    const result = await chatSession.sendMessage(promptParts);
    const textAnswer = result.response.text();

    return res.status(200).json({ reply: textAnswer });

  } catch (error: any) {
    console.error("🔥 ERROR:", error);
    return res.status(500).json({ 
      error: 'Backend Error', 
      details: error.message || String(error)
    });
  }
}