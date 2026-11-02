# DropSync

Ephemeral collaboration for quick shares and small video calls.

DropSync has two complementary flows:

1. **Rooms** — short-lived spaces to share text, links, files, clipboard, and code (optional password, QR join, live activity feed).
2. **Meet** — standalone Google Meet–style calls at `/meet/:code` with real P2P audio/video, screen share, pin/unpin, and host controls.

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
- Dark / light theme
- Redis-backed rate limits on create/join/activity (client shows “Slow down a bit”)

### Meet (standalone)

- Create or join via `/meet/:code` (decoupled from rooms)
- Live camera + microphone between participants (P2P mesh, max 6)
- Screen share with Meet-style stage + participant strip
- Pin / unpin any video tile
- Mute / camera toggle; host force-mute, remove, end-for-everyone
- Meeting activity log; mesh size capped for reliability

---

## Repository layout

```
DropSync/
├── client/                 # Vite React app
│   ├── src/
│   │   ├── components/     # UI (room, meeting, layout, home)
│   │   ├── context/        # Room, Meeting, MeetingSession, Theme
│   │   ├── pages/          # Home, Room, Meet
│   │   ├── services/       # API, sockets, fileTransfer, meetingWebRTC
│   │   └── types/
│   └── vercel.json         # SPA rewrites
├── server/                 # Express + Socket.IO API
│   ├── src/
│   │   ├── routes/         # rooms, meetings, transfers
│   │   ├── socket/         # room + meeting handlers
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
                                         meetings, rate limits)    (room lifecycle,
                                                                  activity, grants)

Browser files go directly to a private S3 bucket with short signed URLs.
```

### Design choices

| Topic | Choice |
|-------|--------|
| Meeting topology | **Mesh** WebRTC (one `RTCPeerConnection` per remote peer), capped at **6** participants |
| File transfer | **Direct multipart** to private S3; no new file bytes pass through Express |
| Room lifecycle | MongoDB is authoritative; Redis expiry events improve live UI timing |
| Screen share | `RTCRtpSender.replaceTrack()` on existing video sender (no full renegotiation) |
| Rate limits | Redis fixed windows (activity per socket; create/join by IP) |

Manual two-tab A/V checklist: [docs/manual-webrtc-meeting.md](docs/manual-webrtc-meeting.md).

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
| `POST` | `/api/meetings` | Create meeting |
| `GET` | `/api/meetings/:code` | Meeting state |
| `POST` | `/api/meetings/:code/join` | Join meeting |
| `GET` | `/api/transfers/:transferId/download` | Short-lived legacy download only |

Room/file shapes: [docs/temporary-storage.md](docs/temporary-storage.md). Meeting shapes: [docs/api-contract.md](docs/api-contract.md).

### Socket.IO (summary)

**Rooms:** `join-room` with member token, `activity`, `leave-room`, `room-state`, `activity`, `room-expired`.

**Meetings:** `join-meeting`, `meeting-media-state`, `meeting-activity`, `meeting-offer` / `meeting-answer` / `meeting-ice-candidate`, host actions (`host-mute`, `host-remove`, `host-end`), `leave-meeting`, plus `meeting-state`, `peer-joined` / `peer-left`, `force-muted`, `removed-by-host`, `meeting-ended`.

Full payloads: [docs/socket-events.md](docs/socket-events.md).

---

## Testing & CI

- **Server:** Vitest — room access, expiry/recovery, multipart metadata, concurrent quotas, cleanup retry, socket isolation, meeting host ACL.
- **CI:** GitHub Actions — lint/build client, typecheck/build server, Redis and MongoDB replica set, required server tests.
- **Meet A/V:** not automated in CI (flaky media permissions); use the manual guide above.

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
| [docs/manual-webrtc-meeting.md](docs/manual-webrtc-meeting.md) | Manual Meet A/V QA |

---

## License / status

Private project (`0.1.0`). Features evolve quickly; prefer this README and `docs/` over older blog-style notes.
