# DropSync

Ephemeral collaboration rooms — share files, text, links, clipboard, and code with built-in video meetings.

## Stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4, React Router, Socket.IO client, WebRTC (local preview)
- **Backend:** Node.js, Express, Socket.IO (signaling + real-time sync), Redis (live room state), MongoDB (room history)
- **Contracts:** [docs/api-contract.md](docs/api-contract.md), [docs/socket-events.md](docs/socket-events.md)

## Getting started

### Prerequisites

- Node.js 22+
- Redis (local or hosted)
- MongoDB (local or hosted)

### Install

```bash
npm install
npm install --prefix client
npm install --prefix server
```

### Environment

Copy `server/.env.example` to `server/.env` and set:

```
PORT=3001
CLIENT_ORIGIN=http://localhost:5173
ROOM_DURATION_SECONDS=300
REDIS_URL=redis://localhost:6379
MONGODB_URI=mongodb://localhost:27017/dropsync
```

The server validates env with Zod on startup and exits with a clear error if `REDIS_URL` or `MONGODB_URI` are missing or malformed.

### Run

```bash
npm run dev
```

- Frontend: [http://localhost:5173](http://localhost:5173)
- Backend: [http://localhost:3001](http://localhost:3001)

Or run separately:

```bash
npm run dev:client
npm run dev:server
```

## Features

- Landing page with **Create room** / **Join room** tabs
- Real-time room sync via **REST + Socket.IO**
- Room dashboard with code, QR, countdown timer, participants, and activity feed
- **File sharing** — drag & drop, attach button, image preview, local download (metadata only; P2P transfer coming soon)
- **Video & audio meetings** — start meeting, mute/unmute, camera on/off
- **Screen sharing** — share screen, window, or tab
- **In-call collaboration** — messages, links, clipboard sync, code snippets
- Dark / light mode toggle

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/rooms` | Create a room |
| GET | `/api/rooms/:code` | Get room state |
| POST | `/api/rooms/:code/join` | Join a room |
| GET | `/health` | Health check |

Full request/response shapes: [docs/api-contract.md](docs/api-contract.md).

## Socket events

| Event | Direction | Description |
|-------|-----------|-------------|
| `join-room` | client → server | Join room channel |
| `activity` | client → server | Share message/file/link/clipboard/code |
| `meeting-state` | client → server | Update meeting participant state |
| `system-activity` | client → server | Meeting system line |
| `leave-room` | client → server | Unbind socket from room |
| `room-state` | server → client | Full room state update |
| `activity` | server → client | New activity item |
| `room-expired` | server → client | Room TTL reached or emptied |

Full payloads: [docs/socket-events.md](docs/socket-events.md).

## Architecture

```
React Frontend
    ↕ REST + Socket.IO
Node.js + Express (+ Socket.IO Redis adapter)
    ↕
Redis (live rooms + TTL)     MongoDB (room_history on close)
    ↕
WebRTC Peer Connections (planned) → file transfer, video, audio, screen share
```

Active rooms are stored in Redis with native key expiry. A short expiry poller (with a Redis claim lock) emits `room-expired` and writes a `room_history` document so state survives process restarts and multiple server instances.

## Deployment

Provision Redis and MongoDB as managed services and point `REDIS_URL` / `MONGODB_URI` at them. Deploy the Vite client separately (static host) and set `CLIENT_ORIGIN` to that origin. Health check: `GET /health`.

### Railway

1. Create a new project and add **Redis** and **MongoDB** plugins (or external URLs).
2. Add a service from this repo with root directory `server`.
3. Set start command to `npm run start` (build command `npm run build`).
4. Configure env vars: `PORT` (Railway sets this), `CLIENT_ORIGIN`, `ROOM_DURATION_SECONDS`, `REDIS_URL`, `MONGODB_URI`.
5. Deploy the `client` build to Railway static hosting, Vercel, Netlify, or Cloudflare Pages; point `CLIENT_ORIGIN` at that URL.

### Render

1. Create a **Web Service** with root directory `server`, build `npm install && npm run build`, start `npm run start`.
2. Add Render **Redis** and an external MongoDB (Atlas works well); set `REDIS_URL` and `MONGODB_URI`.
3. Set `CLIENT_ORIGIN` to your static site URL.
4. Host the client as a Static Site (`client`, build `npm install && npm run build`, publish `dist`).

### Fly.io

```bash
cd server
fly launch --no-deploy
fly secrets set CLIENT_ORIGIN=https://your-app.fly.dev \
  REDIS_URL=redis://... \
  MONGODB_URI=mongodb+srv://... \
  ROOM_DURATION_SECONDS=300
fly deploy
```

Use Fly Redis (Upstash) or an external Redis, and MongoDB Atlas (or similar) for `MONGODB_URI`.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start client + server |
| `npm run build` | Production build |
| `npm run preview` | Preview production client |

CI (GitHub Actions) runs client oxlint, typechecks both packages, and builds both on every push and pull request.
