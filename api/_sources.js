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

function examplesFor(examples, key) {
  const pairs = examples && Array.isArray(examples[key]) ? examples[key] : [];
  return pairs.map(p => ({ de: endSentence(stripTags(p && p[0])), en: stripTags(p && p[1]) })).filter(p => p.de);
}

// "Sami verschwendete keine Zeit" → "Sami verschwendete keine Zeit."
const endSentence = s => { const t = clean(s); return !t || /[.!?…"“”»]$/.test(t) ? t : t + '.'; };

// ---------------------------------------------------------------------------
// Conjugation — regular verbs use Verb Meister's own rule (regularConj in verb-tracker.html),
// so RecallDeutsch reads exactly the forms Verb Meister shows. Irregular verbs use stored forms.
// ---------------------------------------------------------------------------
// Regular (weak) verbs that take "sein" in the Perfekt. Verb Meister shows "hat" for every regular verb;
// these are the common exceptions, so the spoken Perfekt is right.
const SEIN_REGULAR = new Set(['reisen', 'verreisen', 'wandern', 'auswandern', 'einwandern', 'landen', 'klettern',
  'joggen', 'segeln', 'stolpern', 'stürzen', 'abstürzen', 'eilen', 'flüchten', 'marschieren', 'spazieren',
  'begegnen', 'folgen', 'passieren', 'aufwachen', 'erwachen', 'zurückkehren', 'heimkehren', 'scheitern',
  'explodieren', 'platzen', 'erröten', 'verblühen', 'verwelken', 'verhungern', 'verdursten', 'auftauchen',
  'erkranken', 'verarmen', 'erstarren', 'krabbeln', 'rutschen', 'ausrutschen', 'eintreten', 'emigrieren',
  'immigrieren', 'desertieren', 'verunglücken', 'erfolgen', 'gelangen', 'enteilen', 'aufrücken']);

export function regularForms(infinitive, { separable = false, prefix = '' } = {}) {
  const inf = clean(infinitive).toLowerCase().replace(/^sich\s+/, '');
  const pfx = (separable && prefix && inf.startsWith(prefix.toLowerCase())) ? prefix.toLowerCase() : '';
  const core = pfx ? inf.slice(pfx.length) : inf;
  let stem;
  if (/(eln|ern)$/.test(core)) stem = core.slice(0, -1);        // klingeln → klingel-
  else if (/en$/.test(core)) stem = core.slice(0, -2);
  else if (/n$/.test(core)) stem = core.slice(0, -1);
  else stem = core;
  const eEp = /(?:[td]|chn|ffn|gn|dm|tm)$/.test(stem) ? 'e' : '';  // arbeitet, öffnet, atmet
  const sEnd = /(?:s|ß|x|z)$/.test(stem);                          // reist, not reisst
  const present3 = stem + (sEnd ? 't' : eEp + 't');
  const pret3 = stem + eEp + 'te';
  // No ge- for inseparable prefixes and -ieren verbs. Verb Meister's rule misses the inseparable use of the
  // dual prefixes (überzeugen → "geüberzeugt"); a dual-prefix verb that is not marked separable is inseparable.
  const dualInsep = !pfx && /^(durch|über|unter|um|wider|wieder|voll)/.test(core) && core.length > 6;
  const noGe = /^(be|ge|emp|ent|er|miss|ver|zer|hinter)/.test(core) || /ieren$/.test(core) || dualInsep;
  const part = pfx + (noGe ? '' : 'ge') + stem + eEp + 't';
  return {
    present: present3 + (pfx ? ' ' + pfx : ''),
    preterite: pret3 + (pfx ? ' ' + pfx : ''),
    partizip: part,
    auxiliary: SEIN_REGULAR.has(inf) ? 'sein' : 'haben',
  };
}

function auxWord(aux) {
  const a = String(aux || '').toLowerCase();
  const s = a.includes('s'), h = a.includes('h');
  if (s && h) return 'hat/ist';
  if (a.startsWith('s')) return 'ist';
  return 'hat';
}

// "zieht an" → "zieht sich an"
const insertSich = form => { const w = form.split(' '); return [w[0], 'sich', ...w.slice(1)].join(' '); };

/** [3rd person present, Präteritum, Perfekt] — "verschwendet", "verschwendete", "hat verschwendet". */
export function threeForms({ present, preterite, partizip, auxiliary }, reflexive = false) {
  const pres = clean(present), pret = clean(preterite), part = clean(partizip);
  if (!pres && !pret && !part) return [];
  const sich = f => (reflexive && f && !/\bsich\b/.test(f)) ? insertSich(f) : f;
  const perf = part ? `${auxWord(auxiliary)} ${reflexive && !/\bsich\b/.test(part) ? 'sich ' : ''}${part}` : '';
  return [sich(pres), sich(pret), perf].filter(Boolean);
}

/** Forms for a Verb Meister verb, following Verb Meister's own choice (irregular → stored, else regular rule). */
export function verbMeisterForms(v) {
  const refl = !!v.reflexive;
  const c = v.conj;
  const stored = c && (clean(c.present) || clean(c.preterite) || clean(c.partizip));
  if (v.irregular || (stored && v.irregular === undefined)) {
    return stored ? threeForms(c, refl) : [];
  }
  return threeForms(regularForms(v.infinitive, { separable: v.separable, prefix: v.prefix }), refl);
}

// ---------------------------------------------------------------------------
// Card building
// ---------------------------------------------------------------------------
/** What is spoken in German, one part per line: infinitive → the three forms → every example sentence. */
function germanScript({ infinitivePart, forms, examples }) {
  const parts = [infinitivePart];
  if (forms.length) parts.push(forms.join(', ') + '.');
  for (const e of examples) parts.push(endSentence(e));
  return parts.filter(Boolean).join('\n');
}

export function karteikastenCards(html, { formsFor = () => null } = {}) {
  const preps = extractLiteral(html, 'prepositionsDB');
  const adjs = extractLiteral(html, 'adjectivesDB');
  let examples = {};
  try { examples = extractLiteral(html, 'PREP_EXAMPLES'); } catch { /* examples are optional */ }
  let irregular = [];
  try { irregular = extractLiteral(html, 'irregularVerbsDB'); } catch { /* optional */ }
  const kkIrregular = new Map();
  for (const v of irregular) {
    if (!v || !v.inf) continue;
    const m = /^(hat\/ist|ist\/hat|hat|ist)\s+(.+)$/.exec(clean(v.perf));
    kkIrregular.set(clean(v.inf).toLowerCase(), { present: v.pres, preterite: v.past,
      partizip: m ? m[2] : clean(v.perf), auxiliary: m ? (m[1].includes('/') ? 'sein/haben' : m[1] === 'ist' ? 'sein' : 'haben') : 'haben' });
  }
  const lookupForms = head => {
    const refl = /^sich\s+/i.test(head);
    const bare = head.replace(/^sich\s+/i, '').toLowerCase();
    const kk = kkIrregular.get(bare);
    if (kk) return threeForms(kk, refl);
    const fromVm = formsFor(bare, refl);
    return fromVm && fromVm.length ? fromVm : [];
  };

  const out = [];
  for (const p of preps) {
    if (!p || !p.word || !p.prep) continue;
    const key = p.key || p.word;
    const head = stripNote(p.word);
    out.push(prepCard({ id: 'kk:prep:' + key, deck: 'prep', head, prep: p.prep, kase: p.case,
      meaning: p.trans, examples: examplesFor(examples, key), forms: lookupForms(head) }));
  }
  for (const a of adjs) {
    if (!a || !a.word || !a.prep) continue;
    const key = a.key || a.word;
    out.push(prepCard({ id: 'kk:' + (a.legacyId || ('adj:' + key)), deck: 'adj', head: stripNote(a.word), prep: a.prep,
      kase: a.case, meaning: a.trans, examples: examplesFor(examples, key), forms: [] }));
  }
  return out;
}

function prepCard({ id, deck, head, prep, kase, meaning, examples, forms }) {
  const cDe = caseDe(kase);
  const answer = `${head} ${clean(prep)}`;
  const prepLine = cDe ? `${clean(prep)} + ${cDe}` : '';
  return finish({
    id, source: 'karteikasten', deck,
    prompt: clean(meaning),
    answer,
    forms: forms.join(' · '),
    prepLine,
    examples: examples.map(e => e.de),
    exampleEn: examples[0] ? examples[0].en : '',
    speakDe: germanScript({
      infinitivePart: cDe ? `${answer}. ${cDe}.` : `${answer}.`,   // "sich freuen auf. Akkusativ."
      forms,
      examples: examples.map(e => e.de),
    }),
    box: null,
  });
}

// Verb Meister's preposition field is free text: "Auf", "sich mit", "sich richten nach = depend on" → "auf", "mit", "nach".
export function cleanPrep(p) {
  const before = clean(p).split('=')[0].trim();
  const words = before.split(/\s+/).filter(Boolean);
  return words.length ? words[words.length - 1].toLowerCase() : '';
}

export function verbMeisterCard(v) {
  if (!v || !v.id || !clean(v.infinitive)) return null;
  const inf = clean(v.infinitive).replace(/^sich\s+/i, '');
  const head = (v.reflexive ? 'sich ' : '') + inf;
  const preps = (Array.isArray(v.prepositions) ? v.prepositions : [])
    .map(p => ({ prep: cleanPrep(p && p.prep), kase: caseDe(p && p.case) }))
    .filter(p => p.prep);
  const forms = verbMeisterForms(v);
  const examples = (Array.isArray(v.examples) ? v.examples : []).map(endSentence).filter(Boolean).slice(0, 3);

  // "sich freuen auf. Akkusativ. Und über. Akkusativ."
  const infinitivePart = preps.length
    ? preps.map((p, i) => {
        const lead = i === 0 ? `${head} ${p.prep}` : `Und ${p.prep}`;
        return p.kase ? `${lead}. ${p.kase}.` : `${lead}.`;
      }).join(' ')
    : `${head}.`;

  const box = Number(v.srs && v.srs.box) || 1;
  return finish({
    id: 'vm:' + v.id, source: 'verbmeister', deck: 'verb',
    prompt: clean(v.meaning),
    answer: preps.length ? `${head} ${preps.map(p => p.prep).join(' / ')}` : head,
    forms: forms.join(' · '),
    prepLine: preps.map(p => p.kase ? `${p.prep} + ${p.kase}` : p.prep).join('  ·  '),
    examples,
    exampleEn: '',
    speakDe: germanScript({ infinitivePart, forms, examples }),
    box: Math.min(6, Math.max(1, box)),
  });
}

// Fallback English reading of the raw meaning (the app prefers the cleaned cues from /api/cues).
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
  card.lines = [card.forms, card.prepLine].filter(Boolean);      // for app v1.0
  card.exampleDe = card.examples[0] || '';                         // for app v1.0
  card.speakEn = spokenEnglish(card.prompt);
  card.audioKey = hash(card.speakDe);                              // German text changed → re-record
  card.cueKey = hash(card.deck + '|' + card.answer + '|' + card.prompt);   // meaning changed → new cues
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

async function fetchKarteikastenHtml(fetchImpl) {
  const res = await withTimeout(fetchImpl, KARTEI_URL, { headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error('Karteikasten HTTP ' + res.status);
  return res.text();
}

export async function loadVerbMeisterRaw(key, fetchImpl = fetch) {
  const res = await withTimeout(fetchImpl, SPRINT_URL + '/api/verbs', { headers: { 'x-sync-key': key } });
  if (res.status === 401) throw new Error('SprintDeutsch refused the sync key (401)');
  if (!res.ok) throw new Error('SprintDeutsch /api/verbs HTTP ' + res.status);
  const doc = await res.json();
  return Array.isArray(doc && doc.verbs) ? doc.verbs : [];
}

/** Karteikasten verbs borrow the three forms from Verb Meister when the same verb is there. */
function vmFormsLookup(verbs) {
  const map = new Map();
  for (const v of verbs || []) {
    if (!v || !clean(v.infinitive)) continue;
    map.set(clean(v.infinitive).toLowerCase().replace(/^sich\s+/, ''), v);
  }
  // Only stored (irregular) forms are borrowed: a regular derivation could belong to another sense of the
  // same word (abhängen: "hängte ab" = to detach, but "abhängen von" = "hing ab").
  return (bare, reflexive) => {
    const v = map.get(bare);
    return v && v.irregular && v.conj ? verbMeisterForms({ ...v, reflexive: reflexive || !!v.reflexive }) : null;
  };
}

export async function loadKarteikasten(fetchImpl = fetch, vmVerbs = []) {
  return karteikastenCards(await fetchKarteikastenHtml(fetchImpl), { formsFor: vmFormsLookup(vmVerbs) });
}

export async function loadVerbMeister(key, fetchImpl = fetch) {
  return (await loadVerbMeisterRaw(key, fetchImpl)).map(verbMeisterCard).filter(Boolean);
}

// Loads both sources independently: one failing never hides the other, and the
// phone only mirrors deletions for a source that reported ok:true.
export async function loadAllCards(key, fetchImpl = fetch) {
  const [vmR, htmlR] = await Promise.allSettled([loadVerbMeisterRaw(key, fetchImpl), fetchKarteikastenHtml(fetchImpl)]);
  const vmVerbs = vmR.status === 'fulfilled' ? vmR.value : [];
  let vmCards = [], kkCards = [], vmErr = null, kkErr = null;
  if (vmR.status === 'fulfilled') vmCards = vmVerbs.map(verbMeisterCard).filter(Boolean); else vmErr = vmR.reason;
  if (htmlR.status === 'fulfilled') {
    try { kkCards = karteikastenCards(htmlR.value, { formsFor: vmFormsLookup(vmVerbs) }); } catch (e) { kkErr = e; }
  } else kkErr = htmlR.reason;
  const msg = e => String(e && e.message || e);
  const sources = {
    verbmeister: vmErr ? { ok: false, count: 0, error: msg(vmErr) } : { ok: true, count: vmCards.length },
    karteikasten: kkErr ? { ok: false, count: 0, error: msg(kkErr) } : { ok: true, count: kkCards.length },
  };
  const cards = [];
  const seen = new Set();
  for (const c of [...vmCards, ...kkCards]) { if (!seen.has(c.id)) { seen.add(c.id); cards.push(c); } }
  return { generatedAt: new Date().toISOString(), version: 2, sources, cards };
}
