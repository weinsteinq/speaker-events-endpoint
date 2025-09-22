// api/events.js — Vercel Serverless Function (Node.js)
// Handles CORS (OPTIONS), health check (GET), and form submit (POST).

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); // tighten later if desired
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async function handler(req, res) {
  try {
    setCors(res);

    // 1) Pre-flight
    if (req.method === 'OPTIONS') return res.status(200).end();

    // 2) Health check
    if (req.method === 'GET') {
      return res.status(200).json({ ok: true, service: 'events-endpoint' });
    }

    // 3) Submit
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    const body = req.body || {};
    const SECRET = process.env.EVENTS_WEBHOOK_SECRET;
    const FORM_ACTION_URL = process.env.FORM_ACTION_URL;
    const ENTRY_MAP_JSON = process.env.FORM_ENTRY_MAP_JSON;

    if (!SECRET || !FORM_ACTION_URL || !ENTRY_MAP_JSON) {
      return res.status(500).json({ ok: false, error: 'missing_env_vars' });
    }

    // ---------- DEEP DEBUG (remove after fix) ----------
    const toHex = str => Buffer.from(str || '', 'utf8').toString('hex');
    console.log(
      'body.secret len=', (body.secret || '').length,
      'env len=', (SECRET || '').length
    );
    console.log('body.secret hex=', toHex(body.secret), 'env hex=', toHex(SECRET));
    // ---------------------------------------------------

    if (body.secret !== SECRET) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    if (!body['Application Link']) {
      return res.status(400).json({ ok: false, error: 'missing_application_link' });
    }

    const ENTRY_MAP = JSON.parse(ENTRY_MAP_JSON);
    const form = new URLSearchParams();

    // helper: split "YYYY-MM-DD" or "MM/DD/YYYY"
    const splitDate = (input) => {
      if (!input) return {};
      const iso = String(input).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (iso) return { year: iso[1], month: String(Number(iso[2])), day: String(Number(iso[3])) };
      const us = String(input).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (us) return { year: us[3], month: String(Number(us[1])), day: String(Number(us[2])) };
      return { month: String(input) };
    };

    // Build Google-Form payload
    for (const [label, entryDef] of Object.entries(ENTRY_MAP)) {
      const value = body[label] ?? '';
      if (!entryDef) continue;

      if (typeof entryDef === 'string') {
        form.set(entryDef, value);
      } else if (typeof entryDef === 'object') {
        const { year, month, day } = splitDate(value);
        if (entryDef.year && year) form.set(entryDef.year, year);
        if (entryDef.month && month) form.set(entryDef.month, month);
        if (entryDef.day && day) form.set(entryDef.day, day);
      }
    }

    // Required extras
    form.set('fvv', '1');
    form.set('partialResponse', '[]');
    form.set('pageHistory', '0');

    const response = await fetch(FORM_ACTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: form.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(502).json({ ok: false, error: 'form_submit_failed', status: response.status, text });
    }

    return res.status(200).json({ ok: true, submitted: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: 'server_error', detail: err?.message });
  }
};
