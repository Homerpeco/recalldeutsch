// POST /api/cues  {"items": [{"id": "vm:1", "de": "verschwenden", "meaning": "malgastar, derrochar, ..."}, ...]}
// → {"cues": [{"id": "vm:1", "es": ["desperdiciar", "derrochar"], "en": ["to waste", "to squander"]}], "model": "..."}
// At most 30 items per call. The phone caches the result per card (cueKey), so each card is done once.
// Header: x-sync-key. Without GEMINI_API_KEY here, the request goes to SprintDeutsch's /api/recall-cues.
import { requireKey, syncKey } from './_auth.js';
import { makeCues, MAX_ITEMS } from './_cues.js';
import { SPRINT_URL } from './_sources.js';

export const maxDuration = 60;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  if (!requireKey(req, res)) return;
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const items = (Array.isArray(body && body.items) ? body.items : [])
    .slice(0, MAX_ITEMS)
    .map(i => ({ id: String(i && i.id || ''), de: String(i && i.de || '').slice(0, 120), meaning: String(i && i.meaning || '').slice(0, 600) }))
    .filter(i => i.id && i.de);
  if (!items.length) return res.status(400).json({ error: 'items required' });

  if (!process.env.GEMINI_API_KEY) {
    try {
      const r = await fetch(SPRINT_URL + '/api/recall-cues', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sync-key': syncKey() },
        body: JSON.stringify({ items }),
      });
      const text = await r.text();
      const ra = r.headers.get('retry-after');
      if (ra) res.setHeader('Retry-After', ra);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('X-Cues-Via', 'sprintdeutsch');
      return res.status(r.status).send(text);
    } catch (err) {
      return res.status(502).json({ error: 'cues-failed', detail: 'SprintDeutsch not reachable: ' + String(err && err.message || err), retryAfter: 0 });
    }
  }

  try {
    return res.status(200).json(await makeCues(items));
  } catch (err) {
    const status = err.status === 429 ? 429 : err.status === 500 ? 500 : 502;
    if (err.retryAfter) res.setHeader('Retry-After', String(err.retryAfter));
    return res.status(status).json({ error: status === 429 ? 'quota' : 'cues-failed', detail: String(err.message || err), retryAfter: err.retryAfter || 0 });
  }
}
