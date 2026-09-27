// Solana: tamper-evident anchoring of Barn Owl's evidence.
//
// Each rat detection and each finished 15 fps recording is reduced to a
// SHA-256 hash, and the hash is written to Solana (devnet by default) as a
// Memo program instruction signed by the node's anchor key. Anyone can later
// recompute the hash from the data and compare it with the memo on chain: a
// match proves the data hasn't changed since it was anchored. It does not
// prove the detection was right; see HANDOFF-solana.md.
//
// Memo formats (one per instruction, up to MEMOS_PER_TX per transaction):
//   owl1 det <sha256 of the canonical detection JSON>
//   owl1 rec <recording id> <sha256 of the .mjpeg file>
//
// MongoDB collection `anchors`, one document per memo:
//   { kind: 'det'|'rec', ref, hash, memo, payload?, status, sig?, slot?,
//     createdAt, sentAt?, confirmedAt?, error?, tries }
//   status: pending (not sent yet) → sending → sent → confirmed | failed
//
// Optional like Tiger Data: with no SOLANA_ANCHOR_KEY set, nothing is anchored.
//
// No Solana SDK: a memo transaction is small enough to build and sign here
// (node:crypto has Ed25519), and @solana/web3.js crashes on Vercel's Node
// (rpc-websockets require()s an ESM-only uuid).
import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { db } from './common.js'

export const CLUSTER = process.env.SOLANA_CLUSTER || 'devnet'
const RPC = process.env.SOLANA_RPC || `https://api.${CLUSTER}.solana.com`
// What browsers use to check the chain themselves. SOLANA_RPC may carry an
// API key, so it is never sent to the page.
export const PUBLIC_RPC = process.env.SOLANA_PUBLIC_RPC || `https://api.${CLUSTER}.solana.com`
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'
const LAMPORTS_PER_SOL = 1e9
const MEMOS_PER_TX = 5
const RESEND_AFTER_MS = 90_000 // a blockhash lasts ~60-90 s; after that the tx can never land
const MAX_TRIES = 4

export const solanaEnabled = !!process.env.SOLANA_ANCHOR_KEY

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
export function b58encode(bytes) {
  const digits = [] // base 58, least significant first
  for (const byte of bytes) {
    let carry = byte
    for (let i = 0; i < digits.length; i++) { carry += digits[i] * 256; digits[i] = carry % 58; carry = Math.floor(carry / 58) }
    while (carry) { digits.push(carry % 58); carry = Math.floor(carry / 58) }
  }
  let zeros = 0
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++
  return '1'.repeat(zeros) + digits.reverse().map(d => B58[d]).join('')
}
export function b58decode(str) {
  const bytes = [] // base 256, least significant first
  for (const c of str) {
    let carry = B58.indexOf(c)
    if (carry < 0) throw new Error('bad base58')
    for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 0xff; carry >>= 8 }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8 }
  }
  let zeros = 0
  while (str[zeros] === '1') zeros++
  return Buffer.from([...new Array(zeros).fill(0), ...bytes.reverse()])
}

// The key: the JSON byte array that `solana-keygen new` writes (a 32-byte
// Ed25519 seed followed by the 32-byte public key).
let signer
function key() {
  if (!signer) {
    const bytes = Buffer.from(JSON.parse(process.env.SOLANA_ANCHOR_KEY))
    const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), bytes.subarray(0, 32)])
    const priv = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' })
    const pub = Buffer.from(priv.export({ format: 'jwk' }).x, 'base64url')
    if (bytes.length === 64 && !pub.equals(bytes.subarray(32))) throw new Error('SOLANA_ANCHOR_KEY: public half does not match')
    signer = { priv, pub, address: b58encode(pub) }
  }
  return signer
}
export const anchorAddress = () => (solanaEnabled ? key().address : null)

let rpcId = 0
async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }), signal: AbortSignal.timeout(15_000) })
  const d = await r.json().catch(() => ({ error: { message: `HTTP ${r.status}` } }))
  if (d.error) throw new Error(`${method}: ${d.error.message}`)
  return d.result
}

// Solana's compact-u16 length prefix.
const shortvec = n => { const out = []; do { let b = n & 0x7f; n >>= 7; if (n) b |= 0x80; out.push(b) } while (n); return Buffer.from(out) }

// A legacy transaction: accounts [our key (signer, fee payer), memo program],
// one memo instruction per string, each naming our key as its signer.
export function memoTransaction(memos, blockhash) {
  const k = key()
  const message = Buffer.concat([
    Buffer.from([1, 0, 1]), // 1 signature; 0 read-only signed; 1 read-only unsigned (the program)
    shortvec(2), k.pub, b58decode(MEMO_PROGRAM),
    b58decode(blockhash),
    shortvec(memos.length),
    ...memos.map(m => { const data = Buffer.from(m, 'utf8'); return Buffer.concat([Buffer.from([1]), shortvec(1), Buffer.from([0]), shortvec(data.length), data]) }),
  ])
  const signature = sign(null, message, k.priv)
  return { sig: b58encode(signature), wire: Buffer.concat([shortvec(1), signature, message]).toString('base64') }
}

async function anchors() {
  return (await db()).collection('anchors')
}

const sha256 = s => createHash('sha256').update(s).digest('hex')
const r4 = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 1e4) / 1e4)

// The exact bytes that get hashed for a detection. Fields are fixed and in a
// fixed order, and numbers are rounded, so the same row read back from Tiger
// Data (real columns, timestamptz) produces the same string. A sighting with a
// picture is v2: it also carries the picture's SHA-256, so the chain vouches for
// the image too. v1 (no picture) stays byte-for-byte what it always was.
export function canonicalDetection(d) {
  const box = [d.box?.[0] ?? d.x, d.box?.[1] ?? d.y, d.box?.[2] ?? d.w, d.box?.[3] ?? d.h].map(r4)
  const image = d.image_sha256 ? String(d.image_sha256) : null
  return JSON.stringify({
    v: image ? 2 : 1,
    ts: Math.round(d.ts instanceof Date ? d.ts.getTime() : typeof d.ts === 'number' ? d.ts : d.ts ? new Date(d.ts).getTime() : NaN),
    node: String(d.node || 'pi'),
    recording: d.recording ? String(d.recording) : null,
    frame: Number.isInteger(d.frame) ? d.frame : null,
    label: String(d.label || 'rat'),
    confidence: r4(d.confidence),
    box: box.every(v => v == null) ? null : box,
    model: d.model ? String(d.model) : null,
    ...(image && { image }),
  })
}

export async function hashFile(path) {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(path)) h.update(chunk)
  return h.digest('hex')
}

// Sends every pending anchor (oldest first), MEMOS_PER_TX to a transaction.
// Only waits for the send, not the confirmation; refresh() confirms later.
async function flush() {
  const col = await anchors()
  const pending = await col.find({ status: 'pending' }).sort({ createdAt: 1 }).limit(50).toArray()
  // Claim them first, so two flushes running at once (an upload and a page
  // poll) never send the same memo twice.
  const claim = randomUUID()
  await col.updateMany({ _id: { $in: pending.map(a => a._id) }, status: 'pending' }, { $set: { status: 'sending', claim, claimedAt: Date.now() } })
  const mine = await col.find({ claim, status: 'sending' }).sort({ createdAt: 1 }).toArray()
  for (let i = 0; i < mine.length; i += MEMOS_PER_TX) {
    const group = mine.slice(i, i + MEMOS_PER_TX)
    const ids = group.map(a => a._id)
    try {
      const { value: { blockhash } } = await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }])
      const tx = memoTransaction(group.map(a => a.memo), blockhash)
      const sig = await rpc('sendTransaction', [tx.wire, { encoding: 'base64', preflightCommitment: 'confirmed' }])
      await col.updateMany({ _id: { $in: ids } }, { $set: { status: 'sent', sig, sentAt: Date.now() }, $inc: { tries: 1 }, $unset: { error: '', claim: '' } })
    } catch (e) {
      const error = String(e.message || e).slice(0, 300)
      console.error('solana send', error)
      // Back to pending so the next flush retries, until MAX_TRIES.
      await col.updateMany({ _id: { $in: ids }, tries: { $gte: MAX_TRIES - 1 } }, { $set: { status: 'failed', error } })
      await col.updateMany({ _id: { $in: ids }, status: 'sending' }, { $set: { status: 'pending', error }, $inc: { tries: 1 } })
    }
  }
}

// Queues anchors in MongoDB (awaited: quick, and it's what makes them
// survive), then sends them in the background; if the send never happens
// (e.g. Vercel freezes the function), refresh() sends them later. Never
// throws: anchoring must not break the upload that triggered it.
async function anchor(items) {
  if (!solanaEnabled || !items.length) return
  try {
    const now = Date.now()
    await (await anchors()).insertMany(items.map(a => ({ ...a, status: 'pending', tries: 0, createdAt: now })))
  } catch (e) {
    return console.error('solana queue', e.message)
  }
  flush().catch(e => console.error('solana send', e.message))
}

export function anchorDetections(list) {
  const rows = (Array.isArray(list) ? list : [list]).filter(d => d && Number.isFinite(Number(d.confidence)))
  return anchor(rows.map(d => {
    // Same defaults insertDetections applies, so the payload matches the row.
    const payload = canonicalDetection({ ...d, ts: d.ts ? new Date(d.ts).getTime() : Date.now() })
    const hash = sha256(payload)
    const p = JSON.parse(payload)
    return { kind: 'det', ref: `${p.node}/${p.ts}/${p.label}`, recording: p.recording, hash, memo: `owl1 det ${hash}`, payload }
  }))
}

export async function anchorRecording(id, path) {
  if (!solanaEnabled) return
  try {
    const hash = await hashFile(path)
    await anchor([{ kind: 'rec', ref: String(id), recording: String(id), hash, memo: `owl1 rec ${id} ${hash}` }])
  } catch (e) {
    console.error('solana recording', id, e.message)
  }
}

// Confirms sent transactions, resends ones whose blockhash expired, and
// retries anything still pending. Called whenever the Solana tab polls, so it
// also works on Vercel, where nothing runs between requests.
export async function refresh() {
  if (!solanaEnabled) return
  const col = await anchors()
  // A flush that died mid-send (process restart, frozen function).
  await col.updateMany({ status: 'sending', claimedAt: { $lt: Date.now() - 60_000 } }, { $set: { status: 'pending' } })
  const sent = await col.find({ status: 'sent' }).sort({ sentAt: 1 }).limit(200).toArray()
  const sigs = [...new Set(sent.map(a => a.sig))]
  for (let i = 0; i < sigs.length; i += 100) {
    const batch = sigs.slice(i, i + 100)
    const { value } = await rpc('getSignatureStatuses', [batch])
    for (const [j, s] of value.entries()) {
      const sig = batch[j]
      if (s && !s.err && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) {
        await col.updateMany({ sig, status: 'sent' }, { $set: { status: 'confirmed', slot: s.slot, confirmedAt: Date.now() } })
      } else if (s?.err) {
        await col.updateMany({ sig, status: 'sent' }, { $set: { status: 'failed', error: JSON.stringify(s.err).slice(0, 300) } })
      } else if (!s && sent.find(a => a.sig === sig).sentAt < Date.now() - RESEND_AFTER_MS) {
        await col.updateMany({ sig, status: 'sent', tries: { $lt: MAX_TRIES } }, { $set: { status: 'pending' }, $unset: { sig: '' } })
        await col.updateMany({ sig, status: 'sent' }, { $set: { status: 'failed', error: 'never confirmed' } })
      }
    }
  }
  await flush()
}

let balance = { at: 0, sol: null }
export async function summary() {
  const col = await anchors()
  const [list, counts] = await Promise.all([
    col.find({}).sort({ createdAt: -1 }).limit(100).toArray(),
    col.aggregate([{ $group: { _id: { kind: '$kind', status: '$status' }, n: { $sum: 1 } } }]).toArray(),
  ])
  if (Date.now() - balance.at > 30_000) {
    balance = { at: Date.now(), sol: await rpc('getBalance', [key().address, { commitment: 'confirmed' }]).then(r => r.value / LAMPORTS_PER_SOL).catch(() => balance.sol) }
  }
  return {
    counts: counts.map(c => ({ kind: c._id.kind, status: c._id.status, n: c.n })),
    balance: balance.sol,
    // A detection's anchored record says what the model saw; the page shows it instead of a bare hash.
    anchors: list.map(({ payload, ...a }) => {
      if (a.kind !== 'det' || !payload) return a
      try {
        const p = JSON.parse(payload)
        return { ...a, det: { label: p.label, confidence: p.confidence, model: p.model, image: p.image ?? null } }
      } catch {
        return a
      }
    }),
  }
}

export async function airdrop() {
  if (CLUSTER !== 'devnet') throw Object.assign(new Error('airdrops only exist on devnet'), { status: 400 })
  const sig = await rpc('requestAirdrop', [key().address, LAMPORTS_PER_SOL])
  balance.at = 0
  return sig
}

export async function byHash(hash) {
  return (await anchors()).find({ hash }, { projection: { payload: 0 } }).sort({ createdAt: 1 }).toArray()
}

// Recomputes an anchor's hash from the data as it is stored right now: the
// Tiger Data row for a detection, the file on disk for a recording. The page
// compares the result with the memo it reads from the chain itself.
export async function recompute(anchorDoc, { query, tigerEnabled, videoPath }) {
  if (anchorDoc.kind === 'rec') {
    if (!videoPath) return { ok: null, detail: 'The 15 fps files live on the droplet; open barn-owl.tech to check this one.' }
    try {
      return { ok: true, hash: await hashFile(videoPath(anchorDoc.ref, 'mjpeg')), detail: 'SHA-256 of the .mjpeg on the server' }
    } catch {
      return { ok: false, hash: null, detail: 'The video file is missing from the server.' }
    }
  }
  if (!tigerEnabled) return { ok: null, detail: 'Tiger Data is not configured, so the detection row cannot be read.' }
  const p = JSON.parse(anchorDoc.payload)
  const { rows } = await query(
    `select extract(epoch from ts) * 1000 as ts, node, recording, frame, label, confidence, x, y, w, h, model, image_sha256
     from detections where ts = to_timestamp($1 / 1000.0) and node = $2 and label = $3`,
    [p.ts, p.node, p.label])
  if (!rows.length) return { ok: false, hash: null, detail: 'The detection row is gone (deleted?).' }
  const candidates = rows.map(r => ({ row: r, payload: canonicalDetection({ ...r, ts: Number(r.ts) }) }))
  const { row, payload } = candidates.find(c => sha256(c.payload) === anchorDoc.hash) ?? candidates[0]
  return { ok: true, hash: sha256(payload), payload, anchored: anchorDoc.payload, detail: 'SHA-256 of the detection row in Tiger Data',
    picture: row.image_sha256 ? await checkPicture(row.image_sha256) : null }
}

// The sighting's picture as stored now, hashed again: it must still match the hash in the (anchored) row.
export async function checkPicture(sha) {
  const doc = await (await db()).collection('sighting_images').findOne({ _id: sha }, { projection: { jpeg: 1 } })
  if (!doc) return { ok: false, sha, detail: 'The picture is missing from storage.' }
  const now = createHash('sha256').update(doc.jpeg.buffer).digest('hex')
  return now === sha
    ? { ok: true, sha, detail: 'The stored picture hashes to ' + sha.slice(0, 12) + '…, the value in the anchored record.' }
    : { ok: false, sha, detail: 'The stored picture now hashes to ' + now.slice(0, 12) + '…, not ' + sha.slice(0, 12) + '….' }
}
