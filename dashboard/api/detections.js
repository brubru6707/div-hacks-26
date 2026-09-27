import { isLoggedIn, isPi } from '../lib/common.js'
import { insertDetections, query, tigerEnabled } from '../lib/tiger.js'
import { anchorDetections } from '../lib/solana.js'

// POST (Pi token, e.g. from detect.py): one detection or an array of them.
//   { confidence: 0.91, recording: "<id>", frame: 123, box: [x, y, w, h],
//     label: "rat", model: "yolo-v3", ts: "2026-09-26T20:01:02Z" }
//   box is normalised 0-1 (x, y = top-left). Everything but confidence is optional;
//   ts defaults to now.
// GET (logged in): the latest 100 detections.
export default async function handler(req, res) {
  if (!tigerEnabled) return res.status(503).json({ error: 'Tiger Data is not configured' })
  if (req.method === 'POST') {
    if (!isPi(req)) return res.status(401).json({ error: 'bad token' })
    const body = req.body
    // Fix the default time once, so the row and its Solana anchor agree.
    const now = Date.now()
    const list = [Array.isArray(body) ? body : body?.detections ?? body].flat().map(d => d && { ...d, ts: d.ts ?? now })
    const n = await insertDetections(list)
    await anchorDetections(list) // queues only; never throws
    return res.json({ inserted: n })
  }
  if (req.method !== 'GET') return res.status(405).end()
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'login required' })
  const { rows } = await query(
    `select ts, recording, frame, label, confidence, x, y, w, h, model from detections order by ts desc limit 100`)
  res.setHeader('Cache-Control', 'no-store')
  res.json(rows)
}
