// Checks for the 2026-10-20 content audit: curated cues, Karteikasten forms, regular forms,
// example translations, and the /api/cues split. Run: node test/audit-2026-10-20.mjs [karteikasten.html]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { karteikastenCards, verbMeisterCard, regularForms, splitExample, threeForms } from '../api/_sources.js';
import { GLOSSARY, curatedCues, meaningHash } from '../api/_glossary.js';
import handler, { splitCurated, withExamples } from '../api/cues.js';

let n = 0;
const t = (name, fn) => Promise.resolve().then(fn).then(() => { n++; }, e => { console.error('FAIL', name); throw e; });

const kkHtml = readFileSync(process.argv[2] || new URL('../../karteikasten/index.html', import.meta.url), 'utf8');
const kk = karteikastenCards(kkHtml);

await t('every Karteikasten card has curated cues for its current meaning', () => {
  assert.equal(kk.length, 288);
  const without = kk.filter(c => !curatedCues(c.id, c.prompt)).map(c => c.answer);
  assert.deepEqual(without, []);
});
await t('passen zu no longer says "pegar con"', () => {
  const c = kk.find(x => x.answer === 'passen zu');
  const cues = curatedCues(c.id, c.prompt);
  assert.deepEqual(cues.es, ['ir bien con', 'combinar con', 'encajar con']);
  assert.ok(!cues.es.join(' ').includes('pegar'));
});
await t('glossary entries: 1-3 cues each, short, no duplicates', () => {
  for (const [id, e] of Object.entries(GLOSSARY)) {
    for (const k of ['es', 'en']) {
      assert.ok(e[k].length >= 1 && e[k].length <= 3, id + ' ' + k);
      assert.equal(new Set(e[k]).size, e[k].length, id + ' duplicate ' + k);
      for (const w of e[k]) assert.ok(w.length <= 60 && w === w.trim() && !/[;|]/.test(w), id + ' ' + w);
    }
    assert.ok(e.m.length >= 1 && e.m.every(h => /^[0-9a-f]{8}$/.test(h)), id);
  }
});
await t('an edited meaning falls back to the model', () => {
  const c = kk.find(x => x.answer === 'passen zu');
  assert.equal(curatedCues(c.id, c.prompt + ' (edited)'), null);
  assert.equal(curatedCues('kk:prep:does-not-exist', 'x'), null);
});
await t('curated cards get a new cueKey, so the phone fetches them again', () => {
  const c = kk.find(x => x.answer === 'passen zu');
  const plain = verbMeisterCard({ id: 'zz', infinitive: 'testen', meaning: 'to test' });
  assert.ok(c.cueKey && plain.cueKey && c.cueKey !== plain.cueKey);
  // recomputing without the glossary suffix gives a different key
  const old = createHash('sha1').update(c.deck + '|' + c.answer + '|' + c.prompt).digest('hex').slice(0, 16);
  assert.notEqual(c.cueKey, old);
  assert.equal(plain.cueKey, createHash('sha1').update('verb|testen|to test').digest('hex').slice(0, 16));
});
await t('Karteikasten strong verbs now have their forms; regular ones still none', () => {
  const f = a => (kk.find(x => x.answer === a) || {}).forms;
  assert.equal(f('anfangen mit'), 'fängt an · fing an · hat angefangen');
  assert.equal(f('sich bewerben um'), 'bewirbt sich · bewarb sich · hat sich beworben');
  assert.equal(f('ankommen auf'), 'kommt an · kam an · ist angekommen');
  assert.equal(f('sich aussprechen gegen'), 'spricht sich aus · sprach sich aus · hat sich ausgesprochen');
  assert.equal(f('erschrecken vor'), 'erschrickt · erschrak · ist erschrocken');
  assert.equal(f('teilnehmen an'), 'nimmt teil · nahm teil · hat teilgenommen');
  assert.equal(f('sich vorbereiten auf'), '');   // regular: no forms, and never Verb Meister's old "beritt"
  assert.equal(f('passen zu'), '');
  assert.equal(f('beginnen mit'), 'beginnt · begann · hat begonnen');   // Karteikasten's own table still wins
  assert.equal(kk.filter(c => c.deck === 'prep' && c.forms).length, 51 + 25);
});
await t('regular forms: e after consonant + n/m (zuordnen), none after l/r/h', () => {
  const r = (inf, o) => threeForms(regularForms(inf, o)).join(' · ');
  assert.equal(r('zuordnen', { separable: true, prefix: 'zu' }), 'ordnet zu · ordnete zu · hat zugeordnet');
  assert.equal(r('rechnen'), 'rechnet · rechnete · hat gerechnet');
  assert.equal(r('trocknen'), 'trocknet · trocknete · hat getrocknet');
  assert.equal(r('öffnen'), 'öffnet · öffnete · hat geöffnet');
  assert.equal(r('atmen'), 'atmet · atmete · hat geatmet');
  assert.equal(r('lernen'), 'lernt · lernte · hat gelernt');
  assert.equal(r('wohnen'), 'wohnt · wohnte · hat gewohnt');
  assert.equal(r('darstellen', { separable: true, prefix: 'dar' }), 'stellt dar · stellte dar · hat dargestellt');
  assert.equal(r('überqueren'), 'überquert · überquerte · hat überquert');
  assert.equal(r('einteilen', { separable: true, prefix: 'ein' }), 'teilt ein · teilte ein · hat eingeteilt');
});
await t('example translations are split off and never spoken', () => {
  assert.deepEqual(splitExample('Ich träume jede Nacht. (I dream every night.)'), { de: 'Ich träume jede Nacht.', tr: 'I dream every night.' });
  assert.deepEqual(splitExample('Ich träume jede Nacht. I dream every night.'), { de: 'Ich träume jede Nacht.', tr: 'I dream every night.' });
  assert.deepEqual(splitExample('Begleitest du mich zur Universität? Will you walk with me to the university?'),
    { de: 'Begleitest du mich zur Universität?', tr: 'Will you walk with me to the university?' });
  assert.deepEqual(splitExample('Gestern habe ich eine Ausrede (excusa) erfunden, warum mein Kühlschrank plötzlich Latein spricht.'),
    { de: 'Gestern habe ich eine Ausrede erfunden, warum mein Kühlschrank plötzlich Latein spricht.', tr: '' });
  assert.deepEqual(splitExample('Wenn jemand nicht grüßt, gerät er schnell in den Verdacht (sospecha), unhöflich zu sein. (If someone doesn\'t say hello, they quickly fall under suspicion of being rude.)'),
    { de: 'Wenn jemand nicht grüßt, gerät er schnell in den Verdacht, unhöflich zu sein.', tr: 'If someone doesn\'t say hello, they quickly fall under suspicion of being rude.' });
  assert.deepEqual(splitExample('Klinge ich verliebt ? Do I sound in love?'), { de: 'Klinge ich verliebt?', tr: 'Do I sound in love?' });
  assert.deepEqual(splitExample('Tom gibt seine (Master-)Arbeit rechtzeitig ab.'), { de: 'Tom gibt seine Arbeit rechtzeitig ab.', tr: '' });
  // German-only sentences stay whole
  for (const s of ['Monatelang haben sie verhandelt. Ohne Ergebnis.', 'Beeil dich, der Bus kommt gleich!', 'Irren ist menschlich.',
    'In Deutschland sagt man im Geschäftsleben „Sie“. Duzen Sie nur, wenn jemand Sie mit „du“ anspricht.',
    '"Sie sind hilfsbereit und treten kompetent und professionell auf."', 'Ich beschließe: Ich esse nur noch Eis.']) {
    assert.deepEqual(splitExample(s), { de: s, tr: '' }, s);
  }
});
await t('Verb Meister card: German only in examples and script, first translation shown', () => {
  const c = verbMeisterCard({ id: 'x1', infinitive: 'träumen', meaning: 'soñar', examples: [
    'Ich träume jede Nacht. (I dream every night.)', 'Du träumst schon wieder. (You\'re dreaming again.)'] });
  assert.deepEqual(c.examples, ['Ich träume jede Nacht.', 'Du träumst schon wieder.']);
  assert.equal(c.exampleEn, 'I dream every night.');
  assert.ok(!/dream|dreaming/.test(c.speakDe));
  assert.equal(c.speakDe, 'träumen.\nträumt, träumte, hat geträumt.\nIch träume jede Nacht.\nDu träumst schon wieder.');
});
await t('corrected Verb Meister entries read correctly', () => {
  const card = v => verbMeisterCard({ id: 'q', meaning: 'm', ...v });
  assert.equal(card({ infinitive: 'einteilen', separable: true, prefix: 'ein', prepositions: [{ prep: 'in', case: 'A' }] }).forms,
    'teilt ein · teilte ein · hat eingeteilt');
  assert.equal(card({ infinitive: 'einteilen', separable: true, prefix: 'ein', prepositions: [{ prep: 'in', case: 'A' }] }).prepLine, 'in + Akkusativ');
  assert.equal(card({ infinitive: 'wohlfühlen', reflexive: true, separable: true, prefix: 'wohl' }).forms,
    'fühlt sich wohl · fühlte sich wohl · hat sich wohlgefühlt');
  assert.equal(card({ infinitive: 'beschäftigen', reflexive: true, prepositions: [{ prep: 'mit', case: 'D' }] }).prepLine, 'mit + Dativ');
  assert.equal(card({ infinitive: 'vorbeikommen', irregular: true, separable: true, prefix: 'vorbei',
    conj: { present: 'kommt vorbei', preterite: 'kam vorbei', partizip: 'vorbeigekommen', auxiliary: 'sein' } }).forms,
    'kommt vorbei · kam vorbei · ist vorbeigekommen');
});
await t('/api/cues: curated items are answered without any model call', async () => {
  process.env.SYNC_KEY = 'k'.repeat(30);
  delete process.env.GEMINI_API_KEY;
  const c = kk.find(x => x.answer === 'passen zu');
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('no network in this test'); };
  try {
    const res = mockRes();
    await handler({ method: 'POST', headers: { 'x-sync-key': process.env.SYNC_KEY },
      body: { items: [{ id: c.id, de: 'passen zu (zu + Dativ)', meaning: c.prompt }] } }, res);
    assert.equal(res.code, 200);
    assert.deepEqual(res.body, { cues: [{ id: c.id, es: ['ir bien con', 'combinar con', 'encajar con'], en: ['to go with', 'to match', 'to suit'] }], model: 'curated' });
    assert.equal(calls, 0);
    // mixed batch while the model is unreachable: curated ones still arrive
    const res2 = mockRes();
    await handler({ method: 'POST', headers: { 'x-sync-key': process.env.SYNC_KEY },
      body: { items: [{ id: c.id, de: 'passen zu', meaning: c.prompt }, { id: 'vm:new', de: 'neu', meaning: 'new' }] } }, res2);
    assert.equal(res2.code, 200);
    assert.deepEqual(res2.body.cues.map(x => x.id), [c.id]);
  } finally { globalThis.fetch = realFetch; }
});
await t('/api/cues: uncurated items reach the model with their examples', async () => {
  const items = [{ id: 'vm:new', de: 'neu', meaning: 'new' }, { id: 'vm:none', de: 'x', meaning: 'y' }];
  const out = await withExamples(items, async () => ({ cards: [{ id: 'vm:new', examples: ['Das ist neu.', 'Alles neu.', 'Drei.'] }] }));
  assert.equal(out[0].meaning, 'new | used as in: Das ist neu. Alles neu.');
  assert.equal(out[1].meaning, 'y');
  assert.deepEqual(await withExamples(items, async () => { throw new Error('down'); }), items);
  const { curated, rest } = splitCurated(items);
  assert.equal(curated.length, 0);
  assert.equal(rest.length, 2);
});

function mockRes() {
  return { code: 0, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; } };
}
console.log(`${n} checks passed`);
