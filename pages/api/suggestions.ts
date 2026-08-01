// @ts-nocheck
import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Allow CORS from frontend
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method non-autorisé' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return res.status(500).json({ error: 'Supabase tidak dikonfigurasi' });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Coba urutkan berdasarkan id DESC dahulu
    let { data, error } = await supabase
      .from('daily_suggestions')
      .select('topics')
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    // 2. Jika gagal atau tidak ketemu, coba urutkan berdasarkan created_at DESC
    if (error || !data) {
      const fallbackQuery = await supabase
        .from('daily_suggestions')
        .select('topics')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (fallbackQuery.data) {
        data = fallbackQuery.data;
        error = null;
      }
    }

    // 3. Jika masih tidak ketemu karena masalah nama kolom sort, ambil baris terakhir
    if (error || !data) {
      const allRows = await supabase
        .from('daily_suggestions')
        .select('topics');
      if (allRows.data && allRows.data.length > 0) {
        data = allRows.data[allRows.data.length - 1];
        error = null;
      }
    }

    if (error) {
      console.error('Error fetching daily_suggestions:', error.message);
      return res.status(500).json({ error: error.message });
    }

    if (!data || !data.topics) {
      return res.status(404).json({ error: 'Belum ada saran topik' });
    }

    // Cache control agar respons di web sangat cepat
    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
    return res.status(200).json({ success: true, topics: data.topics });
  } catch (err: any) {
    console.error('Server error /api/suggestions:', err);
    return res.status(500).json({ error: err?.message || 'Server error' });
  }
}
