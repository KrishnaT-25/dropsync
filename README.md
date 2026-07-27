# DropSync

Ephemeral collaboration rooms — share files, text, links, clipboard, and code with built-in video meetings.

## Stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4, React Router, Socket.IO client, WebRTC (local preview)
- **Backend:** Node.js, Express, Socket.IO (signaling + real-time sync), in-memory room store (Redis/MongoDB planned)

## Getting started

Install dependencies:

```bash
npm install
npm install --prefix client
npm install --prefix server
```

Run both frontend and backend:

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
- **File sharing** — drag & drop, attach button, image preview, local download
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

## Socket events

| Event | Direction | Description |
|-------|-----------|-------------|
| `join-room` | client → server | Join room channel |
| `activity` | client → server | Share message/file/link/clipboard/code |
| `meeting-state` | client → server | Update meeting participant state |
| `room-state` | server → client | Full room state update |
| `activity` | server → client | New activity item |
| `room-expired` | server → client | Room TTL reached |

## Architecture

```
React Frontend
    ↕ REST + Socket.IO
Node.js + Express
    ↕
In-memory store (→ Redis planned)
    ↕
WebRTC Peer Connections (planned) → file transfer, video, audio, screen share
```

## Environment

Copy `server/.env.example` to `server/.env`:

```
PORT=3001
CLIENT_ORIGIN=http://localhost:5173
ROOM_DURATION_SECONDS=300
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start client + server |
| `npm run build` | Production build |
| `npm run preview` | Preview production client |
