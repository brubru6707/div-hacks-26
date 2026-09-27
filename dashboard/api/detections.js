import { createHash } from 'node:crypto'
import { db, isLoggedIn, isPi } from '../lib/common.js'
import { insertDetections, query, tigerEnabled } from '../lib/tiger.js'
import { anchorDetections } from '../lib/solana.js'

// POST (Pi token, e.g. from agent.py's rat detector): one detection or an array of them.
//   { confidence: 0.91, recording: "<id>", frame: 123, box: [x, y, w, h],
//     label: "rat", model: "rat-litroom-v5", ts: "2026-09-26T20:01:02Z", image: "<base64 JPEG>" }
//   box is normalised 0-1 (x, y = top-left). Everything but confidence is optional;
//   ts defaults to now. image (the boxed frame) is stored in MongoDB under its SHA-256,
//   and that hash goes into the Tiger Data row and the Solana anchor, so the picture is
//   provable too.
// GET (logged in): the latest 100 detections, each with its picture hash and Solana anchor.
// GET ?image=<sha256> (logged in): that sighting's picture.
const MAX_IMAGE = 400_000

export default async function handler(req, res) {
  if (!tigerEnabled) return res.status(503).json({ error: 'Tiger Data is not configured' })
  if (req.method === 'POST') {
    if (!isPi(req)) return res.status(401).json({ error: 'bad token' })
    const body = req.body
    // Fix the default time once, so the row and its Solana anchor agree.
    const now = Date.now()
    const list = [Array.isArray(body) ? body : body?.detections ?? body].flat().map(d => d && { ...d, ts: d.ts ?? now })
    const images = (await db()).collection('sighting_images')
    for (const d of list) {
      if (!d || typeof d.image !== 'string') continue
      const jpeg = Buffer.from(d.image, 'base64')
      delete d.image
      if (!jpeg.length || jpeg.length > MAX_IMAGE) continue
      d.image_sha256 = createHash('sha256').update(jpeg).digest('hex')
      await images.updateOne({ _id: d.image_sha256 },
        { $setOnInsert: { jpeg, ts: new Date(d.ts).getTime(), node: String(d.node || 'pi'), label: String(d.label || 'rat') } }, { upsert: true })
    }
    const n = await insertDetections(list)
    await anchorDetections(list) // queues only; never throws
    return res.json({ inserted: n })
  }
  if (req.method !== 'GET') return res.status(405).end()
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'login required' })
  res.setHeader('Cache-Control', 'no-store')

  if (req.query.image) {
    const sha = String(req.query.image).toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(sha)) return res.status(400).json({ error: 'bad hash' })
    const doc = await (await db()).collection('sighting_images').findOne({ _id: sha })
    if (!doc) return res.status(404).json({ error: 'no such picture' })
    res.setHeader('Content-Type', 'image/jpeg')
    return res.end(doc.jpeg.buffer)
  }

  const { rows } = await query(
    `select extract(epoch from ts) * 1000 as ts, node, recording, frame, label, confidence, x, y, w, h, model, image_sha256
     from detections order by ts desc limit 100`)
  // Each row's Solana anchor, by the ref anchorDetections gave it: node/ts/label.
  const refs = rows.map(r => `${r.node}/${Math.round(Number(r.ts))}/${r.label}`)
  const anchors = await (await db()).collection('anchors')
    .find({ kind: 'det', ref: { $in: refs } }, { projection: { payload: 0, memo: 0 } }).toArray()
  const byRef = new Map(anchors.map(a => [a.ref, a]))
  res.json(rows.map((r, i) => {
    const a = byRef.get(refs[i])
    return {
      ...r, ts: new Date(Number(r.ts)).toISOString(),
      solana: a ? { id: String(a._id), hash: a.hash, status: a.status, sig: a.sig ?? null, slot: a.slot ?? null } : null,
    }
  }))
}
