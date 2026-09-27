import { node, isLoggedIn } from '../lib/common.js'

// Turns rat detection on the Pi on or off. The Pi picks it up on its next sync
// (api/pi.js) and runs the model on every live frame until it is switched off
// or DETECT_MAX_MS passes, so a forgotten switch doesn't keep the Pi hot all night.
export const DETECT_MAX_MS = 30 * 60_000

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'login required' })

  const on = !!(req.body && req.body.on)
  const now = Date.now()
  await (await node()).updateOne({ _id: 'node' },
    on ? { $set: { detect: { on: true, at: now, until: now + DETECT_MAX_MS } } } : { $unset: { detect: '' } },
    { upsert: true })
  res.json({ on })
}
