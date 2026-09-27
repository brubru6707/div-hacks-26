import { ObjectId } from 'mongodb'
import { db, isLoggedIn } from '../lib/common.js'
import { deleteVideo } from '../lib/videos.js'

// GET: the recordings entries (newest first), totals, and how much of the
// database is used. GET ?summary=1: just the totals (for the bar at the top).
// DELETE ?id=: removes a finished recording, its frames, and its 15 fps video.
const FREE_TIER_BYTES = 512 * 1024 * 1024

export default async function handler(req, res) {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'login required' })
  const d = await db()
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'DELETE') {
    let id
    try { id = new ObjectId(String(req.query.id)) } catch { return res.status(400).json({ error: 'bad id' }) }
    const rec = await d.collection('recordings').findOne({ _id: id })
    if (!rec) return res.status(404).json({ error: 'not found' })
    if (rec.status === 'recording') return res.status(409).json({ error: 'stop the recording first' })
    const { deletedCount } = await d.collection('frames').deleteMany({ rec: id })
    await d.collection('recordings').deleteOne({ _id: id })
    await deleteVideo(String(id))
    return res.json({ deleted: String(id), frames: deletedCount })
  }

  if (req.method !== 'GET') return res.status(405).end()
  const summary = req.query.summary !== undefined
  const [recordings, totals, stats] = await Promise.all([
    summary ? null : d.collection('recordings').find({}).sort({ startedAt: -1 }).limit(200).toArray(),
    totalsOf(d),
    d.command({ dbStats: 1 }).catch(() => null),
  ])
  res.json({
    ...(recordings && { recordings }),
    totals,
    storage: stats && { usedBytes: stats.dataSize + (stats.indexSize || 0), limitBytes: FREE_TIER_BYTES },
  })
}

// Frames and seconds across all recordings. A recording in progress counts
// its time so far. Pi seconds come from its frame count and rate.
async function totalsOf(d) {
  const now = Date.now()
  const [t] = await d.collection('recordings').aggregate([
    { $group: {
      _id: null,
      recordings: { $sum: 1 },
      seconds: { $sum: { $ifNull: ['$durationSec', { $divide: [{ $subtract: [now, '$startedAt'] }, 1000] }] } },
      mongoFrames: { $sum: '$frameCount' },
      mongoBytes: { $sum: '$bytes' },
      piFrames: { $sum: { $ifNull: ['$pi.frames', 0] } },
      piBytes: { $sum: { $ifNull: ['$pi.bytes', 0] } },
      piSeconds: { $sum: { $cond: [{ $gt: ['$pi.fps', 0] }, { $divide: ['$pi.frames', '$pi.fps'] }, 0] } },
    } },
  ]).toArray()
  const { _id, ...rest } = t ?? { recordings: 0, seconds: 0, mongoFrames: 0, mongoBytes: 0, piFrames: 0, piBytes: 0, piSeconds: 0 }
  return rest
}
