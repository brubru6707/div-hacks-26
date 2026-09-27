// One-off: copy existing MongoDB recordings into Tiger Data's recordings table
// (new ones are added automatically). Safe to re-run; it upserts.
//   cd dashboard && node --env-file=.env.local deploy/backfill-tiger.js
import { MongoClient } from 'mongodb'
import { upsertRecording, query } from '../lib/tiger.js'

const client = await new MongoClient(process.env.MONGODB_URI).connect()
const recs = await client.db('barn_owl').collection('recordings').find({}).toArray()
for (const r of recs) {
  await upsertRecording({
    id: r._id, startedAt: r.startedAt, endedAt: r.endedAt, durationSec: r.durationSec, zoom: r.zoom ?? 1,
    piFrames: r.video?.frames ?? r.pi?.frames ?? null, fps: r.video?.fps ?? r.pi?.fps ?? null, status: r.status,
  })
}
const { rows } = await query('select count(*)::int as n from recordings')
console.log(`upserted ${recs.length} recordings; Tiger now has ${rows[0].n}`)
await client.close()
process.exit(0)
