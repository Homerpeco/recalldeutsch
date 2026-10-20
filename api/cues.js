// POST /api/cues  {"items": [{"id": "vm:1", "de": "verschwenden", "meaning": "malgastar, derrochar, ..."}, ...]}
// → {"cues": [{"id": "vm:1", "es": ["desperdiciar", "derrochar"], "en": ["to waste", "to squander"]}], "model": "..."}
// At most 30 items per call. The phone caches the result per card (cueKey), so each card is done once.
// Header: x-sync-key.
// 1. Cards with teacher-checked cues (api/_glossary.js) are answered from that table — no model involved.
// 2. The rest go to Gemini (here, or SprintDeutsch's /api/recall-cues when this project has no
//    GEMINI_API_KEY). Their example sentences are added to the meaning, so the model sees which sense the
//    card is about instead of guessing from a three-word gloss ("passen zu: to match with" → "pegar con").
import { requireKey, syncKey } from './_auth.js';
import { makeCues, MAX_ITEMS } from './_cues.js';
import { SPRINT_URL, loadAllCards } from './_sources.js';
import { curatedCues } from './_glossary.js';

export const maxDuration = 60;

/** Adds each card's first two example sentences to its meaning. Never fails: on any error the items stay as they are. */
export async function withExamples(items, load = () => loadAllCards(syncKey())) {
  try {
    const doc = await load();
    const byId = new Map((doc && doc.cards || []).map(c => [c.id, c]));
    return items.map(i => {
      const ex = (byId.get(i.id) || {}).examples || [];
      return ex.length ? { ...i, meaning: `${i.meaning} | used as in: ${ex.slice(0, 2).join(' ')}`.slice(0, 600) } : i;
    });
  } catch {
    return items;
  }
}

export function splitCurated(items) {
  const curated = [], rest = [];
  for (const i of items) {
    const c = curatedCues(i.id, i.meaning);
    if (c) curated.push({ id: i.id, es: c.es, en: c.en }); else rest.push(i);
  }
  return { curated, rest };
}

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

  const { curated, rest } = splitCurated(items);
  if (!rest.length) return res.status(200).json({ cues: curated, model: 'curated' });
  const toModel = await withExamples(rest);

  if (!process.env.GEMINI_API_KEY) {
    try {
      const r = await fetch(SPRINT_URL + '/api/recall-cues', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sync-key': syncKey() },
        body: JSON.stringify({ items: toModel }),
      });
      const text = await r.text();
      res.setHeader('X-Cues-Via', 'sprintdeutsch');
      if (r.ok) {
        let doc = null;
        try { doc = JSON.parse(text); } catch { /* handled below */ }
        if (doc && Array.isArray(doc.cues)) return res.status(200).json({ cues: [...curated, ...doc.cues], model: doc.model || '' });
      }
      if (curated.length) return res.status(200).json({ cues: curated, model: 'curated' });   // the rest is retried later
      const ra = r.headers.get('retry-after');
      if (ra) res.setHeader('Retry-After', ra);
      res.setHeader('Content-Type', 'application/json');
      return res.status(r.ok ? 502 : r.status).send(text);
    } catch (err) {
      if (curated.length) return res.status(200).json({ cues: curated, model: 'curated' });
      return res.status(502).json({ error: 'cues-failed', detail: 'SprintDeutsch not reachable: ' + String(err && err.message || err), retryAfter: 0 });
    }
  }

  try {
    const out = await makeCues(toModel);
    return res.status(200).json({ cues: [...curated, ...out.cues], model: out.model });
  } catch (err) {
    if (curated.length) return res.status(200).json({ cues: curated, model: 'curated' });
    const status = err.status === 429 ? 429 : err.status === 500 ? 500 : 502;
    if (err.retryAfter) res.setHeader('Retry-After', String(err.retryAfter));
    return res.status(status).json({ error: status === 429 ? 'quota' : 'cues-failed', detail: String(err.message || err), retryAfter: err.retryAfter || 0 });
  }
}
