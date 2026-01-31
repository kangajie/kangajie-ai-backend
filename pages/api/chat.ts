// @ts-nocheck
import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';

// Library Pembaca File
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const officeParser = require('officeparser');

// === DEFINISI TIPE ===
type Part = { text?: string; inline_data?: { mime_type: string; data: string } };
type Message = { role: 'user' | 'model'; parts: Part[] | string; message?: string };
type RequestData = { 
  history: Message[]; 
  message: string; 
  fileData?: string; 
  mimeType?: string; 
  userName?: string; 
};

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // === CORS ===
  res.setHeader('Access-Control-Allow-Origin', 'https://ai.kangajie.site');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { history, message, fileData, mimeType, userName } = req.body as RequestData;

  // === [LOGIKA BARU] ROTASI API KEY ===
  // Masukkan semua key kamu ke dalam Array ini
  const apiKeys = [
    process.env.GOOGLE_API_KEY_1,   // Key 1
    process.env.GOOGLE_API_KEY_2, // Key 2
    process.env.GOOGLE_API_KEY_3,  // Key 3
    process.env.GOOGLE_API_KEY_4  // Key 4
  ].filter(key => key); // Filter biar gak error kalau ada yg kosong

  if (apiKeys.length === 0) return res.status(500).json({ error: 'Tidak ada API Key yang tersedia.' });

  // Setup Nama User
  const userPanggilan = userName || "Sobat AI";

  // === SYSTEM PROMPT ===
  const systemPrompt = `
    Kamu adalah KangAjie AI.
    Penciptamu adalah M. Roifan Aji Marzuki
    Tugasmu adalah membantu menjawab pertanyaan, memberikan informasi, dan berdiskusi dengan pengguna secara ramah dan informatif.
    
    INFORMASI LAWAN BICARA:
    Kamu sedang berbicara dengan: "${userPanggilan}".
    Sapa dia dengan namanya sesekali agar terasa akrab.
    
    Gaya: Santai, Jelas, Informatif.
  `;

  // === PROSES FILE ===
  let fileTextContext = "";
  let visualPart = null;

  if (fileData && mimeType) {
    try {
      const cleanBase64 = fileData.replace(/^data:.+;base64,/, '');
      const buffer = Buffer.from(cleanBase64, 'base64');

      if (mimeType.startsWith('image/') || mimeType === 'application/pdf') {
        visualPart = { inline_data: { mime_type: mimeType, data: cleanBase64 } };
      } else if (mimeType.includes('word')) {
        const result = await mammoth.extractRawText({ buffer });
        fileTextContext = `\n\n[ISI FILE WORD]:\n${result.value}\n`;
      } else if (mimeType.includes('sheet') || mimeType.includes('excel')) {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
        fileTextContext = `\n\n[ISI FILE EXCEL]:\n${csv}\n`;
      } else if (mimeType.includes('presentation')) {
        const pptText = await new Promise((resolve, reject) => {
           officeParser.parseOfficeBuffer(buffer, (data, err) => { if (err) reject(err); else resolve(data); });
        });
        fileTextContext = `\n\n[ISI SLIDE PPT]:\n${pptText}\n`;
      } else if (mimeType.startsWith('text/')) {
        fileTextContext = `\n\n[ISI FILE TEKS]:\n${buffer.toString('utf-8')}\n`;
      }
    } catch (e) { console.error("File Read Error:", e); }
  }

  // === RAKIT PROMPT ===
  let historyText = "";
  if (Array.isArray(history) && history.length > 0) {
    historyText = history.map(h => {
      let text = "";
      if (typeof h === 'string') text = h;
      else if (typeof h.message === 'string') text = h.message;
      else if (Array.isArray(h.parts) && h.parts.length > 0 && h.parts[0].text) text = h.parts[0].text;
      
      const role = h.role === 'model' ? 'KangAjie' : 'User';
      return `${role}: ${text}`;
    }).join("\n");
  }

  const finalPromptText = `${systemPrompt}\n\n=== RIWAYAT ===\n${historyText}\n${fileTextContext}\n\nUser (${userPanggilan}): ${message}`;
  
  const partsToSend: any[] = [];
  if (visualPart) partsToSend.push(visualPart);
  partsToSend.push({ text: finalPromptText });

  // === EKSEKUSI REQUEST DENGAN SISTEM ROTASI KEY ===
  let aiReply = null;
  let activeKey = ""; // Untuk tau key mana yang berhasil
  let lastError = null;

  // Loop mencoba setiap key
  for (const key of apiKeys) {
    try {
        console.log(`Mencoba request dengan Key: ...${key?.slice(-4)}`);
        
        const response = await axios.post(
          `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${key}`,
          { contents: [{ parts: partsToSend }] },
          { headers: { 'Content-Type': 'application/json' }, timeout: 60000 }
        );

        aiReply = response.data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("\n");
        activeKey = key; // Simpan key yang sukses buat generate judul nanti
        break; // SUKSES! Keluar dari loop

    } catch (error: any) {
        lastError = error;
        // Jika errornya 429 (Limit Habis), lanjut ke key berikutnya
        if (error.response?.status === 429) {
            console.warn(`⚠️ Key ...${key?.slice(-4)} Limit Habis! Ganti ke key cadangan...`);
            continue; // Coba key selanjutnya
        } else {
            // Jika error lain (misal 400 Bad Request), stop jangan paksa lanjut
            console.error("Error Fatal:", error.message);
            break; 
        }
    }
  }

  // Jika setelah semua key dicoba tetap gagal
  if (!aiReply) {
      console.error("SEMUA API KEY HABIS/ERROR");
      if (lastError?.response?.status === 429) {
          return res.status(200).json({ 
             reply: "⚠️ **Semua Jalur Sibuk.**\nMaaf, server sedang sangat padat (Semua API Key limit). Mohon tunggu 1 menit lagi ya." 
          });
      }
      return res.status(500).json({ error: 'Gagal', detail: lastError?.message });
  }

  // === GENERATE JUDUL (Pakai Key yang tadi berhasil) ===
  // let generatedTitle = null;
  // if (!history || history.length <= 1) {
  //    try {
  //      const titleRes = await axios.post(
  //         `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${activeKey}`,
  //         { 
  //           contents: [{ parts: [{ text: `Buatkan judul sangat pendek (3-4 kata) untuk topik ini: "${message}". Tanpa tanda kutip.` }] }] 
  //         },
  //         { headers: { 'Content-Type': 'application/json' } }
  //      );
  //      generatedTitle = titleRes.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim().replace(/[*"]/g, '');
  //    } catch (e) {
  //      console.error("Gagal buat judul:", e);
  //    }
  // }

  // versi galak
  // === GENERATE JUDUL (UPDATE: LEBIH STRICT/KETAT) ===
  let generatedTitle = null;
  
  // Hanya generate jika ini adalah pesan pertama (history kosong atau panjang <= 1)
  if (!history || history.length <= 1) {
     try {
       console.log("Sedang membuat judul untuk:", message); // Debugging

       const titleRes = await axios.post(
          `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${activeKey}`,
          { 
            contents: [{ parts: [{ 
                // --- BAGIAN INI YANG DIPERBAIKI ---
                text: `Tugasmu adalah membuat LABEL TOPIK.
                
                Aturan:
                1. Maksimal 3-4 kata saja.
                2. JANGAN membuat kalimat lengkap.
                3. JANGAN mengulang pertanyaan user.
                4. Langsung ke inti (Keywords).
                5. Jangan pakai tanda kutip.
                
                Contoh Input: "Bagaimana cara membuat nasi goreng yang enak?"
                Output Kamu: "Resep Nasi Goreng"
                
                Contoh Input: "Saya mau belajar coding python dari nol"
                Output Kamu: "Belajar Python Dasar"

                Input User: "${message}"` 
            }] }] 
          },
          { headers: { 'Content-Type': 'application/json' } }
       );
       
       // Bersihkan hasil (hapus spasi berlebih, enter, atau simbol aneh)
       generatedTitle = titleRes.data?.candidates?.[0]?.content?.parts?.[0]?.text
           ?.trim()
           .replace(/[*"`]/g, '') // Hapus tanda kutip atau bold
           .replace(/\n/g, ' ');  // Hapus enter jika ada
           
       console.log("Judul Terbuat:", generatedTitle); // Cek di terminal server

     } catch (e) {
       console.error("Gagal buat judul:", e.message);
     }
  }

  // Kirim Respon Sukses
  res.status(200).json({ reply: aiReply, title: generatedTitle });
}