import { db, node, isLoggedIn, finishRecording } from '../lib/common.js'
import { upsertRecording } from '../lib/tiger.js'

// POST { action: 'start' | 'stop' }. Start creates a recordings entry and marks
// it as in progress on the node document; the Pi then streams (even with no
// viewer) and /api/pi saves every frame. Stop closes the entry.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'login required' })

  const now = Date.now()
  const d = await db()
  const n = await node()
  const action = req.body && req.body.action

  if (action === 'start') {
    const current = await n.findOne({ _id: 'node' }, { projection: { recording: 1, zoom: 1 } })
    if (current?.recording) return res.json({ recording: current.recording })

    const { insertedId } = await d.collection('recordings').insertOne({
      startedAt: now, endedAt: null, durationSec: null, status: 'recording', frameCount: 0, bytes: 0,
      zoom: current?.zoom ?? 1,
    })
    const rec = { id: insertedId, startedAt: now }
    // Only claim the slot if nobody else started one in the meantime.
    const claimed = await n.findOneAndUpdate(
      { _id: 'node', recording: { $exists: false } },
      { $set: { recording: rec } },
      { upsert: false, returnDocument: 'after' },
    )
    if (!claimed) {
      await d.collection('recordings').deleteOne({ _id: insertedId })
      const other = await n.findOne({ _id: 'node' }, { projection: { recording: 1 } })
      return res.json({ recording: other?.recording ?? null })
    }
    await upsertRecording({ id: insertedId, startedAt: now, zoom: current?.zoom ?? 1, status: 'recording' })
    return res.json({ recording: rec })
  }

  if (action === 'stop') {
    const before = await n.findOneAndUpdate(
      { _id: 'node' }, { $unset: { recording: '' } }, { returnDocument: 'before', projection: { recording: 1 } },
    )
    if (!before?.recording) return res.json({ recording: null, saved: null })
    const saved = await finishRecording(before.recording, now)
    return res.json({ recording: null, saved })
  }

  res.status(400).json({ error: 'action must be start or stop' })
}
