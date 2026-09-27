import { node, isLoggedIn } from '../lib/common.js'

// Queues an IR on/off command; the Pi picks it up on its next sync.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'login required' })

  const value = req.body && req.body.on ? 'on' : 'off'
  await (await node()).updateOne({ _id: 'node' }, { $set: { irCmd: { value, at: Date.now() } } }, { upsert: true })
  res.json({ queued: value })
}
