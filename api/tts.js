// POST /api/tts  {"text": "gehen. geht, ging, ist gegangen.", "voice": "Kore"}
// → 200 audio/mpeg (trimmed MP3), or JSON error. On quota limits: 429 + retryAfter seconds,
// so the phone can pause its recording queue instead of hammering the free tier.
// Header: x-sync-key.
import { requireKey } from './_auth.js';
import { speakToMp3 } from './_audio.js';

const VOICES = new Set(['Kore', 'Puck', 'Charon', 'Aoede', 'Fenrir', 'Leda', 'Orus', 'Zephyr',
  'Achernar', 'Enceladus', 'Iapetus', 'Sulafat', 'Gacrux', 'Schedar', 'Despina', 'Erinome']);

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  if (!requireKey(req, res)) return;

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const text = String(body && body.text || '').replace(/\s+/g, ' ').trim();
  const voice = VOICES.has(body && body.voice) ? body.voice : 'Kore';
  if (!text) return res.status(400).json({ error: 'text required' });
  if (text.length > 400) return res.status(400).json({ error: 'text too long (max 400 characters)' });

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
