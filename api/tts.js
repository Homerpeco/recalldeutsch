// POST /api/tts  {"text": "gehen. geht, ging, ist gegangen.", "voice": "Kore"}
// → 200 audio/mpeg (trimmed MP3), or JSON error. On quota limits: 429 + retryAfter seconds,
// so the phone can pause its recording queue instead of hammering the free tier.
// Header: x-sync-key.
//
// Gemini key: if GEMINI_API_KEY is set in this project it is used directly. Otherwise the request
// is forwarded to SprintDeutsch's /api/recall-tts, which uses the Gemini key SprintDeutsch already has.
import { requireKey, syncKey } from './_auth.js';
import { speakToMp3 } from './_audio.js';
import { SPRINT_URL } from './_sources.js';

const VOICES = new Set(['Kore', 'Puck', 'Charon', 'Aoede', 'Fenrir', 'Leda', 'Orus', 'Zephyr']);

export const maxDuration = 60;

export async function forwardToSprint(text, voice, fetchImpl = fetch) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 55000);
  try {
    return await fetchImpl(SPRINT_URL + '/api/recall-tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sync-key': syncKey() },
      body: JSON.stringify({ text, voice }),
      signal: ctl.signal,
    });
  } finally { clearTimeout(t); }
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
  const text = String(body && body.text || '').replace(/[^\S\n]+/g, ' ').replace(/ *\n[\n ]*/g, '\n').trim();
  const voice = VOICES.has(body && body.voice) ? body.voice : 'Kore';
  if (!text) return res.status(400).json({ error: 'text required' });
  if (text.length > 1200) return res.status(400).json({ error: 'text too long (max 1200 characters)' });

  if (!process.env.GEMINI_API_KEY) {
    try {
      const r = await forwardToSprint(text, voice);
      const buf = Buffer.from(await r.arrayBuffer());
      for (const h of ['content-type', 'retry-after', 'x-tts-model', 'x-audio-seconds']) {
        const v = r.headers.get(h);
        if (v) res.setHeader(h, v);
      }
      res.setHeader('X-Tts-Via', 'sprintdeutsch');
      return res.status(r.status).send(buf);
    } catch (err) {
      return res.status(502).json({ error: 'tts-failed', detail: 'SprintDeutsch voice service not reachable: ' + String(err && err.message || err), retryAfter: 0 });
    }
  }

  try {
    const { mp3, model, seconds } = await speakToMp3(text, { voice });
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('X-Tts-Model', model);
    if (seconds != null) res.setHeader('X-Audio-Seconds', String(seconds));
    return res.status(200).send(mp3);
  } catch (err) {
    const status = err.status === 429 ? 429 : (err.status === 500 ? 500 : 502);
    if (err.retryAfter) res.setHeader('Retry-After', String(err.retryAfter));
    return res.status(status).json({
      error: status === 429 ? 'quota' : 'tts-failed',
      detail: String(err.message || err),
      retryAfter: err.retryAfter || 0,
      model: err.model || '',
    });
  }
}
