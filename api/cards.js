// GET /api/cards — every card RecallDeutsch can read out, rebuilt live on each call:
//   Verb Meister verbs (SprintDeutsch) + Karteikasten verbs with prepositions + adjectives.
// Header: x-sync-key (the Verb Meister sync key).
import { requireKey, syncKey } from './_auth.js';
import { loadAllCards } from './_sources.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method not allowed' });
  }
  if (!requireKey(req, res)) return;
  try {
    const doc = await loadAllCards(syncKey());
    const anyOk = doc.sources.verbmeister.ok || doc.sources.karteikasten.ok;
    return res.status(anyOk ? 200 : 502).json(doc);
  } catch (err) {
    return res.status(500).json({ error: 'cards-failed', detail: String(err && err.message || err) });
  }
}
