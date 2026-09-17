// Card sources for RecallDeutsch.
//   • Verb Meister (SprintDeutsch)  — live JSON behind /api/verbs, grows every week
//   • Karteikasten                   — prepositionsDB + adjectivesDB, read from the live page
// Both are fetched on every sync, so the phone mirrors whatever the two apps hold today.
import vm from 'node:vm';
import { createHash } from 'node:crypto';

export const SPRINT_URL = (process.env.SPRINTDEUTSCH_URL || 'https://sprintdeutsch.vercel.app').replace(/\/$/, '');
export const KARTEI_URL = (process.env.KARTEIKASTEN_URL || 'https://karteikasten-vercel.vercel.app/');

const CASE_DE = { A: 'Akkusativ', D: 'Dativ', G: 'Genitiv', N: 'Nominativ',
  Accusative: 'Akkusativ', Dative: 'Dativ', Genitive: 'Genitiv', Nominative: 'Nominativ' };

const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const stripTags = s => clean(String(s || '').replace(/<[^>]*>/g, ''));
// "sich freuen (future)" → "sich freuen"
const stripNote = s => clean(String(s || '').replace(/\s*\([^)]*\)\s*/g, ' '));
const caseDe = c => CASE_DE[c] || CASE_DE[String(c || '').trim()] || '';
const hash = s => createHash('sha1').update(s).digest('hex').slice(0, 16);

// ---------------------------------------------------------------------------
// Karteikasten: pull an array/object literal out of the page's inline script.
// A string- and comment-aware bracket matcher, then evaluated in an empty VM
// context (no DOM, no globals, 1 s timeout) — the literals are plain data.
// ---------------------------------------------------------------------------
export function extractLiteral(html, name) {
  const decl = new RegExp('(?:const|let|var)\\s+' + name + '\\s*=\\s*');
  const m = decl.exec(html);
  if (!m) throw new Error(`"${name}" not found in Karteikasten page`);
  const start = m.index + m[0].length;
  const open = html[start];
  if (open !== '[' && open !== '{') throw new Error(`"${name}" is not an array/object literal`);
  let depth = 0, inStr = null;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (c === '\\') { j++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '/' && html[j + 1] === '/') { const nl = html.indexOf('\n', j); j = nl === -1 ? html.length : nl; continue; }
    if (c === '/' && html[j + 1] === '*') { const end = html.indexOf('*/', j + 2); j = end === -1 ? html.length : end + 1; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) {
        return vm.runInNewContext('(' + html.slice(start, j + 1) + ')', Object.create(null), { timeout: 1000 });
      }
    }
  }
  throw new Error(`"${name}" literal is not closed`);
}

function firstExample(examples, key) {
  const pair = examples && Array.isArray(examples[key]) ? examples[key][0] : null;
  if (!pair) return { de: '', en: '' };
  return { de: stripTags(pair[0]), en: stripTags(pair[1]) };
}

export function karteikastenCards(html) {
  const preps = extractLiteral(html, 'prepositionsDB');
  const adjs = extractLiteral(html, 'adjectivesDB');
  let examples = {};
  try { examples = extractLiteral(html, 'PREP_EXAMPLES'); } catch { /* examples are optional */ }

  const out = [];
  for (const p of preps) {
    if (!p || !p.word || !p.prep) continue;
    const key = p.key || p.word;
    const kkId = 'prep:' + key;                       // same id Karteikasten uses
    out.push(prepCard({ id: 'kk:' + kkId, deck: 'prep', word: p.word, prep: p.prep, kase: p.case,
      meaning: p.trans, example: firstExample(examples, key) }));
  }
  for (const a of adjs) {
    if (!a || !a.word || !a.prep) continue;
    const key = a.key || a.word;
    const kkId = a.legacyId || ('adj:' + key);        // same id Karteikasten uses
    out.push(prepCard({ id: 'kk:' + kkId, deck: 'adj', word: a.word, prep: a.prep, kase: a.case,
      meaning: a.trans, example: firstExample(examples, key) }));
  }
  return out;
}

function prepCard({ id, deck, word, prep, kase, meaning, example }) {
  const head = stripNote(word);
  const cDe = caseDe(kase);
  const answer = `${head} ${clean(prep)}`;
  // Spoken: "sich freuen auf. Akkusativ." — the full stop gives a natural pause.
  const speakDe = cDe ? `${answer}. ${cDe}.` : `${answer}.`;
  return finish({
    id, source: 'karteikasten', deck,
    prompt: clean(meaning),
    answer,
    lines: cDe ? [`${clean(prep)} + ${cDe}`] : [],
    speakDe,
    exampleDe: example.de, exampleEn: example.en,
    box: null,
  });
}

// ---------------------------------------------------------------------------
// Verb Meister
// ---------------------------------------------------------------------------
function auxWord(aux) {
  const a = String(aux || '').toLowerCase();
  const s = a.includes('s'), h = a.includes('h');
  if (s && h) return 'hat/ist';
  if (a.startsWith('s')) return 'ist';
  return 'hat';
}

export function verbMeisterCard(v) {
  if (!v || !v.id || !clean(v.infinitive)) return null;
  const inf = clean(v.infinitive).replace(/^sich\s+/i, '');
  const refl = !!v.reflexive;
  const head = (refl ? 'sich ' : '') + inf;
  const preps = (Array.isArray(v.prepositions) ? v.prepositions : [])
    .map(p => ({ prep: clean(p && p.prep), kase: caseDe(p && p.case) }))
    .filter(p => p.prep);

  const lines = [];
  const spoken = [];

  const c = v.conj;
  const hasParts = !!(c && (clean(c.preterite) || clean(c.partizip)));
  // Reflexive principal parts: "zieht an" → "zieht sich an", "hat sich angezogen".
  const withSich = form => {
    if (!refl || !form) return form;
    const parts = form.split(' ');
    return [parts[0], 'sich', ...parts.slice(1)].join(' ');
  };
  if (hasParts) {
    const pres = withSich(clean(c.present)), pret = withSich(clean(c.preterite)), part = clean(c.partizip);
    const aux = auxWord(c.auxiliary);
    const perf = part ? (refl ? `${aux} sich ${part}` : `${aux} ${part}`) : '';
    const forms = [pres, pret, perf].filter(Boolean);
    lines.push(forms.join(' · '));
    spoken.push(`${head}. ${forms.join(', ')}.`);
  }

  if (preps.length) {
    lines.push(preps.map(p => p.kase ? `${p.prep} + ${p.kase}` : p.prep).join('  ·  '));
    // "sich freuen auf. Akkusativ. Und über. Akkusativ."
    spoken.push(preps.map((p, i) => {
      const lead = i === 0 ? `${head} ${p.prep}` : `Und ${p.prep}`;
      return p.kase ? `${lead}. ${p.kase}.` : `${lead}.`;
    }).join(' '));
  }
  if (!spoken.length) spoken.push(`${head}.`);

  const ex = Array.isArray(v.examples) ? v.examples.map(clean).filter(Boolean) : [];
  const box = Number(v.srs && v.srs.box) || 1;
  return finish({
    id: 'vm:' + v.id, source: 'verbmeister', deck: 'verb',
    prompt: clean(v.meaning),
    answer: preps.length && !hasParts ? `${head} ${preps.map(p => p.prep).join(' / ')}` : head,
    lines,
    speakDe: spoken.join(' '),
    exampleDe: ex[0] || '', exampleEn: '',
    box: Math.min(6, Math.max(1, box)),
  });
}

// What the phone's English voice says: "to prevent / keep from" → "to prevent, or keep from".
export function spokenEnglish(s) {
  return clean(String(s || '')
    .replace(/\s*\/\s*/g, ', or ')
    .replace(/\(([^)]*)\)/g, ', $1,')
    .replace(/\bsb\b\.?/gi, 'somebody')
    .replace(/\bsth\b\.?/gi, 'something')
    .replace(/\s+,/g, ',')
    .replace(/,+\s*$/, ''));
}

function finish(card) {
  card.speakEn = spokenEnglish(card.prompt);
  card.audioKey = hash(card.speakDe);   // changes when the German text changes → re-record
  return card;
}

// ---------------------------------------------------------------------------
// Fetchers (fetch is injectable for tests)
// ---------------------------------------------------------------------------
async function withTimeout(fetchImpl, url, opts = {}, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetchImpl(url, { ...opts, signal: ctl.signal }); }
  finally { clearTimeout(t); }
}

export async function loadKarteikasten(fetchImpl = fetch) {
  const res = await withTimeout(fetchImpl, KARTEI_URL, { headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error('Karteikasten HTTP ' + res.status);
  return karteikastenCards(await res.text());
}

export async function loadVerbMeister(key, fetchImpl = fetch) {
  const res = await withTimeout(fetchImpl, SPRINT_URL + '/api/verbs', { headers: { 'x-sync-key': key } });
  if (res.status === 401) throw new Error('SprintDeutsch refused the sync key (401)');
  if (!res.ok) throw new Error('SprintDeutsch /api/verbs HTTP ' + res.status);
  const doc = await res.json();
  const verbs = Array.isArray(doc && doc.verbs) ? doc.verbs : [];
  return verbs.map(verbMeisterCard).filter(Boolean);
}

// Loads both sources independently: one failing never hides the other, and the
// phone only mirrors deletions for a source that reported ok:true.
export async function loadAllCards(key, fetchImpl = fetch) {
  const [vmR, kkR] = await Promise.allSettled([loadVerbMeister(key, fetchImpl), loadKarteikasten(fetchImpl)]);
  const sources = {
    verbmeister: vmR.status === 'fulfilled' ? { ok: true, count: vmR.value.length } : { ok: false, count: 0, error: String(vmR.reason && vmR.reason.message || vmR.reason) },
    karteikasten: kkR.status === 'fulfilled' ? { ok: true, count: kkR.value.length } : { ok: false, count: 0, error: String(kkR.reason && kkR.reason.message || kkR.reason) },
  };
  const cards = [];
  const seen = new Set();
  for (const list of [vmR.value || [], kkR.value || []]) {
    for (const c of list) { if (!seen.has(c.id)) { seen.add(c.id); cards.push(c); } }
  }
  return { generatedAt: new Date().toISOString(), sources, cards };
}
