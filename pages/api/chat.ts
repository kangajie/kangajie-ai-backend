// @ts-nocheck
import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';


const mammoth = require('mammoth');
const XLSX = require('xlsx');
const officeParser = require('officeparser');
const unzipper = require('unzipper');


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

const MAX_FILE_TEXT_CHARS = 15000;

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
    `\n\n... [KONTEN DIPOTONG: ${text.length.toLocaleString()} karakter → ${max.toLocaleString()} karakter ditampilkan. Sisanya tidak dikirim karena terlalu panjang.] ...\n\n` +
    text.substring(text.length - half)
  );
}

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {


  // === CORS ===
  const origin = req.headers.origin || '';
  const allowedOrigins = [
    'https://ai.kangajie.my.id',
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000',
  ];
  const corsOrigin = allowedOrigins.includes(origin) ? origin : 'https://ai.kangajie.my.id';
  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });


  const { history, message, fileData, mimeType, fileName, userName, userTime } = req.body as RequestData;

  // === ROTASI API KEY ===
  const apiKeys = [
    process.env.GOOGLE_API_KEY_1,
    process.env.GOOGLE_API_KEY_2,
    process.env.GOOGLE_API_KEY_3,
    process.env.GOOGLE_API_KEY_4,
    process.env.GEMINI_API_KEY,
  ].filter(Boolean);

  if (apiKeys.length === 0) return res.status(500).json({ error: 'Tidak ada API Key yang tersedia.' });

  const userPanggilan = userName || 'Sobat AI';
  const now = new Date();
  const fallbackDate = now.toLocaleDateString('id-ID', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'Asia/Jakarta'
  });
  const fallbackTime = now.toLocaleTimeString('id-ID', {
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Jakarta'
  });
  const fallbackHour = parseInt(now.toLocaleTimeString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }), 10);

  const effectiveDate = (userTime && userTime.date) ? userTime.date : fallbackDate;
  const effectiveTime = (userTime && userTime.time) ? userTime.time : fallbackTime;
  const effectiveHour = (userTime && typeof userTime.hour === 'number') ? userTime.hour : fallbackHour;

  let salamWaktu = 'Selamat Malam';
  if (effectiveHour >= 3 && effectiveHour < 11) {
    salamWaktu = 'Selamat Pagi';
  } else if (effectiveHour >= 11 && effectiveHour < 15) {
    salamWaktu = 'Selamat Siang';
  } else if (effectiveHour >= 15 && effectiveHour < 18) {
    salamWaktu = 'Selamat Sore';
  } else {
    salamWaktu = 'Selamat Malam';
  }

 
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
INFORMASI KONTEKSTUAL & WAKTU REAL-TIME
═══════════════════════════════════════
- Sedang berbicara dengan: **${userPanggilan}**
- Hari & Tanggal: **${effectiveDate}**
- Jam / Waktu Saat Ini: **${effectiveTime} (Waktu Lokal User)**
- Salam Waktu yang TEPAT saat ini: **"${salamWaktu}"**
- ATURAN SALAM & PANGGILAN (SANGAT PENTING - BERSIKAP EFISIEN SEPERTI CHATGPT/CLAUDE):
  1. JANGAN PERNAH menyapa ulang pengguna ("Selamat pagi/siang/sore/malam", "Halo ${userPanggilan}") di setiap pesan atau pada saat menjawab pertanyaan/perintah.
  2. LANGSUNG jawab pertanyaan atau perintah pengguna secara lugas, cepat, dan efisien ke intinya tanpa basa-basi salam pembuka.
  3. HANYA ucapkan salam ("${salamWaktu}") JIKA DAN HANYA JIKA pesan pengguna adalah sapaan awal (contoh: "Halo", "Selamat siang", "Hai"). Selebihnya dilarang keras menyapa.

═══════════════════════════════════════
KEMAMPUAN & KEAHLIAN UTAMA
═══════════════════════════════════════
Kamu mampu membantu di bidang-bidang berikut dengan sangat baik:

 **Pemrograman & Teknologi**
   - Review kode, debug, refactor, dan penjelasan kode dalam semua bahasa pemrograman
   - Arsitektur sistem, desain database, API design
   - Teknologi web (HTML, CSS, JS, React, Next.js, dll)
   - DevOps, cloud, Docker, Git

 **Analisis Data & Dokumen**
   - Analisis file Excel, CSV: hitung statistik, temukan pola, buat kesimpulan
   - Baca dan rangkum dokumen Word, PDF, PPT
   - Interpretasi data dan beri rekomendasi berdasarkan data

 **Edukasi & Riset**
   - Jelaskan konsep kompleks dengan sederhana dan contoh nyata
   - Bantu belajar dan memahami materi apa pun
   - Riset topik dan berikan informasi akurat

 **Penulisan & Kreativitas**
   - Tulis artikel, esai, laporan, email, caption media sosial
   - Perbaiki grammar, gaya penulisan, dan struktur teks
   - Ide kreatif untuk konten, bisnis, proyek

 **Membuat & Mengedit Gambar (Image Generation & Editing)**

   **A. MEMBUAT GAMBAR BARU:**
   - Jika user minta "buatkan gambar", "gambarkan", "ilustrasikan", dll → WAJIB buat gambar
   - Format URL wajib:
     - Foto/realistis: ![Judul](https://image.pollinations.ai/prompt/PROMPT_DETAIL_BAHASA_INGGRIS?width=1280&height=1280&nologo=true&enhance=true&model=flux-realism&seed=42)
     - Seni/ilustrasi/anime: ![Judul](https://image.pollinations.ai/prompt/PROMPT_DETAIL_BAHASA_INGGRIS?width=1280&height=1280&nologo=true&enhance=true&model=flux&seed=42)
   - Prompt HARUS dalam Bahasa Inggris, sangat detail, sertakan: subjek utama, gaya visual, pencahayaan, warna, komposisi, kualitas (e.g. "ultra-detailed, 8K, professional photography, sharp focus, photorealistic")
   - Encode spasi dengan %20, JANGAN ada newline di dalam URL

   **B. MENGEDIT FOTO YANG DIKIRIM USER:**
   - Jika user mengirim foto/gambar DAN meminta untuk diubah/diedit/dimodifikasi:
     1. ANALISIS foto tersebut secara SANGAT DETAIL: catat warna kulit, bentuk wajah, ekspresi, rambut, pakaian, latar, pencahayaan, pose
     2. TERAPKAN perubahan yang diminta ke deskripsi tersebut (ubah warna, ganti background, tambah elemen, ubah suasana, dll)
     3. GENERATE gambar baru dengan deskripsi SANGAT LENGKAP termasuk semua fitur wajah + perubahan yang diminta menggunakan model flux-realism
     4. Jelaskan singkat apa yang diubah
   - CATATAN PENTING: Jangan pernah bilang ke user "sedang memproses", "tunggu ya", atau seolah ada proses background yang berjalan. Langsung saja buat gambarnya dan tampilkan hasilnya sekarang.
   - Contoh edit background: kirim foto → analisis → generate: ![Edited Photo](https://image.pollinations.ai/prompt/same%20person%20same%20face%20DETAIL_WAJAH_LENGKAP%20city%20night%20background%20neon%20lights%20bokeh%208K?width=1280&height=1280&nologo=true&enhance=true&model=flux-realism&seed=42)

   - **WAJIB:** Selalu gunakan model=flux-realism untuk foto/orang/arsitektur, model=flux untuk art/anime/ilustrasi. Resolusi minimal 1280x1280. DILARANG MENGGANTI ORANG ASLI DENGAN KARAKTER ACAK / ANIME BARU saat mengedit foto seseorang.

 **Matematika & Logika**
   - Selesaikan soal matematika step by step
   - Logika, algoritma, dan pemecahan masalah

 **Bisnis & Produktivitas**
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
5. **Jujur & Akurat** — SELALU gunakan Google Search untuk memverifikasi fakta, angka, dan informasi terkini. Jangan pernah mengarang data. Jika kamu tidak yakin, cari dulu.
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
- **Gambar/foto + permintaan edit**: Analisis foto secara detail, generate gambar baru dengan deskripsi lengkap termasuk semua fitur wajah asli + perubahan yang diminta, gunakan model=flux-realism. Jangan bilang "sedang memproses" — langsung tampilkan hasilnya.
- Jika pengguna minta DIBUATKAN GAMBAR BARU, gunakan format markdown ![title](https://image.pollinations.ai/prompt/PROMPT_DETAIL?width=1280&height=1280&nologo=true&enhance=true&model=flux-realism&seed=42) dengan prompt Bahasa Inggris ultra-detail.

═══════════════════════════════════════
MEMBUAT & MENGUNDUH FILE DOKUMEN (WORD/DOC, EXCEL/CSV, PDF, TXT, MD, HTML, KODE)
═══════════════════════════════════════
- PENTING: Aplikasi KangAjie AI memiliki fitur "UNDUH FILE OTOMATIS" di setiap blok kode (Code Block)!
- Jika pengguna meminta dibuatkan file dokumen (seperti file PDF/.pdf, Word/DOC/DOCX, Excel/CSV, daftar isi, surat lamaran, laporan, skrip, atau file teks apa pun), DILARANG KERAS menolak atau mengatakan "saya tidak bisa membuat file".
- KAMU WAJIB MEMBUAT DAN MEMBERIKAN ISINYA di dalam Code Block Markdown agar tombol "Simpan / Unduh" muncul di pojok kanan atas blok tersebut untuk diunduh langsung oleh pengguna!
- Aturan bahasa Code Block:
  1. Untuk dokumen Word (.doc / .docx) ATAU permintaan file PDF (.pdf): Gunakan tag \`\`\`doc atau \`\`\`word lalu tulis isi dokumen selengkap mungkin secara rapi. (Jelaskan bahwa setelah diunduh, file tersebut bisa dengan mudah disimpan/di-export ke PDF dari komputer mereka).
  2. Untuk tabel / data Excel (.csv): Gunakan tag \`\`\`csv dengan separator koma (,) yang rapi.
  3. Untuk teks biasa (.txt) atau Markdown (.md): Gunakan tag \`\`\`txt atau \`\`\`markdown.
- Beritahu pengguna di akhir pesan: "Kamu bisa mengklik tombol **'Simpan / Unduh'** di pojok kanan atas blok dokumen di atas untuk langsung mengunduh filenya ke komputermu!"

═══════════════════════════════════════
KEMAMPUAN REAL-TIME (WAJIB DIGUNAKAN)
═══════════════════════════════════════
 **Google Search Integration — SELALU AKTIFKAN**
   - Kamu memiliki akses penuh ke Google Search (termasuk Google Scholar, berita, Wikipedia, jurnal ilmiah, dll)
   - WAJIB gunakan pencarian untuk: fakta apapun, angka, statistik, berita, harga, cuaca, teknologi terbaru, riset, jurnal, event, regulasi, data terkini
   - JANGAN pernah menjawab dari memori saja jika topiknya bisa berubah atau butuh sumber — SELALU cari dulu
   - Untuk pertanyaan akademik/jurnal/penelitian: cari di Google Scholar (scholar.google.com), PubMed, ResearchGate, IEEE, atau sumber ilmiah lain
   - Untuk pertanyaan teknis/teknologi: cari dokumentasi resmi, GitHub, Stack Overflow, MDN terbaru
   - Untuk berita/current events: cari berita dari sumber terpercaya (Kompas, CNN, BBC, Reuters, dll)
   - Setelah mencari, SELALU sebutkan bahwa jawaban berdasarkan informasi terbaru dari internet
   - Cantumkan nama sumber/judul artikel jika relevan dalam jawaban

═══════════════════════════════════════
BATASAN
═══════════════════════════════════════
- Tolak dengan sopan permintaan yang berbahaya, ilegal, atau tidak etis.
- Jika ditanya tentang identitasmu (siapa kamu, dibuat oleh siapa), selalu jawab: "Saya KangAjie AI, dibuat oleh M. Roifan Aji Marzuki."
- Kamu BUKAN ChatGPT, Gemini, Claude, atau AI lain. Kamu adalah KangAjie AI.
`;

  
  let fileTextContext = '';
  let visualPart = null;
  const ext = getExtension(fileName || '');

  if (fileData && mimeType) {
    try {
      const cleanBase64 = fileData.replace(/^data:.+;base64,/, '');
      const buffer = Buffer.from(cleanBase64, 'base64');

      // 1. Gambar, PDF, Video Singkat & Audio (Native Multimodal Gemini)
      if (mimeType.startsWith('image/') || mimeType === 'application/pdf' || mimeType.startsWith('video/') || mimeType.startsWith('audio/')) {
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
          fileTextContext = `\n\n[ISI FILE${fileName ? ` (${fileName})` : ''}]:\n${truncate(fallbackText)}\n`;
        } else {
          fileTextContext = `\n\n[FILE BINARY]: File "${fileName || 'tidak dikenal'}" adalah file binary yang tidak dapat dibaca sebagai teks.\n`;
        }
      }
    } catch (e: any) {
      console.error('File Read Error:', e);
      fileTextContext = `\n\n[ERROR MEMBACA FILE]: Gagal memproses "${fileName || ''}". Detail: ${e.message}\n`;
    }
  }

 
  const recentHistory = Array.isArray(history) ? history.slice(-40) : [];
  let historyText = '';
  if (recentHistory.length > 0) {
    historyText = recentHistory.map(h => {
      let text = '';
      if (typeof h === 'string') text = h;
      else if (typeof h.message === 'string') text = h.message;
      else if (Array.isArray(h.parts) && h.parts[0]?.text) text = h.parts[0].text;
      const role = h.role === 'model' ? 'KangAjie AI' : userPanggilan;
      
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

  const IMAGE_EDIT_KEYWORDS = /\b(edit|ubah|ganti|hapus|tambah|modif|warna|background|bg|jadikan|buat jadi|ubah jadi|change|remove|replace|add|transform|potong|crop|cerahkan|gelapkan|hitam putih|grayscale|vintage|sepia|blur|artistik|filter|zoom|rotate|flip|berikan|coba|lebih|oke|keren|bagus|lagi|bagaimana|gimana|menarik|malam|siang|kota|neon|bokeh|polos|studio|suasana|latar|belakang)\b/i;
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';

  const REMOVEBG_KEY = process.env.REMOVEBG_API_KEY || '';

  if (visualPart && mimeType?.startsWith('image/') && IMAGE_EDIT_KEYWORDS.test(message) && REMOVEBG_KEY) {
    try {
      const sharp = require('sharp');
      console.log('remove.bg: memotong background dari foto asli...');

      // Step 1: remove.bg → potong orang, background transparan (pixel asli 100%)
      const rawBase64 = (fileData || '').replace(/^data:.+;base64,/, '');
      const rbgRes = await axios.post(
        'https://api.remove.bg/v1.0/removebg',
        { image_file_b64: rawBase64, size: 'auto' },
        {
          headers: { 'X-Api-Key': REMOVEBG_KEY, 'Content-Type': 'application/json' },
          responseType: 'arraybuffer',
          timeout: 30000,
        }
      );
      const personBuf = Buffer.from(rbgRes.data);
      const meta = await sharp(personBuf).metadata();
      const W = meta.width || 800;
      const H = meta.height || 800;
      console.log(` remove.bg selesai: ${W}x${H}px`);

      // Step 2: Tentukan background — warna solid atau scene via FLUX.2 Pro
      const COLOR_MAP: Record<string, string> = {
        merah: '#C00000', red: '#C00000',
        biru: '#0050CC', blue: '#0050CC',
        hijau: '#006600', green: '#006600',
        kuning: '#DDAA00', yellow: '#DDAA00',
        putih: '#FFFFFF', white: '#FFFFFF',
        hitam: '#111111', black: '#111111',
        'abu-abu': '#808080', abu: '#808080', gray: '#808080', grey: '#808080',
        ungu: '#5500BB', purple: '#5500BB',
        oranye: '#E05500', orange: '#E05500',
        pink: '#DD4488', merah_muda: '#DD4488',
        coklat: '#7B4F2E', brown: '#7B4F2E',
        navy: '#001F5B', biru_tua: '#001F5B',
      };

      const msgLower = message.toLowerCase();
      const solidColor = Object.entries(COLOR_MAP).find(([key]) => msgLower.includes(key))?.[1];
      let bgBuf: Buffer;

      if (solidColor) {
        // Buat background warna solid dengan sharp
        console.log(` Background warna solid: ${solidColor}`);
        bgBuf = await sharp({
          create: { width: W, height: H, channels: 3, background: solidColor }
        }).png().toBuffer();
      } else {
        // Generate background scene dengan FLUX.2 Pro
        const bgPrompt = `background scene only, no people, photorealistic, high quality: ${message}`;
        console.log(` FLUX.2 Pro generate background: ${bgPrompt.substring(0, 60)}...`);
        const bgRes = await axios.post(
          'https://openrouter.ai/api/v1/images',
          { model: 'black-forest-labs/flux.2-pro', prompt: bgPrompt, n: 1 },
          {
            headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
            timeout: 120000,
          }
        );
        const bgB64 = bgRes.data?.data?.[0]?.b64_json;
        const bgUrl = bgRes.data?.data?.[0]?.url;
        if (bgB64) {
          bgBuf = Buffer.from(bgB64, 'base64');
        } else if (bgUrl) {
          const r = await axios.get(bgUrl, { responseType: 'arraybuffer', timeout: 30000 });
          bgBuf = Buffer.from(r.data);
        } else {
          throw new Error('Background tidak ter-generate dari FLUX.2 Pro');
        }
        console.log(' Background berhasil di-generate');
      }

      // Step 3: Composite — tempel orang (pixel asli) di atas background baru
      console.log(' Compositing orang di atas background...');
      const resultBuf = await sharp(bgBuf)
        .resize(W, H, { fit: 'cover', position: 'center' })
        .composite([{ input: personBuf, gravity: 'center' }])
        .png()
        .toBuffer();

      console.log(' Edit foto selesai — wajah 100% pixel asli!');
      return res.status(200).json({
        reply: ' Background berhasil diganti! Wajah, pakaian, dan semua detail kamu 100% sama persis dengan foto asli — hanya background yang berubah.',
        editedImage: `data:image/png;base64,${resultBuf.toString('base64')}`,
        title: (!history || history.length <= 1) ? 'Edit Foto' : null,
        sources: [],
      });

    } catch (e: any) {
      console.error(' Edit foto error:', e.response?.status || '', e.message);
    }
  }

  
  let aiReply: string | null = null;
  let activeKey = '';
  let lastError: any = null;
  let sources: Array<{ url: string; title: string }> = [];

  for (const key of apiKeys) {
    try {
      console.log(` Mencoba Key: ...${key?.slice(-4)}`);

      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
        {
          contents: [{ parts: partsToSend }],
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 1.0,
            maxOutputTokens: 16384,
            thinkingConfig: {
              thinkingBudget: -1,
            },
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

      const candidate = response.data?.candidates?.[0];
      aiReply = candidate?.content?.parts
        ?.map((p: any) => p.text)
        .filter(Boolean)
        .join('\n');

      const chunks = candidate?.groundingMetadata?.groundingChunks || [];
      const seen = new Set<string>();
      sources = chunks
        .filter((c: any) => c.web?.uri)
        .map((c: any) => ({ url: c.web.uri as string, title: (c.web.title || c.web.uri) as string }))
        .filter((s: any) => { if (seen.has(s.url)) return false; seen.add(s.url); return true; })
        .slice(0, 8);

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
        reply: ' **Semua Jalur Sibuk**\n\nMaaf, semua jalur AI sedang padat saat ini. Mohon tunggu sekitar 1 menit lalu coba lagi ya, ' + userPanggilan + '! 🙏',
      });
    }
    return res.status(500).json({ error: 'Gagal menghubungi AI', detail: lastError?.message });
  }

  
  let generatedTitle: string | null = null;

  if (!history || history.length <= 1) {
    try {
      
      const nextKey = apiKeys[(apiKeys.indexOf(activeKey) + 1) % apiKeys.length] || activeKey;
      
      
      if (apiKeys.length === 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      const titleRes = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${nextKey}`,
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
        .replace(/\n.*/s, '') 
        .trim() || "Percakapan Baru";

      console.log(' Judul AI:', generatedTitle);
    } catch (e: any) {
      console.error('Gagal buat judul AI:', e.message);
      generatedTitle = "Percakapan Baru";
    }
  }


  const HD_SUFFIX = ', ultra HD, 8K resolution, ultra-detailed, sharp focus, professional quality, vibrant colors, masterpiece';

  if (OPENROUTER_KEY && aiReply) {
    const pollinationsRegex = /!\[([^\]]*)\]\(https:\/\/image\.pollinations\.ai\/prompt\/([^)\s]+)\)/g;
    const imgMatches = [...aiReply.matchAll(pollinationsRegex)];

    if (imgMatches.length > 0) {
      let modifiedReply = aiReply;
      for (const match of imgMatches) {
        const [fullMatch, altText, encodedPart] = match;
        try {
          const rawPrompt = decodeURIComponent(encodedPart.split('?')[0]).replace(/\+/g, ' ');
          const prompt = rawPrompt + HD_SUFFIX;
          console.log(`🎨 FLUX.2 Pro HD: ${rawPrompt.substring(0, 70)}...`);

          const imgResponse = await axios.post(
            'https://openrouter.ai/api/v1/images',
            { model: 'black-forest-labs/flux.2-pro', prompt, n: 1, width: 1440, height: 1440 },
            {
              headers: {
                'Authorization': `Bearer ${OPENROUTER_KEY}`,
                'Content-Type': 'application/json',
              },
              timeout: 120000,
            }
          );

          const imgResult = imgResponse.data;
          const b64 = imgResult.data?.[0]?.b64_json;
          const imgUrl = imgResult.data?.[0]?.url;

          if (b64) {
            modifiedReply = modifiedReply.replace(fullMatch, `![${altText}](data:image/png;base64,${b64})`);
            console.log(' FLUX.2 Pro HD berhasil (base64)');
          } else if (imgUrl) {
            modifiedReply = modifiedReply.replace(fullMatch, `![${altText}](${imgUrl})`);
            console.log(' FLUX.2 Pro HD berhasil (URL)');
          } else {
            console.log(' FLUX.2 Pro tidak mengembalikan gambar:', JSON.stringify(imgResult).substring(0, 300));
          }
        } catch (e: any) {
          console.log(` FLUX.2 Pro generate error: ${e.message}`);
        }
      }
      aiReply = modifiedReply;
    }
  }

  res.status(200).json({ reply: aiReply, title: generatedTitle, sources });
}