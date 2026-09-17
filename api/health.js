// GET /api/health — setup check, safe to open in a browser.
// Shows which settings are present (never their values) and whether both card sources load.
// ?tts=1 also records one test phrase (at most once every 5 minutes).
import { syncKey } from './_auth.js';
import { loadKarteikasten, loadVerbMeister } from './_sources.js';
import { speakToMp3, ttsModels } from './_audio.js';
import { forwardToSprint } from './tts.js';

export const maxDuration = 60;

let lastTtsTest = 0;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const key = syncKey();
  const ownGemini = !!process.env.GEMINI_API_KEY;
  const out = {
    app: 'RecallDeutsch API',
    time: new Date().toISOString(),
    settings: {
      SYNC_KEY: !!key,
      GEMINI_API_KEY: ownGemini,
      BLOB_READ_WRITE_TOKEN: !!process.env.BLOB_READ_WRITE_TOKEN,
    },
    voice: ownGemini ? 'own Gemini key' : 'via SprintDeutsch (/api/recall-tts)',
    ttsModels: ttsModels(),
  };

  const [kk, vm] = await Promise.allSettled([
    loadKarteikasten(),
    key ? loadVerbMeister(key) : Promise.reject(new Error('SYNC_KEY not set')),
  ]);
  out.karteikasten = kk.status === 'fulfilled'
    ? { ok: true, prepVerbs: kk.value.filter(c => c.deck === 'prep').length, adjectives: kk.value.filter(c => c.deck === 'adj').length }
    : { ok: false, error: String(kk.reason && kk.reason.message || kk.reason) };
  out.verbmeister = vm.status === 'fulfilled'
    ? { ok: true, verbs: vm.value.length }
    : { ok: false, error: String(vm.reason && vm.reason.message || vm.reason) };

  const q = req.query || {};
  if (q.tts) {
    if (!key) {
      out.tts = { ok: false, error: 'SYNC_KEY not set' };
    } else if (Date.now() - lastTtsTest < 5 * 60 * 1000) {
      out.tts = { ok: false, error: 'voice test ran less than 5 minutes ago — try again later' };
    } else {
      lastTtsTest = Date.now();
      const t0 = Date.now();
      const phrase = 'gehen. geht, ging, ist gegangen.';
      try {
        if (ownGemini) {
          const r = await speakToMp3(phrase);
          out.tts = { ok: true, via: 'own key', model: r.model, bytes: r.mp3.length, seconds: r.seconds, ms: Date.now() - t0 };
        } else {
          const r = await forwardToSprint(phrase, 'Kore');
          const buf = Buffer.from(await r.arrayBuffer());
          out.tts = r.ok
            ? { ok: true, via: 'sprintdeutsch', model: r.headers.get('x-tts-model'), bytes: buf.length, seconds: Number(r.headers.get('x-audio-seconds')), ms: Date.now() - t0 }
            : { ok: false, via: 'sprintdeutsch', status: r.status, error: (() => { try { return JSON.parse(buf.toString()).detail || JSON.parse(buf.toString()).error; } catch { return buf.toString().slice(0, 200); } })() };
        }
      } catch (e) {
        out.tts = { ok: false, error: String(e.message || e), retryAfter: e.retryAfter || 0 };
      }
    }
  }

  out.ok = out.settings.SYNC_KEY && out.karteikasten.ok && out.verbmeister.ok;
  return res.status(200).json(out);
}
