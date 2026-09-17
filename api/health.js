// GET /api/health — setup check, safe to open in a browser.
// Shows which settings are present (never their values) and whether both card sources load.
// With ?tts=1 and the sync key (x-sync-key header or ?key=) it also records one test phrase.
import { syncKey } from './_auth.js';
import { loadKarteikasten, loadVerbMeister } from './_sources.js';
import { speakToMp3, ttsModels } from './_audio.js';

export const config = { maxDuration: 60 };

let lastTtsTest = 0;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const key = syncKey();
  const out = {
    app: 'RecallDeutsch API',
    time: new Date().toISOString(),
    settings: {
      SYNC_KEY: !!key,
      GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
      BLOB_READ_WRITE_TOKEN: !!process.env.BLOB_READ_WRITE_TOKEN,
    },
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
    const given = req.headers['x-sync-key'] || q.key || '';
    if (!key || given !== key) {
      out.tts = { ok: false, error: 'add the sync key to run the voice test' };
    } else if (Date.now() - lastTtsTest < 5 * 60 * 1000) {
      out.tts = { ok: false, error: 'voice test ran less than 5 minutes ago — try again later' };
    } else {
      lastTtsTest = Date.now();
      const t0 = Date.now();
      try {
        const r = await speakToMp3('gehen. geht, ging, ist gegangen.');
        out.tts = { ok: true, model: r.model, bytes: r.mp3.length, seconds: r.seconds, ms: Date.now() - t0 };
      } catch (e) {
        out.tts = { ok: false, error: String(e.message || e), retryAfter: e.retryAfter || 0 };
      }
    }
  }

  out.ok = out.settings.SYNC_KEY && out.settings.GEMINI_API_KEY && out.karteikasten.ok && out.verbmeister.ok;
  return res.status(200).json(out);
}
