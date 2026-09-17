// /api/recall — RecallDeutsch's own recall log (separate from Verb Meister's data).
// POST {"deviceId": "...", "events": [ {...}, ... ]}  → stored as one new append-only file
//      recalldeutsch/log/YYYY-MM/<time>-<device>.json  (no read-modify-write, nothing to overwrite)
// GET  ?month=YYYY-MM  → all events of that month, merged and de-duplicated by event id.
// Needs a Vercel Blob store connected to the project (BLOB_READ_WRITE_TOKEN).
// Header: x-sync-key.
import { put, list } from '@vercel/blob';
import { requireKey } from './_auth.js';

const PREFIX = 'recalldeutsch/log/';
const MAX_EVENTS = 500;

function storageReady(res) {
  if (process.env.BLOB_READ_WRITE_TOKEN) return true;
  res.status(503).json({ error: 'storage-not-connected',
    detail: 'Connect a Vercel Blob store to the recalldeutsch project. The phone keeps events until then.' });
  return false;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!requireKey(req, res)) return;

  if (req.method === 'POST') {
    if (!storageReady(res)) return;
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const events = Array.isArray(body && body.events) ? body.events.slice(0, MAX_EVENTS) : [];
    if (!events.length) return res.status(400).json({ error: 'events array required' });
    const device = String(body.deviceId || 'phone').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40) || 'phone';
    const now = new Date();
    const month = now.toISOString().slice(0, 7);
    const path = `${PREFIX}${month}/${now.toISOString().replace(/[:.]/g, '-')}-${device}.json`;
    try {
      await put(path, JSON.stringify({ deviceId: device, receivedAt: now.toISOString(), events }), {
        access: 'public', addRandomSuffix: true, contentType: 'application/json',
      });
      return res.status(200).json({ ok: true, stored: events.length });
    } catch (err) {
      return res.status(500).json({ error: 'storage error', detail: String(err && err.message || err) });
    }
  }

  if (req.method === 'GET') {
    if (!storageReady(res)) return;
    const month = /^\d{4}-\d{2}$/.test(String(req.query && req.query.month)) ? req.query.month
      : new Date().toISOString().slice(0, 7);
    try {
      const blobs = [];
      let cursor;
      do {
        const page = await list({ prefix: `${PREFIX}${month}/`, cursor });
        blobs.push(...page.blobs);
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      const byId = new Map();
      for (const b of blobs) {
        const doc = await fetch(b.url + '?v=' + Date.now()).then(r => r.json()).catch(() => null);
        for (const e of (doc && doc.events) || []) byId.set(e.id || JSON.stringify(e), e);
      }
      return res.status(200).json({ month, files: blobs.length, events: [...byId.values()] });
    } catch (err) {
      return res.status(500).json({ error: 'storage error', detail: String(err && err.message || err) });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'method not allowed' });
}
