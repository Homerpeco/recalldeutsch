// Gemini text-to-speech → trimmed, compact MP3.
// Gemini returns raw 24 kHz 16-bit mono PCM (~48 KB per second). Encoded as a
// 40 kbps MP3 a spoken answer is ~5 KB per second, so hundreds of cards fit on
// the phone in a few megabytes.
import { Mp3Encoder } from '@breezystack/lamejs';

const API = 'https://generativelanguage.googleapis.com/v1beta';

export function ttsModels() {
  const env = (process.env.TTS_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
  return env.length ? env : ['gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'];
}

export class TtsError extends Error {
  constructor(message, { status = 502, retryAfter = 0, model = '' } = {}) {
    super(message);
    this.status = status; this.retryAfter = retryAfter; this.model = model;
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Walk any response shape (generateContent or Interactions API) and return the
// first base64 audio payload with its mime type.
export function findAudio(node, parentKey = '') {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const x of node) { const r = findAudio(x, parentKey); if (r) return r; }
    return null;
  }
  const mime = node.mimeType || node.mime_type || '';
  if (typeof node.data === 'string' && node.data.length > 64 &&
      (/audio|pcm|l16|wav|mpeg/i.test(mime) || /inline_?data|audio/i.test(parentKey))) {
    return { b64: node.data, mime: mime || 'audio/L16;codec=pcm;rate=24000' };
  }
  for (const [k, v] of Object.entries(node)) {
    if (v && typeof v === 'object') { const r = findAudio(v, k); if (r) return r; }
  }
  return null;
}

function retryDelaySeconds(errJson, headers) {
  const h = headers && headers.get && headers.get('retry-after');
  if (h && !isNaN(Number(h))) return Number(h);
  const details = errJson && errJson.error && errJson.error.details;
  if (Array.isArray(details)) {
    for (const d of details) {
      const m = /([\d.]+)s/.exec(d && d.retryDelay || '');
      if (m) return Math.ceil(Number(m[1]));
    }
  }
  return 60;
}

async function postJson(fetchImpl, url, body, key, ms = 45000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON body */ }
    return { res, json };
  } finally { clearTimeout(t); }
}

// One model, two request shapes. generateContent first (what the other apps use),
// then the newer Interactions API if the model refuses generateContent.
async function tryModel(fetchImpl, model, text, voice, key) {
  const attempts = [
    () => postJson(fetchImpl, `${API}/models/${model}:generateContent`, {
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    }, key),
    () => postJson(fetchImpl, `${API}/interactions`, {
      model, input: text,
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice }] },
    }, key),
  ];
  let last = null;
  for (let i = 0; i < attempts.length; i++) {
    // The TTS preview sometimes answers with text tokens → HTTP 500. One retry.
    for (let round = 0; round < 2; round++) {
      let res, json;
      try { ({ res, json } = await attempts[i]()); }
      catch (e) { last = new TtsError('Gemini request failed: ' + (e && e.message || e), { status: 504, model }); break; }
      if (res.ok) {
        const audio = findAudio(json);
        if (audio) return audio;
        last = new TtsError('Gemini answered without audio', { status: 502, model });
        if (round === 0) { await sleep(800); continue; }
        break;
      }
      const msg = (json && json.error && json.error.message) || ('HTTP ' + res.status);
      if (res.status === 401 || res.status === 403) {
        throw new TtsError('Gemini rejected the API key: ' + msg, { status: 502, model });
      }
      if (res.status === 429) {
        throw new TtsError('Gemini quota reached: ' + msg, { status: 429, retryAfter: retryDelaySeconds(json, res.headers), model });
      }
      last = new TtsError(`Gemini ${res.status}: ${msg}`, { status: 502, model });
      if (res.status >= 500 && round === 0) { await sleep(1200); continue; }
      break; // 400/404 → try the other request shape
    }
  }
  throw last || new TtsError('Gemini failed', { model });
}

export async function synthesize(text, { voice = 'Kore', fetchImpl = fetch, key = process.env.GEMINI_API_KEY } = {}) {
  if (!key) throw new TtsError('GEMINI_API_KEY is not set in the Vercel project.', { status: 500 });
  const prefix = (process.env.TTS_STYLE || '').trim();
  const input = prefix ? `${prefix} ${text}` : text;
  let lastErr = null, quotaErr = null;
  for (const model of ttsModels()) {
    try {
      const audio = await tryModel(fetchImpl, model, input, voice, key);
      return { ...audio, model };
    } catch (e) {
      if (e.status === 429) { quotaErr = e; continue; }   // each model has its own quota bucket
      if (/API key/.test(e.message)) throw e;
      lastErr = e;
    }
  }
  throw quotaErr || lastErr;
}

// ---------------------------------------------------------------------------
// PCM helpers
// ---------------------------------------------------------------------------
export function pcmFromPayload({ b64, mime }) {
  let buf = Buffer.from(b64, 'base64');
  let rate = Number((/rate=(\d+)/i.exec(mime) || [])[1]) || 24000;
  if (/mpeg|mp3/i.test(mime)) return { mp3: buf };
  if (/wav/i.test(mime) || buf.slice(0, 4).toString('ascii') === 'RIFF') {
    rate = buf.readUInt32LE(24);
    let off = 12;
    while (off + 8 <= buf.length) {
      const id = buf.slice(off, off + 4).toString('ascii');
      const size = buf.readUInt32LE(off + 4);
      if (id === 'data') { buf = buf.slice(off + 8, off + 8 + size); break; }
      off += 8 + size + (size % 2);
    }
  }
  const samples = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
  return { samples: Int16Array.from(samples), rate };
}

// Cut the silence Gemini pads around each clip, keeping a short natural margin.
export function trimSilence(samples, rate, threshold = 600, marginMs = 70) {
  const win = Math.max(1, Math.round(rate * 0.01));
  const loud = i => {
    let peak = 0;
    for (let k = i; k < Math.min(samples.length, i + win); k++) peak = Math.max(peak, Math.abs(samples[k]));
    return peak >= threshold;
  };
  let start = 0, end = samples.length;
  while (start < samples.length && !loud(start)) start += win;
  while (end > start && !loud(Math.max(start, end - win))) end -= win;
  if (end <= start) return samples;              // all quiet → leave untouched
  const margin = Math.round(rate * marginMs / 1000);
  return samples.slice(Math.max(0, start - margin), Math.min(samples.length, end + margin));
}

export function encodeMp3(samples, rate, kbps = 40) {
  const enc = new Mp3Encoder(1, rate, kbps);
  const chunks = [];
  const block = 1152;
  for (let i = 0; i < samples.length; i += block) {
    const out = enc.encodeBuffer(samples.subarray(i, i + block));
    if (out.length) chunks.push(Buffer.from(out));
  }
  const tail = enc.flush();
  if (tail.length) chunks.push(Buffer.from(tail));
  return Buffer.concat(chunks);
}

export async function speakToMp3(text, opts = {}) {
  const payload = await synthesize(text, opts);
  const pcm = pcmFromPayload(payload);
  if (pcm.mp3) return { mp3: pcm.mp3, model: payload.model, seconds: null };
  const trimmed = trimSilence(pcm.samples, pcm.rate);
  return { mp3: encodeMp3(trimmed, pcm.rate), model: payload.model, seconds: +(trimmed.length / pcm.rate).toFixed(2) };
}
