// api/events.js  — Vercel Serverless Function (Node.js)
// Handles CORS (OPTIONS), simple health check (GET), and your form submit (POST).

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); // or restrict to your domain
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async function handler(req, res) {
  try {
    setCors(res);

    // 1) Preflight from browsers
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    // 2) Simple health check: GET /api/events
    if (req.method === 'GET') {
      return res.status(200).json({ ok: true, service: 'events-endpoint' });
    }

    // 3) Main submit: POST /api/events
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
    if (body.secret !== SECRET) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    if (!body['Application Link']) {
      return res.status(400).json({ ok: false, error: 'missing_application_link' });
    }

    const ENTRY_MAP = JSON.parse(ENTRY_MAP_JSON); // { "Header": "entry.123..." } or { "Header": {year,month,day} }
    const form = new URLSearchParams();

    // helper: split "YYYY-MM-DD" or "MM/DD/YYYY" into year/month/day
    const splitDate = (input) => {
      if (!input) return {};
      const iso = String(input).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (iso) return { year: iso[1], month: String(Number(iso[2])), day: String(Number(iso[3])) };
      const us = String(input).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (us) return { year: us[3], month: String(Number(us[1])), day: String(Number(us[2])) };
      return { month: String(input) }; // fallback: let Forms coerce
    };

    // Build form payload from your mapping
    for (const [label, entryDef] of Object.entries(ENTRY_MAP)) {
      const value = body[label] ?? '';
      if (!entryDef) continue;

      if (typeof entryDef === 'string') {
        form.set(entryDef, value);
      } else if (entryDef && typeof entryDef === 'object') {
        const { year, month, day } = splitDate(value);
        if (entryDef.year && year) form.set(entryDef.year, year);
        if (entryDef.month && month) form.set(entryDef.month, month);
        if (entryDef.day && day) form.set(entryDef.day, day);
      }
    }

    // required extras to avoid redirect loop
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

