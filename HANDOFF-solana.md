# Handoff — Solana track: tamper-proof recordings

Planning notes for adding Solana to Barn Owl for the DivHacks 2026 Solana track: what we decided and why. The first version is now built into the dashboard (next section). The Pi-side chunk hashing described further down is not built yet.

## What's built (2026-09-26): the dashboard's Solana tab
The **dashboard server** anchors evidence on Solana **devnet** with its own key. The Pi doesn't sign anything yet.

- **What gets anchored**
  - Every detection POSTed to `/api/detections`: the SHA-256 of a canonical JSON form of the row. Memo: `owl1 det <hash>`.
  - Every 15 fps recording the Pi uploads: the SHA-256 of the `.mjpeg` file. Memo: `owl1 rec <id> <hash>`. This runs on the droplet only (Vercel doesn't store the videos).
  - Up to 5 memos go in one transaction, signed by `SOLANA_ANCHOR_KEY`.
- **Code**
  - `dashboard/lib/solana.js`: hashing, a send queue (MongoDB collection `anchors`), confirmations, resends.
  - `dashboard/api/solana.js`: the tab's API.
  - Hooks: `api/detections.js` and `lib/videos.js`.
  - Anchoring never blocks or fails an upload. Anything unsent is retried whenever the tab polls, which also makes it work on Vercel.
- **The tab**
  - Anchor count, the key's address and balance (with an **Airdrop** button on devnet).
  - A **live chain log**: the browser subscribes to Solana over WebSocket (`logsSubscribe`), so rows flip to "✓ confirmed live" the moment the chain confirms them, without going through our server.
  - **Verify** on each row: the server recomputes the hash from the data as stored now (the Tiger Data row, or the file on disk), and the browser reads the memo from the chain itself and compares the two. For a detection, it lists which fields changed.
  - **Drop a file**: hash a downloaded original MJPEG in the browser and check it against the chain.
  - A "what this proves / doesn't" note.
- **Setup**
  - `SOLANA_ANCHOR_KEY` is a JSON byte array, like `solana-keygen` writes. It's in `dashboard/.env.local`; a backup is at `~/.config/solana/barn-owl-anchor-devnet.json`.
  - Optional: `SOLANA_CLUSTER` (default `devnet`), `SOLANA_RPC`, `SOLANA_PUBLIC_RPC`.
  - `deploy/push.sh --secrets` now ships `SOLANA_*` vars to the droplet. On Vercel, add the variable with `vercel env add SOLANA_ANCHOR_KEY`.
  - If the key isn't set, nothing is anchored and the tab says so.
- **Tamper demo:** change one field of a detection in Tiger Data (e.g. `update detections set confidence = 0.99 where …`), or flip a byte in a `.mjpeg` on the droplet, then press **Verify**.
- **Not built yet:** the Pi signing with its own key, and live 10-second chunk hashing while recording (both described below).

## TL;DR
- **Build:** the camera hashes its footage every ~10 seconds while recording and writes each hash to Solana (devnet). The dashboard shows those hashes landing on-chain **live**, next to the video.
- **Skip the Ledger** (the Nano S Plus won at a previous hackathon) unless there's time left at the end. It's a nice extra, not the core.
- **Don't use Solana to pay for the device.** That's just a checkout page and has nothing to do with what Barn Owl does.

## The pitch
Barn Owl is an unattended IR night camera. With this feature it becomes a camera that **proves its own footage hasn't been edited**:

> "Every 10 seconds of footage is fingerprinted and posted to Solana, signed by the camera itself. Watch the fingerprints confirm on-chain as the owl moves. Later, anyone can drop in a clip and check it wasn't cut or altered."

Why this fits Solana: it needs a chain that's fast (confirmations in about a second, so the ticker feels live) and cheap (hundreds of transactions per hour). This matters for wildlife research, citizen science and evidence of poaching or trespass.

## Ideas we considered
| Idea | Verdict |
|---|---|
| Pay for the device with Solana | ❌ Weak. It's generic e-commerce and doesn't use anything about the camera. |
| Hash each finished recording on-chain | ✅ Good, but you wait up to 30 min (the `REC_MAX`) for one hash. |
| **Hash ~10s chunks, linked together, shown live** | ✅✅ **Chosen.** Visual, real-time, and a stronger claim. |
| Solana Pay QR code: tip the node, or pay to turn on the IR light or start recording | 🟡 Stretch goal. Fits the existing dashboard → Pi commands. |
| Ledger as the owner/treasury key | 🟡 Optional, last. See below. |

## How it works

### Hash chaining
While a recording is on, the Pi groups frames into ~10s chunks. For each chunk:

```
chunk_hash_n = SHA256( prev_hash || SHA256(all JPEG bytes in chunk n) || frame times )
```

The first chunk uses the recording ID as `prev_hash`. Because each hash includes the one before it, the hashes form a chain: you can't delete, reorder or edit a chunk without breaking every hash after it.

Each chunk hash goes on-chain as a **Memo program** transaction (no custom smart contract needed), e.g.:

```
owl1|<recording id>|<chunk #>|<chunk hash hex>
```

### Who signs
- **The camera signs with its own key**: a Solana keypair generated on the Pi and stored on the SD card (e.g. `~/barn-owl/device-key.json`, mode 600). Keep only a little SOL in it for fees; on devnet, use the airdrop.
- The camera's public address is shown on the dashboard. Filtering the explorer by that address shows everything the camera has ever posted.

### Where the code goes
- `pi/agent.py`: `Recorder.write()` already sees every frame. Keep a running SHA-256 per chunk there, and every ~10s close the chunk, chain it, and queue the hash. `Recorder._close()` closes the final partial chunk.
- **Sending transactions:** we don't know yet whether the Pi will have normal internet at the venue (campus 802.1X Wi-Fi blocked it before; today it reaches the dashboard via `/api/pi`).
  - Plan: **the Pi always signs.** If it can reach a Solana RPC, it sends the transaction itself. If not, it hands the signed transaction to the dashboard in its normal `/api/pi` sync, and the server sends it. The camera's signature is what matters, so the proof holds either way.
  - Chunk hashes must be queued on disk so recordings made offline still get posted later (same idea as the existing `Uploader` and its `.uploaded` markers).
- **Dashboard:**
  - **Live chain-log panel** next to the video. The browser subscribes to Solana over WebSocket (`onLogs` on the camera's address), so rows appear the moment the chain confirms them. The page watches the chain itself rather than trusting our server.
    ```
    ● LIVE  Chain log — barn-owl-01
    21:04:12  rec 0419 #3  a3f9…c21e  ✓ confirmed  [explorer]
    21:03:58  rec 0419 #2  77b0…9e04  ✓ confirmed  [explorer]
    21:03:44  rec 0419 #1  e12c…0af3  ✓ confirmed  [explorer]
    ```
  - **"Verified on Solana ✓" badge** on each saved recording in the recordings list.
  - **Verify page:** drop in a downloaded `.mjpeg` + `.txt`, re-hash the chunks in the browser, and compare them with the on-chain memos. It shows ✓ for each chunk, or exactly which chunk was tampered with.
    - Chunk boundaries must be reproducible from the file alone. Split on the frame times in the `.txt` (e.g. every 10,000 ms), not on wall-clock time at record time.

### Build order
1. Generate the Pi device key and fund it on devnet. Post one test memo from the Pi, or through the dashboard relay.
2. Chunk hashing + chaining in `Recorder`, with an on-disk queue and posting.
3. Live chain-log panel on the dashboard.
4. Verified badge + verify page.
5. *(Stretch)* Solana Pay QR code for tips or "pay to turn on the IR light."
6. *(Stretch)* Ledger as owner (below).

## The Ledger — why we're skipping it
The question was: "would the Ledger make a hash for every recording, and would I see it on the Ledger?" **No.**

- A Ledger needs a **human to press a button for every signature**. The camera runs unattended at 3am, so it can't sign the recording hashes.
- Leaving the Ledger plugged into the Pi would be worse: whoever stole the Pi would get the main wallet.
- The Ledger's screen only shows a transaction while you're approving it. It can't display a live feed, so the "see hashes in real time" part belongs on the dashboard.

In a full design, the Ledger would be the **owner/treasury key**, kept away from the camera, used rarely: receiving tips (receiving doesn't even need it plugged in), moving funds out, approving a new camera, revoking a stolen one. The Pi's throwaway key signs the routine hashes. If the Pi is stolen, the thief gets a few cents of fees and the owner revokes that camera.

**Decision:** the hashing is the project, and the Ledger adds setup risk (Ledger Live, the Solana app, wallet connection, possibly blind signing) for little demo value. No judge will mark us down for skipping it. **If there's time at the end:** make the Ledger's address the recipient of Solana Pay tips and name it as the camera's "owner" in the pitch ("the owner key lives on hardware, away from the field device"). That's about 10 minutes of work.

If we do use it: install the Solana app on the Ledger through Ledger Live and connect via Phantom or Solflare on devnet. Plain transfers and memos don't need blind signing; a custom program probably would.

## Demo script
1. Show the dashboard: live video, an empty chain log, the camera's Solana address.
2. Press **Record**, then wave a hand in front of the camera under the IR light.
3. Within a couple of seconds, chunk hashes start scrolling into the chain log, each marked ✓ confirmed. Click one to open the Solana explorer and show the memo signed by the camera.
4. Stop the recording. It shows up with **Verified on Solana ✓**.
5. Download the clip, remove a few frames (or flip bytes), and drop it on the verify page. The chunks before the edit show ✓; the edited chunk and everything after it show ✗.
6. *(If built)* Someone scans the Solana Pay QR code and tips 0.01 SOL to the owner address.

## Open questions
- Will the Pi have normal internet at the venue? (Decides whether it sends transactions directly or through the dashboard; the plan supports both.)
- Chunk length: 10s is the working choice. Shorter makes the ticker livelier; longer means fewer transactions.
- Devnet only for the demo? (Assumed yes.)
