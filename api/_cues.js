// Recall cues: turn a card's meaning (often a long dictionary list mixing English, Spanish and
// German, sometimes with typos) into 1–3 short Spanish and 1–3 short English equivalents, so the
// phone can read each language with its own native voice.
// Same code in SprintDeutsch as app/api/_recall_cues.js (there the key is VITE_GEMINI_API_KEY).

const API = 'https://generativelanguage.googleapis.com/v1beta';
export const MAX_ITEMS = 30;

export function cueModels() {
  const env = (process.env.CUE_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
  // The -latest aliases are what works on Tolomeo's key (2.5 models are gated off new keys).
  return env.length ? env : ['gemini-flash-lite-latest', 'gemini-flash-latest'];
}

export class CueError extends Error {
  constructor(message, { status = 502, retryAfter = 0 } = {}) { super(message); this.status = status; this.retryAfter = retryAfter; }
}

const INSTRUCTIONS = `You prepare short recall cues for a German learner whose native language is Spanish and who is fluent in English.
Each item has: id, "de" (the German verb or adjective, with its preposition and case when it has one) and "meaning" (the learner's own notes: often a long dictionary list that mixes English, Spanish and German, sometimes with typos, sometimes empty).
For every item return:
- "es": 1 to 3 short Spanish equivalents of THIS German entry, most common sense first. Prefer the learner's own Spanish words when they are correct, fix their typos. Verbs in the infinitive ("desperdiciar"); keep the Spanish preposition when the German entry has a preposition ("depender de", "alegrarse de").
- "en": 1 to 3 short English equivalents with the same rules; verbs as "to ..." ("to waste").
If the notes are only in one language, translate for the other. If a note in parentheses is needed to tell two senses apart ("to work for (an employer)"), keep it, at most 3 words. No other explanations, no German words.
Return only a JSON array of objects {"id", "es", "en"}, one per item, in the same order.`;

export function buildPrompt(items) {
  return INSTRUCTIONS + '\n\nItems:\n' + items.map(i => JSON.stringify({ id: i.id, de: i.de, meaning: i.meaning || '' })).join('\n');
}

const tidy = s => String(s || '').replace(/\s+/g, ' ').replace(/^["'“”„\s]+|["'“”\s.;,]+$/g, '').trim();

export function parseCues(text, ids) {
  let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = t.indexOf('['), b = t.lastIndexOf(']');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  let arr;
  try { arr = JSON.parse(t); } catch { throw new CueError('Gemini did not return JSON'); }
  if (!Array.isArray(arr)) throw new CueError('Gemini did not return a list');
  const wanted = new Set(ids);
  const out = [];
  for (const o of arr) {
    if (!o || !wanted.has(o.id)) continue;
    const list = x => (Array.isArray(x) ? x : typeof x === 'string' ? x.split(/[,;]/) : [])
      .map(tidy).filter(w => w && w.length <= 60).slice(0, 3);
    const es = list(o.es), en = list(o.en);
    if (es.length || en.length) out.push({ id: o.id, es, en });
    wanted.delete(o.id);
  }
  return out;
}

function retryDelay(json, headers) {
  const h = headers && headers.get && headers.get('retry-after');
  if (h && !isNaN(Number(h))) return Number(h);
  for (const d of (json && json.error && json.error.details) || []) {
    const m = /([\d.]+)s/.exec(d && d.retryDelay || '');
    if (m) return Math.ceil(Number(m[1]));
  }
  return 60;
}

export async function makeCues(items, { fetchImpl = fetch, key = process.env.GEMINI_API_KEY } = {}) {
  if (!key) throw new CueError('No Gemini key in the Vercel project.', { status: 500 });
  const clean = items.slice(0, MAX_ITEMS).filter(i => i && i.id && i.de);
  if (!clean.length) return { cues: [], model: '' };
  const body = {
    contents: [{ role: 'user', parts: [{ text: buildPrompt(clean) }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
  };
  let last = null, quota = null;
  for (const model of cueModels()) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 40000);
    try {
      const res = await fetchImpl(`${API}/models/${model}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body), signal: ctl.signal,
      });
      let json = null;
      try { json = await res.json(); } catch { /* not JSON */ }
      if (!res.ok) {
        const msg = (json && json.error && json.error.message) || 'HTTP ' + res.status;
        if (res.status === 401 || res.status === 403) throw new CueError('Gemini rejected the API key: ' + msg);
        if (res.status === 429) { quota = new CueError('Gemini quota reached: ' + msg, { status: 429, retryAfter: retryDelay(json, res.headers) }); continue; }
        last = new CueError(`Gemini ${res.status}: ${msg}`);
        continue;
      }
      // Thinking models may send "thought" parts first — only real text counts.
      const parts = (json && json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) || [];
      const text = parts.filter(p => p && !p.thought && typeof p.text === 'string').map(p => p.text).join('');
      if (!text) { last = new CueError('Gemini answered without text'); continue; }
      return { cues: parseCues(text, clean.map(i => i.id)), model };
    } catch (e) {
      if (e instanceof CueError && /API key/.test(e.message)) throw e;
      last = e instanceof CueError ? e : new CueError('Gemini request failed: ' + (e && e.message || e), { status: 504 });
    } finally { clearTimeout(timer); }
  }
  throw quota || last || new CueError('Gemini failed');
}
