// Shared-key check. The phone sends the same key that protects Verb Meister's
// /api/verbs on SprintDeutsch, so there is only one secret to remember.
import { timingSafeEqual } from 'node:crypto';

export function syncKey() {
  return process.env.SYNC_KEY || process.env.VERB_SYNC_SECRET || '';
}

function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// Returns true when the request may proceed; otherwise writes the error response.
export function requireKey(req, res) {
  const expected = syncKey();
  if (!expected) {
    res.status(500).json({ error: 'server-not-configured', detail: 'SYNC_KEY is not set in the Vercel project.' });
    return false;
  }
  const got = req.headers['x-sync-key'] || '';
  if (!same(got, expected)) {
    res.status(401).json({ error: 'unauthorized', detail: 'Wrong or missing sync key.' });
    return false;
  }
  return true;
}
