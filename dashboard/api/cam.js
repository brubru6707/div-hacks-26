import { node, isLoggedIn } from '../lib/common.js'

// POST { zoom }: sets the camera's digital zoom preset; the Pi applies it on
// its next sync. Locked while recording so one recording has one zoom.
export const ZOOMS = [1, 1.5, 2, 2.5]

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'login required' })

  const zoom = Number(req.body && req.body.zoom)
  if (!ZOOMS.includes(zoom)) return res.status(400).json({ error: `zoom must be one of ${ZOOMS.join(', ')}` })
  const n = await node()
  const updated = await n.findOneAndUpdate(
    { _id: 'node', recording: { $exists: false } }, { $set: { zoom } }, { returnDocument: 'after', projection: { zoom: 1 } },
  )
  if (!updated) return res.status(409).json({ error: 'stop the recording before changing zoom' })
  res.json({ zoom: updated.zoom })
}
