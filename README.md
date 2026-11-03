# DropSync

Ephemeral collaboration for quick shares and small video calls.

DropSync uses one room for collaboration and calling. Create or join a room with a Room Code or Room Link, then start a video call inside it. Chat, code, and file sharing remain available while the call is running; focusing the composer shrinks the video dock.

---

## Table of contents

- [Stack](#stack)
- [Features](#features)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
- [Scripts](#scripts)
- [Architecture](#architecture)
- [API & sockets](#api--sockets)
- [Testing & CI](#testing--ci)
- [Deployment](#deployment)
- [Documentation index](#documentation-index)

---

## Stack

| Layer | Tech |
|-------|------|
| Client | React 19, JavaScript/JSX, Vite, Tailwind CSS, React Router, Socket.IO client, WebRTC |
| Server | Node.js, Express, Socket.IO, Zod, Redis, MongoDB |
| Realtime | Socket.IO (+ Redis adapter in production for multi-instance) |
| Media | Browser WebRTC mesh (STUN; optional TURN) — not an SFU |
| Files | Private Amazon S3; direct browser multipart upload/download with signed URLs |

---

## Features

### Rooms

- Create / join with 6-character codes; optional password and creator-selected lifetime (5 minutes to 24 hours)
- 24-hour read-only recovery window; creator recovery key reopens or deletes a room
- QR invite, expiry countdown, participant list
- Activity feed: messages, links, clipboard, code snippets, files
- Drag-and-drop / attach files (resumable direct S3 upload, 500 MiB per file)
- In-room WebRTC calls for up to six people, with microphone/camera controls and screen sharing
- Room Link invites, optional call admission, creator/co-host moderation, and call permissions
- Dark / light theme
- Redis-backed rate limits on create/join/activity (client shows “Slow down a bit”)

### Room calls

- Open the video button in an active room, then start or join its call.
- Call signaling uses the existing authorized room socket. The room remains open for chat and files.
- Focusing the message/code input minimizes the video dock; expand it again from the dock controls.
- The room creator can require admission, allow or block screen sharing/unmuting, mute or remove callers, and appoint co-hosts. Co-hosts can admit, mute, and remove callers.
- Expiry ends room access and the call at the room deadline. Calls use a WebRTC mesh capped at six people.

---

## Repository layout

```
DropSync/
├── client/                 # Vite React app
│   ├── src/
│   │   ├── components/     # UI (room, meeting, layout, home)
│   │   ├── context/        # Room and Theme; legacy Meeting contexts
│   │   ├── pages/          # Home and Room; legacy Meeting page
│   │   ├── services/       # API, sockets, fileTransfer, meetingWebRTC
│   │   └── types/
│   └── vercel.json         # SPA rewrites
├── server/                 # Express + Socket.IO API
│   ├── src/
│   │   ├── routes/         # rooms, meetings, transfers
│   │   ├── socket/         # room, room-call, and legacy meeting handlers
│   │   ├── store/          # Mongo room lifecycle, Redis meeting store
│   │   ├── services/       # rate limits, S3 multipart files, cleanup
│   │   └── test/           # Vitest (HTTP + socket)
│   └── vitest.config.ts
├── docs/                   # Contracts & guides
├── .github/workflows/      # CI and hourly cleanup caller
├── render.yaml             # Render blueprint (API + Redis)
└── package.json            # Root scripts (concurrently)
```

---

## Getting started

### Prerequisites

- Node.js **22+**
- Redis
- MongoDB replica set (transactions are required for quota reservations)
- Private Amazon S3 Standard bucket for recoverable files

### Install

```bash
npm install
npm install --prefix client
npm install --prefix server
```

### Environment

Copy `server/.env.example` → `server/.env`:

```env
PORT=3001
CLIENT_ORIGIN=http://localhost:5173
REDIS_URL=redis://localhost:6379
MONGODB_URI=mongodb://localhost:27017/dropsync?replicaSet=rs0&directConnection=true
```

Storage and cleanup (see `server/.env.example` and [setup guide](docs/temporary-storage.md)):

- `STUN_URLS`, `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` for meeting relay ([TURN setup](docs/turn-setup.md)); `TURN_URL` remains a single-URL fallback
- `AWS_REGION`, `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` for private S3
- `CLEANUP_SECRET` shared with the GitHub Actions cleanup workflow

Client (production / Vercel):

```env
VITE_API_URL=https://your-api.example.com
```

Locally, omit `VITE_API_URL` only if the client is proxied to the API; otherwise point it at `http://localhost:3001`.

### Run

```bash
npm run dev
```

- Client: http://localhost:5173
- API: http://localhost:3001 (`GET /health`)

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Client + server together |
| `npm run dev:client` / `dev:server` | Run one side |
| `npm run build` | Build client and server |
| `npm test` | Server Vitest suite |
| `npm run preview` | Preview production client build |

---

## Architecture

```
┌─────────────────┐     REST + Socket.IO      ┌──────────────────────────┐
│  React client   │ ◄──────────────────────► │  Express + Socket.IO     │
│  WebRTC mesh    │◄──────── P2P A/V ───────►│  (signaling only for A/V)│
└─────────────────┘                           └────────────┬─────────────┘
                                                           │
                                              ┌────────────┴────────────┐
                                              ▼                         ▼
                                         Redis (presence,          MongoDB
                                         call locks, rate limits)  (room lifecycle,
                                                                  activity, grants)

Browser files go directly to a private S3 bucket with short signed URLs.
```

### Design choices

| Topic | Choice |
|-------|--------|
| Room call topology | **Mesh** WebRTC (one `RTCPeerConnection` per remote peer), capped at **6** participants |
| File transfer | **Direct multipart** to private S3; no new file bytes pass through Express |
| Room lifecycle | MongoDB is authoritative; Redis expiry events improve live UI timing |
| Screen share | `RTCRtpSender.replaceTrack()` on existing video sender (no full renegotiation) |
| Rate limits | Redis fixed windows (activity per socket; create/join by IP) |

Manual two-browser A/V check: [docs/manual-room-call.md](docs/manual-room-call.md).

---

## API & sockets

### REST (summary)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Liveness |
| `GET` | `/api/ice-servers` | STUN/TURN config for WebRTC |
| `POST` | `/api/rooms` | Create room |
| `GET` | `/api/rooms/:code` | Private room state; bearer token required |
| `GET` | `/api/rooms/:code/preview` | Public status without private content |
| `POST` | `/api/rooms/:code/join` | Join room |
| `POST` | `/api/rooms/:code/reopen` | Creator recovery |
| `DELETE` | `/api/rooms/:code` | Creator early deletion |
| `*` | `/api/rooms/:code/files/*` | Direct multipart upload and signed download |
| `POST` | `/api/meetings` | Legacy standalone meeting API; no client entry point |
| `GET` | `/api/meetings/:code` | Legacy meeting state |
| `POST` | `/api/meetings/:code/join` | Legacy meeting join |
| `GET` | `/api/transfers/:transferId/download` | Short-lived legacy download only |

Room/file shapes: [docs/temporary-storage.md](docs/temporary-storage.md). Meeting shapes: [docs/api-contract.md](docs/api-contract.md).

### Socket.IO (summary)

**Rooms:** `join-room` with member token, `activity`, `leave-room`, `room-state`, `activity`, `room-expired`.

**Room calls:** authorized `room-call-status`, `room-call-join`, `room-call-leave`, `room-call-state`, targeted `room-call-offer` / `room-call-answer` / `room-call-ice-candidate`, and call moderation events. The older standalone meeting events remain on the server for compatibility.

Full payloads: [docs/socket-events.md](docs/socket-events.md).

---

## Testing & CI

- **Server:** Vitest — room access, expiry/recovery, multipart metadata, concurrent quotas, cleanup retry, socket isolation, meeting host ACL.
- **CI:** GitHub Actions — lint/build client, typecheck/build server, Redis and MongoDB replica set, required server tests.
- **Room A/V:** browser camera/microphone permissions need a real two-browser check; signaling and authorization are covered by socket tests.

```bash
npm test
```

Requires Redis and a MongoDB replica set. Storage operations are mocked in automated tests.

---

## Deployment

Recommended trial split: **Vercel** (client) + **Render** (API + Redis) + **MongoDB Atlas** + **Amazon S3** + **GitHub Actions cleanup**. AWS's new Free Plan may allow eligible new customers to start without a payment method, but ends after six months or when credits are exhausted; see [the storage guide](docs/temporary-storage.md).

### Render (API)

Blueprint: [`render.yaml`](render.yaml).

1. New → Blueprint → connect this GitHub repo.
2. Set `MONGODB_URI`, `CLIENT_ORIGIN` (your Vercel HTTPS origin, no trailing slash).
3. `REDIS_URL` is linked from the Key Value service.
4. Set S3 region, bucket, IAM access key variables, and `CLEANUP_SECRET`. TURN remains optional for cross-network meeting media.
5. Add `CLEANUP_URL` and `CLEANUP_SECRET` as GitHub Actions secrets and run the hourly cleanup workflow using [the storage guide](docs/temporary-storage.md).

Free Render web services sleep when idle; first request can be slow.

### Vercel (client)

1. Import repo; **Root Directory** = `client`.
2. Build: `npm run build`, output `dist`.
3. Env: `VITE_API_URL` = Render API origin.
4. Custom domain (e.g. `dropsync1.vercel.app`) under Project → Domains; then update Render `CLIENT_ORIGIN` and redeploy API.

SPA fallback: [`client/vercel.json`](client/vercel.json).

### Health

```bash
curl https://YOUR-API/health
curl https://YOUR-API/ready
```

---

## Documentation index

| Doc | Contents |
|-----|----------|
| [docs/PROJECT.md](docs/PROJECT.md) | Deeper architecture, flows, limits |
| [docs/temporary-storage.md](docs/temporary-storage.md) | Current room lifecycle, S3 setup, file API, cleanup |
| [docs/api-contract.md](docs/api-contract.md) | REST contracts |
| [docs/socket-events.md](docs/socket-events.md) | Socket.IO events |
| [docs/manual-room-call.md](docs/manual-room-call.md) | Manual room call and concurrent chat/file QA |

---

## License / status

Private project (`0.1.0`). Features evolve quickly; prefer this README and `docs/` over older blog-style notes.
