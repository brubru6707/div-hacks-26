import { ObjectId } from 'mongodb'
import { db, isLoggedIn } from '../lib/common.js'

// GET ?rec=<recording id>  -> [{ id, ts }] for playback, in order
// GET ?id=<frame id>       -> the JPEG itself (immutable, so cached hard)
export default async function handler(req, res) {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'login required' })
  const frames = (await db()).collection('frames')

  let id
  try { id = new ObjectId(String(req.query.id || req.query.rec)) } catch { return res.status(400).json({ error: 'bad id' }) }

  if (req.query.rec) {
    const list = await frames.find({ rec: id }, { projection: { ts: 1 } }).sort({ ts: 1 }).toArray()
    res.setHeader('Cache-Control', 'no-store')
    return res.json(list.map(f => ({ id: String(f._id), ts: f.ts })))
  }

  const f = await frames.findOne({ _id: id }, { projection: { jpeg: 1 } })
  if (!f) return res.status(404).json({ error: 'not found' })
  res.setHeader('Content-Type', 'image/jpeg')
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
  res.send(Buffer.from(f.jpeg.buffer))
}
