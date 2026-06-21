// @ts-nocheck
import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';

// === LIBRARY PEMBACA FILE ===
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const officeParser = require('officeparser');
const unzipper = require('unzipper');

// === DEFINISI TIPE ===
type Part = { text?: string; inline_data?: { mime_type: string; data: string } };
type Message = { role: 'user' | 'model'; parts: Part[] | string; message?: string };
type RequestData = {
  history: Message[];
  message: string;
  fileData?: string;
  mimeType?: string;
  fileName?: string;
  userName?: string;
};

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

// ============================================================
// KONSTANTA
// ============================================================

// Batas karakter teks yang dikirim ke Gemini (agar tidak overflow token)
// ~15.000 karakter ≈ sekitar 3.750 token — aman untuk konteks file
const MAX_FILE_TEXT_CHARS = 15000;

// Ekstensi file yang bisa dibaca sebagai teks/kode
const CODE_EXTENSIONS = new Set([
  // Web
  'html', 'htm', 'css', 'scss', 'sass', 'less',
  // JavaScript / TypeScript
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  // Backend Languages
  'py', 'rb', 'php', 'java', 'go', 'rs', 'c', 'cpp', 'cc', 'h', 'hpp',
  'cs', 'swift', 'kt', 'kts', 'dart', 'r', 'scala', 'lua', 'pl', 'sh',
  'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  // Data & Config
  'json', 'yaml', 'yml', 'toml', 'ini', 'env', 'xml', 'svg',
  'conf', 'cfg', 'properties', 'plist',
  // Text & Docs
  'txt', 'md', 'mdx', 'rst', 'log', 'csv', 'tsv', 'rtf',
  // Database
  'sql',
  // Other
  'dockerfile', 'makefile', 'gitignore', 'editorconfig', 'graphql', 'gql',
]);

const TEXT_MIME_PREFIXES = ['text/'];
const TEXT_MIME_EXACT = new Set([
  'application/json', 'application/xml', 'application/javascript',
  'application/typescript', 'application/x-sh', 'application/graphql',
  'application/toml', 'application/x-yaml',
]);

// ============================================================
// HELPER
// ============================================================

function getExtension(fileName: string): string {
  if (!fileName) return '';
  const parts = fileName.split('.');
  return parts.length < 2 ? '' : parts[parts.length - 1].toLowerCase();
}

function isTextMime(mimeType: string): boolean {
  return TEXT_MIME_PREFIXES.some(p => mimeType.startsWith(p)) || TEXT_MIME_EXACT.has(mimeType);
}

// Potong teks jika terlalu panjang dan beri keterangan
function truncate(text: string, max = MAX_FILE_TEXT_CHARS): string {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  return (
    text.substring(0, half) +
    `\n\n... [⚠️ KONTEN DIPOTONG: ${text.length.toLocaleString()} karakter → ${max.toLocaleString()} karakter ditampilkan. Sisanya tidak dikirim karena terlalu panjang.] ...\n\n` +
    text.substring(text.length - half)
  );
}

// Baca isi ZIP dan hasilkan teks ringkasannya
async function readZipContents(buffer: Buffer): Promise<string> {
  const results: string[] = [];
  try {
    const directory = await unzipper.Open.buffer(buffer);
    const filesToRead = directory.files
      .filter((f: any) => {
        const ext = getExtension(f.path);
        return !f.path.endsWith('/') && CODE_EXTENSIONS.has(ext);
      })
      .slice(0, 15);

    for (const file of filesToRead) {
      try {
        const content = await file.buffer();
        const text = content.toString('utf-8');
        results.push(`\n--- FILE: ${file.path} ---\n${text.substring(0, 2000)}${text.length > 2000 ? '\n...(dipotong)' : ''}`);
      } catch {
        results.push(`\n--- FILE: ${file.path} --- [Tidak dapat dibaca]`);
      }
    }

    const skipped = directory.files.length - filesToRead.length;
    if (skipped > 0) results.push(`\n\n[${skipped} file lain dilewati: bukan file teks/kode]`);
  } catch {
    return '[Gagal membaca arsip ZIP]';
  }
  return results.join('\n') || '[Arsip kosong atau tidak ada file teks yang bisa dibaca]';
}

// ============================================================
// HANDLER UTAMA
// ============================================================
export default async function handler(req: NextApiRequest, res: NextApiResponse) {

  // === CORS ===
  res.setHeader('Access-Control-Allow-Origin', 'https://ai.kangajie.my.id');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { history, message, fileData, mimeType, fileName, userName } = req.body as RequestData;

  // === ROTASI API KEY ===
  const apiKeys = [
    process.env.GOOGLE_API_KEY_1,
    process.env.GOOGLE_API_KEY_2,
    process.env.GOOGLE_API_KEY_3,
    process.env.GOOGLE_API_KEY_4,
  ].filter(Boolean);

  if (apiKeys.length === 0) return res.status(500).json({ error: 'Tidak ada API Key yang tersedia.' });

  const userPanggilan = userName || 'Sobat AI';
  const currentDate = new Date().toLocaleDateString('id-ID', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'Asia/Jakarta'
  });

  // ============================================================
  // SYSTEM PROMPT — CERDAS & KOMPREHENSIF
  // ============================================================
  const systemPrompt = `
Kamu adalah **KangAjie AI** — asisten kecerdasan buatan yang dibuat oleh **M. Roifan Aji Marzuki** (dipanggil KangAjie).

═══════════════════════════════════════
IDENTITAS & KEPRIBADIAN
═══════════════════════════════════════
- Nama: KangAjie AI
- Pencipta: M. Roifan Aji Marzuki
- Kepribadian: Cerdas, ramah, santai tapi tetap profesional. Seperti teman yang ahli di berbagai bidang.
- Bahasa: Gunakan Bahasa Indonesia yang natural. Boleh sesekali mix dengan istilah teknis dalam Bahasa Inggris jika memang lebih tepat.
- Jika user pakai Bahasa Inggris, jawab dalam Bahasa Inggris.

═══════════════════════════════════════
INFORMASI KONTEKSTUAL
═══════════════════════════════════════
- Sedang berbicara dengan: **${userPanggilan}**
- Hari ini: ${currentDate}
- Sapa user dengan namanya sesekali agar terasa lebih personal dan hangat.

═══════════════════════════════════════
KEMAMPUAN & KEAHLIAN UTAMA
═══════════════════════════════════════
Kamu mampu membantu di bidang-bidang berikut dengan sangat baik:

🖥️ **Pemrograman & Teknologi**
   - Review kode, debug, refactor, dan penjelasan kode dalam semua bahasa pemrograman
   - Arsitektur sistem, desain database, API design
   - Teknologi web (HTML, CSS, JS, React, Next.js, dll)
   - DevOps, cloud, Docker, Git

📊 **Analisis Data & Dokumen**
   - Analisis file Excel, CSV: hitung statistik, temukan pola, buat kesimpulan
   - Baca dan rangkum dokumen Word, PDF, PPT
   - Interpretasi data dan beri rekomendasi berdasarkan data

🎓 **Edukasi & Riset**
   - Jelaskan konsep kompleks dengan sederhana dan contoh nyata
   - Bantu belajar dan memahami materi apa pun
   - Riset topik dan berikan informasi akurat

✍️ **Penulisan & Kreativitas**
   - Tulis artikel, esai, laporan, email, caption media sosial
   - Perbaiki grammar, gaya penulisan, dan struktur teks
   - Ide kreatif untuk konten, bisnis, proyek

🎨 **Membuat Gambar (Image Generation)**
   - Jika pengguna meminta untuk "buatkan gambar", "gambarkan", "lukiskan", dll, kamu BISA membuatnya!
   - Caranya: Balas dengan menggunakan format Markdown Image yang mengarah ke API pembuat gambar gratis.
   - Gunakan format persis seperti ini:
     ![Deskripsi Singkat](https://image.pollinations.ai/prompt/DESKRIPSI_DETAIL_DALAM_BAHASA_INGGRIS_DENGAN_GAYA_VISUAL?width=1024&height=1024&nologo=true&enhance=true)
   - Contoh balasanmu: "Tentu, ini gambar kucing cyberpunk yang kamu minta: \n\n![Cyberpunk Cat](https://image.pollinations.ai/prompt/A%20futuristic%20cyberpunk%20cat%20with%20neon%20lights%20and%20robotic%20parts%20in%20a%20rainy%20neon%20city%20cinematic%20lighting?width=1024&height=1024&nologo=true&enhance=true)"
   - Pastikan URL prompt HANYA menggunakan spasi yang di-encode (%20) atau kata yang dipisah dengan spasi biasa (jangan gunakan spasi baris baru di dalam URL).

🧮 **Matematika & Logika**
   - Selesaikan soal matematika step by step
   - Logika, algoritma, dan pemecahan masalah

💼 **Bisnis & Produktivitas**
   - Strategi bisnis, analisis SWOT, business plan
   - Template surat, proposal, presentasi
   - Manajemen waktu dan produktivitas

═══════════════════════════════════════
CARA MENJAWAB
═══════════════════════════════════════
1. **Langsung ke inti** — Jangan basa-basi berlebihan. Jawab yang ditanya dulu.
2. **Terstruktur** — Gunakan heading, bullet point, atau numbering jika jawaban panjang agar mudah dibaca.
3. **Berikan contoh** — Selalu sertakan contoh konkret untuk konsep yang abstrak.
4. **Kode yang baik** — Jika memberikan kode, selalu tambahkan komentar penjelasan. Gunakan format code block yang sesuai bahasa.
5. **Jujur** — Jika tidak tahu sesuatu, katakan jujur. Jangan mengarang informasi.
6. **Proaktif** — Berikan konteks tambahan yang relevan meski tidak diminta, jika itu memang bermanfaat.
7. **Ringkas tapi lengkap** — Tidak bertele-tele, tapi jangan sampai ada informasi penting yang hilang.

═══════════════════════════════════════
ATURAN KHUSUS UNTUK FILE
═══════════════════════════════════════
Jika user mengirimkan file:
- **Gambar/foto**: Deskripsikan isinya secara detail, baca teks di dalamnya jika ada, analisis chart/grafik jika ada.
- **Kode**: Review kualitas kode, temukan bug, sarankan perbaikan, dan jelaskan cara kerjanya.
- **Excel/CSV**: Analisis data, hitung statistik dasar (total, rata-rata, min, max), temukan pola atau anomali.
- **Dokumen teks**: Rangkum isi, identifikasi poin-poin penting, dan jawab pertanyaan berdasarkan isinya.
- **PPT**: Rangkum alur presentasi dan identifikasi topik utama tiap slide.
- Jika user mengirim file Zip, jelaskan struktur proyek dan analisis file-file kode di dalamnya.
- Jika pengguna minta DIBUATKAN GAMBAR, WAJIB gunakan format markdown ![title](https://image.pollinations.ai/prompt/...) dengan prompt deskripsi gambar berbahasa Inggris yang sangat detail agar hasilnya memukau.

═══════════════════════════════════════
BATASAN
═══════════════════════════════════════
- Tolak dengan sopan permintaan yang berbahaya, ilegal, atau tidak etis.
- Jika ditanya tentang identitasmu (siapa kamu, dibuat oleh siapa), selalu jawab: "Saya KangAjie AI, dibuat oleh M. Roifan Aji Marzuki."
- Kamu BUKAN ChatGPT, Gemini, Claude, atau AI lain. Kamu adalah KangAjie AI.
`;

  // ============================================================
  // PROSES FILE
  // ============================================================
  let fileTextContext = '';
  let visualPart = null;
  const ext = getExtension(fileName || '');

  if (fileData && mimeType) {
    try {
      const cleanBase64 = fileData.replace(/^data:.+;base64,/, '');
      const buffer = Buffer.from(cleanBase64, 'base64');

      // 1. Gambar & PDF → Native Vision Gemini
      if (mimeType.startsWith('image/') || mimeType === 'application/pdf') {
        visualPart = { inline_data: { mime_type: mimeType, data: cleanBase64 } };
      }
      // 2. Word
      else if (mimeType.includes('word') || ['docx', 'doc'].includes(ext)) {
        const result = await mammoth.extractRawText({ buffer });
        fileTextContext = `\n\n[📄 ISI FILE WORD (.${ext})]:\n${truncate(result.value)}\n`;
      }
      // 3. Excel / Spreadsheet
      else if (mimeType.includes('sheet') || mimeType.includes('excel') || ['xlsx', 'xls', 'ods', 'csv'].includes(ext)) {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        let allSheets = '';
        workbook.SheetNames.forEach((sheetName: string) => {
          const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
          allSheets += `\n[Sheet: ${sheetName}]\n${csv}\n`;
        });
        fileTextContext = `\n\n[📊 ISI FILE EXCEL (.${ext})]:\n${truncate(allSheets)}\n`;
      }
      // 4. PowerPoint
      else if (mimeType.includes('presentation') || ['pptx', 'odp'].includes(ext)) {
        const pptText = await new Promise<string>((resolve, reject) => {
          officeParser.parseOfficeBuffer(buffer, (data: any, err: any) => {
            if (err) reject(err); else resolve(data);
          });
        });
        fileTextContext = `\n\n[📊 ISI SLIDE PPT (.${ext})]:\n${truncate(pptText as string)}\n`;
      }
      // 5. ZIP / 7Z
      else if (['zip', '7z'].includes(ext) || mimeType.includes('zip') || mimeType.includes('compressed')) {
        const zipContent = await readZipContents(buffer);
        fileTextContext = `\n\n[🗜️ ISI ARSIP .${ext.toUpperCase()}]:\n${truncate(zipContent)}\n`;
      }
      // 6. File Kode / Teks
      else if (CODE_EXTENSIONS.has(ext) || isTextMime(mimeType)) {
        const content = buffer.toString('utf-8');
        const label = ext ? `.${ext.toUpperCase()}` : 'TEXT';
        fileTextContext = `\n\n[💻 ISI FILE ${label}${fileName ? ` (${fileName})` : ''}]:\n\`\`\`${ext}\n${truncate(content)}\n\`\`\`\n`;
      }
      // 7. Fallback
      else {
        const fallbackText = buffer.toString('utf-8');
        const nonPrintable = (fallbackText.match(/[\x00-\x08\x0E-\x1F]/g) || []).length;
        if (nonPrintable / Math.max(fallbackText.length, 1) < 0.05) {
          fileTextContext = `\n\n[📄 ISI FILE${fileName ? ` (${fileName})` : ''}]:\n${truncate(fallbackText)}\n`;
        } else {
          fileTextContext = `\n\n[⚠️ FILE BINARY]: File "${fileName || 'tidak dikenal'}" adalah file binary yang tidak dapat dibaca sebagai teks.\n`;
        }
      }
    } catch (e: any) {
      console.error('File Read Error:', e);
      fileTextContext = `\n\n[❌ ERROR MEMBACA FILE]: Gagal memproses "${fileName || ''}". Detail: ${e.message}\n`;
    }
  }

  // ============================================================
  // RAKIT PROMPT FINAL
  // ============================================================

  // Ambil max 20 pesan terakhir dari history untuk hemat token
  const recentHistory = Array.isArray(history) ? history.slice(-20) : [];
  let historyText = '';
  if (recentHistory.length > 0) {
    historyText = recentHistory.map(h => {
      let text = '';
      if (typeof h === 'string') text = h;
      else if (typeof h.message === 'string') text = h.message;
      else if (Array.isArray(h.parts) && h.parts[0]?.text) text = h.parts[0].text;
      const role = h.role === 'model' ? 'KangAjie AI' : userPanggilan;
      // Potong pesan history yang sangat panjang
      return `${role}: ${text.substring(0, 800)}${text.length > 800 ? '...' : ''}`;
    }).join('\n');
  }

  const finalPromptText = [
    systemPrompt,
    historyText ? `\n═══════════════════════════════════════\nRIWAYAT PERCAKAPAN TERBARU\n═══════════════════════════════════════\n${historyText}` : '',
    fileTextContext,
    `\n═══════════════════════════════════════\nPESAN DARI ${userPanggilan.toUpperCase()}\n═══════════════════════════════════════\n${message}`,
  ].join('\n');

  const partsToSend: any[] = [];
  if (visualPart) partsToSend.push(visualPart);
  partsToSend.push({ text: finalPromptText });

  // ============================================================
  // EKSEKUSI KE GEMINI DENGAN ROTASI KEY
  // ============================================================
  let aiReply: string | null = null;
  let activeKey = '';
  let lastError: any = null;

  for (const key of apiKeys) {
    try {
      console.log(`🔑 Mencoba Key: ...${key?.slice(-4)}`);

      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${key}`,
        {
          contents: [{ parts: partsToSend }],
          generationConfig: {
            temperature: 0.8,         // Sedikit kreatif tapi tetap akurat
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 8192,    // Maksimalkan panjang jawaban
          },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
          ],
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 90000 }
      );

      aiReply = response.data?.candidates?.[0]?.content?.parts
        ?.map((p: any) => p.text)
        .join('\n');
      activeKey = key;
      break;

    } catch (error: any) {
      lastError = error;
      if (error.response?.status === 429) {
        console.warn(`⚠️ Key ...${key?.slice(-4)} limit habis, ganti key...`);
        continue;
      } else {
        console.error('Error Fatal:', error.message);
        break;
      }
    }
  }

  if (!aiReply) {
    console.error('SEMUA KEY HABIS/ERROR');
    if (lastError?.response?.status === 429) {
      return res.status(200).json({
        reply: '⚠️ **Semua Jalur Sibuk**\n\nMaaf, semua jalur AI sedang padat saat ini. Mohon tunggu sekitar 1 menit lalu coba lagi ya, ' + userPanggilan + '! 🙏',
      });
    }
    return res.status(500).json({ error: 'Gagal menghubungi AI', detail: lastError?.message });
  }

  // ============================================================
  // GENERATE JUDUL PERCAKAPAN (AMBIL INTINYA SAJA)
  // ============================================================
  let generatedTitle: string | null = null;

  if (!history || history.length <= 1) {
    try {
      // Gunakan API Key yang berbeda untuk menghindari rate limit beruntun
      const nextKey = apiKeys[(apiKeys.indexOf(activeKey) + 1) % apiKeys.length] || activeKey;
      
      // Delay singkat jika Vercel hanya membaca 1 API key, untuk mencegah Rate Limit
      if (apiKeys.length === 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      const titleRes = await axios.post(
        `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${nextKey}`,
        {
          contents: [{
            parts: [{
              text: `Tuliskan HANYA SATU FRASA (maksimal 4 kata) yang menjadi TOPIK UTAMA dari pesan berikut.
DILARANG memberikan penjelasan. DILARANG menggunakan tanda kutip. DILARANG memakai awalan seperti "THINK:" atau "Topik:".

Pesan: "${message}"`
            }],
          }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 250 },
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 8000 }
      );

      let rawTitle = titleRes.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      generatedTitle = rawTitle
        .replace(/^["'`*]+|["'`*]+$/g, '')
        .replace(/^(THINK:|Topik:|Judul:)/i, '')
        .replace(/\n.*/s, '') // Ambil baris pertama saja
        .trim() || "Percakapan Baru";

      console.log('✅ Judul AI:', generatedTitle);
    } catch (e: any) {
      console.error('Gagal buat judul AI:', e.message);
      generatedTitle = "Percakapan Baru";
    }
  }

  res.status(200).json({ reply: aiReply, title: generatedTitle });
}