// Checks for the English line under every example sentence. Run: node test/examples-en-2026-10-30.mjs [karteikasten.html]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { karteikastenCards, verbMeisterCard } from '../api/_sources.js';
import { translateExample, translationCount, exampleKey } from '../api/_translations.js';

let n = 0;
const t = (name, fn) => Promise.resolve().then(fn).then(() => { n++; }, e => { console.error('FAIL', name); throw e; });
const kk = karteikastenCards(readFileSync(process.argv[2] || new URL('../../karteikasten/index.html', import.meta.url), 'utf8'));

await t('every Karteikasten example has an English line, in the same order', () => {
  for (const c of kk) {
    assert.equal(c.examplesEn.length, c.examples.length, c.id);
    c.examplesEn.forEach((en, i) => assert.ok(en && en !== c.examples[i], c.id + ' #' + i));
    assert.equal(c.exampleEn, c.examplesEn[0]);
  }
});
await t('"entstehen aus" and "sorgen für": both examples translated', () => {
  for (const w of ['entstehen aus', 'sorgen für']) {
    const c = kk.find(x => x.answer === w);
    assert.equal(c.examples.length, 2); assert.equal(c.examplesEn.length, 2);
    assert.ok(c.examplesEn.every(Boolean));
  }
});
await t('the English is never part of the spoken script', () => {
  for (const c of kk) for (const en of c.examplesEn) assert.ok(!c.speakDe.includes(en), c.id);
  const vm = verbMeisterCard({ id: 'x', infinitive: 'versorgen', meaning: 'to supply', examples: ['Sie pflegt und versorgt kranke Menschen.', 'Ich versorge meine Familie. (I provide for my family.)'] });
  for (const en of vm.examplesEn) assert.ok(en && !vm.speakDe.includes(en));
  assert.ok(!/provide|looks after/i.test(vm.speakDe));
});
await t('Verb Meister: inline translation wins, else the checked table, else blank', () => {
  const v = verbMeisterCard({ id: 'x', infinitive: 'versorgen', meaning: 'm',
    examples: ['Sie pflegt und versorgt kranke Menschen.', 'Ich versorge meine Familie. (I provide for my family.)', 'Ein ganz neuer Satz ohne Übersetzung.'] });
  assert.deepEqual(v.examples, ['Sie pflegt und versorgt kranke Menschen.', 'Ich versorge meine Familie.', 'Ein ganz neuer Satz ohne Übersetzung.']);
  assert.deepEqual(v.examplesEn, ['She cares for and looks after sick people.', 'I provide for my family.', '']);
  assert.equal(v.exampleEn, v.examplesEn[0]);
});
await t('table lookup ignores case, quotes and spacing, and is sentence-exact otherwise', () => {
  assert.equal(translateExample('„Ich habe Ihr Schreiben vom 3. September erhalten."'), '“I have received your letter of 3 September.”');
  assert.equal(translateExample('nichts wird hier verschwendet'), 'Nothing is being wasted here.');
  assert.equal(translateExample('Nichts wird hier verschwendet, wirklich.'), '');
  assert.equal(exampleKey('A b!'), exampleKey('a  B'));
  assert.equal(translationCount, 275);
});
console.log(n + ' checks passed');
