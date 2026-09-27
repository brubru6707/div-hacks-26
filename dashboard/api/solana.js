import { ObjectId } from 'mongodb'
import { db, isLoggedIn } from '../lib/common.js'
import { CLUSTER, PUBLIC_RPC, airdrop, anchorAddress, byHash, recompute, refresh, solanaEnabled, summary } from '../lib/solana.js'
import { query, tigerEnabled } from '../lib/tiger.js'
import { VIDEO_DIR } from '../lib/videos.js'

// The Solana tab.
//   GET                  config, SOL balance, counts and the latest 100 anchors
//                        (also confirms/resends anchors in flight)
//   GET ?hash=<hex>      anchors with this hash (the page's drop-a-file check)
//   GET ?verify=<id>     that anchor's hash recomputed from the data as stored now
//   POST {action:'airdrop'}  1 devnet SOL to the anchor key
export default async function handler(req, res) {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'login required' })
  res.setHeader('Cache-Control', 'no-store')
  const base = { enabled: solanaEnabled, cluster: CLUSTER, rpc: PUBLIC_RPC, address: anchorAddress() }
  if (!solanaEnabled) return res.json(base)

  if (req.method === 'POST') {
    if (req.body?.action !== 'airdrop') return res.status(400).json({ error: 'unknown action' })
    try {
      return res.json({ sig: await airdrop() })
    } catch (e) {
      return res.status(e.status || 502).json({ error: 'Airdrop failed (the devnet faucet is often rate-limited; try faucet.solana.com): ' + e.message })
    }
  }
  if (req.method !== 'GET') return res.status(405).end()

  if (req.query.hash) {
    const hash = String(req.query.hash).toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(hash)) return res.status(400).json({ error: 'bad hash' })
    return res.json({ ...base, anchors: await byHash(hash) })
  }

  if (req.query.verify) {
    if (!ObjectId.isValid(req.query.verify)) return res.status(400).json({ error: 'bad id' })
    const a = await (await db()).collection('anchors').findOne({ _id: new ObjectId(req.query.verify) })
    if (!a) return res.status(404).json({ error: 'no such anchor' })
    const now = await recompute(a, { query, tigerEnabled, videoPath: VIDEO_DIR ? (id, kind) => `${VIDEO_DIR}/${id}.${kind}` : null })
    return res.json({ ...base, anchor: { ...a, payload: undefined }, now })
  }

  await refresh().catch(e => console.error('solana refresh', e.message))
  res.json({ ...base, ...(await summary()) })
}
