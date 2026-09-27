import { isLoggedIn } from '../lib/common.js'
import { activity, tigerEnabled } from '../lib/tiger.js'

// GET ?range=<minutes>: the Activity tab's data, from Tiger Data's continuous
// aggregates (per minute up to 6 h, per hour beyond).
const RANGES = [15, 60, 360, 1440, 10080]

export default async function handler(req, res) {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'login required' })
  if (!tigerEnabled) return res.status(503).json({ error: 'Tiger Data is not configured' })
  const range = RANGES.includes(Number(req.query.range)) ? Number(req.query.range) : 60
  res.setHeader('Cache-Control', 'no-store')
  res.json({ range, ...(await activity(range)) })
}
