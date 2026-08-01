// @ts-nocheck
import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

const ICON_PALETTE = [
  { icon: 'fa-newspaper', color: '#EAB308' },
  { icon: 'fa-graduation-cap', color: '#818cf8' },
  { icon: 'fa-code', color: '#34d399' },
  { icon: 'fa-chart-line', color: '#60a5fa' },
];

const FALLBACK_TOPICS = [
  'Apa berita teknologi dan AI terbaru hari ini?',
  'Carikan jurnal ilmiah tentang dampak AI di dunia kerja',
  'Buatkan kode Python untuk web scraping dengan BeautifulSoup',
  'Jelaskan cara kerja machine learning dengan contoh nyata',
];

function extractTopics(rawText: string): string[] | null {
  if (!rawText) return null;

  const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();

  const tryParse = (text: string): string[] | null => {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.every(t => typeof t === 'string' && t.trim())) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  };

  let topics = tryParse(cleaned);
  if (!topics) {
    const match = cleaned.match(/\[[\s\S]*?\]/);
    if (match) topics = tryParse(match[0]);
  }

  // Fallback cerdas: Jika JSON terpotong di akhir oleh batas token, ekstrak semua teks lengkap di dalam tanda kutip
  if (!topics) {
    const stringMatches = cleaned.match(/"([^"\\]|\\.)*"/g);
    if (stringMatches && stringMatches.length >= 2) {
      const recovered = stringMatches
        .map(s => {
          try { return JSON.parse(s); } catch { return s.replace(/^"|"$/g, ''); }
        })
        .filter(t => typeof t === 'string' && t.trim().length > 3)
        .slice(0, 4);
      if (recovered.length >= 2) return recovered;
    }
  }

  return topics;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(500).json({ error: 'CRON_SECRET belum dikonfigurasi di environment.' });
  }
  if (req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const apiKeys = [
    process.env.GOOGLE_API_KEY_1,
    process.env.GOOGLE_API_KEY_2,
    process.env.GOOGLE_API_KEY_3,
    process.env.GOOGLE_API_KEY_4,
    process.env.GEMINI_API_KEY,
  ].filter(Boolean);

  if (apiKeys.length === 0) {
    return res.status(500).json({ error: 'Tidak ada API Key Gemini yang tersedia.' });
  }

  const currentDate = new Date().toLocaleDateString('id-ID', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'Asia/Jakarta'
  });

  const prompt = `Hari ini adalah ${currentDate}. Gunakan Google Search untuk menemukan topik/pertanyaan yang benar-benar sedang trending dan aktual hari ini.

Berikan TEPAT 4 topik/pertanyaan singkat (maksimal 12 kata) dalam Bahasa Indonesia yang beragam, mencakup domain berbeda: berita teknologi/AI terkini, riset/ilmu pengetahuan, coding/pemrograman, dan analisis/tren umum.

Balas HANYA dengan JSON array berisi 4 string, tanpa markdown fence, tanpa penjelasan tambahan. Contoh format:
["topik 1", "topik 2", "topik 3", "topik 4"]`;

  let rawText: string | null = null;
  let lastError: any = null;

  for (const key of apiKeys) {
    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
        {
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 0.9,
            maxOutputTokens: 4096,
          },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
          ],
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 60000 }
      );

      const candidate = response.data?.candidates?.[0];
      rawText = candidate?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('\n') || null;
      break;

    } catch (error: any) {
      lastError = error;
      const status = error.response?.status;
      if (status === 429 || status === 400 || status === 403) {
        console.warn(`Key ...${key?.slice(-4)} error ${status}, ganti key...`);
        continue;
      }
      console.error('Error generate-suggestions:', error.message, 'status:', status);
      break;
    }
  }

  if (!rawText) {
    console.error('Gagal generate topik:', lastError?.message);
    return res.status(500).json({ error: 'Gagal menghasilkan topik dari AI', detail: lastError?.message });
  }

  let topics = extractTopics(rawText);
  if (!topics) {
    console.error('Respons AI tidak bisa di-parse sebagai JSON array:', rawText);
    return res.status(500).json({ error: 'Respons AI tidak valid, tidak jadi disimpan.' });
  }

  topics = topics.slice(0, 4).map((t, i) => (typeof t === 'string' && t.trim()) ? t.trim() : FALLBACK_TOPICS[i]);
  while (topics.length < 4) {
    topics.push(FALLBACK_TOPICS[topics.length]);
  }

  const finalTopics = topics.map((text, i) => ({
    icon: ICON_PALETTE[i].icon,
    color: ICON_PALETTE[i].color,
    text,
  }));

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi.' });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { error: insertError } = await supabase.from('daily_suggestions').insert({ topics: finalTopics });

  if (insertError) {
    console.error('Gagal simpan ke Supabase:', insertError.message);
    return res.status(500).json({ error: 'Gagal menyimpan topik ke database', detail: insertError.message });
  }

  return res.status(200).json({ success: true, topics: finalTopics });
}
