# DropSync — project documentation

This document describes how DropSync works end-to-end: product surfaces, runtime architecture, important code paths, and operational limits.

For setup and deploy steps, see the root [README.md](../README.md).

---

## 1. Product overview

DropSync is a monorepo with one room-based collaboration product:

| Surface | Route | Purpose |
|---------|-------|---------|
| Home | `/` | Create/join room by code or Room Link |
| Room | `/room/:code` | Timed collaboration room, files, recovery, and integrated call |

The room call uses the same authorized room socket as chat and files. The video dock stays on the room page and shrinks when the composer gains focus. Legacy meeting server code remains for compatibility, but the client no longer exposes a separate meeting route.

---

## 2. High-level architecture

```
Client (Vercel)
  ├── REST  → rooms, multipart file control, ice-servers
  ├── Socket.IO → live room state + in-room call signaling
  ├── S3 signed URLs → direct file upload and download
  └── WebRTC → mesh A/V inside rooms

Server (Render)
  ├── Express REST
  ├── Socket.IO (room channel = code; call channel = room-call:{code})
  ├── Redis → presence, expiry notices, rate limits, Socket.IO fan-out
  ├── MongoDB → authoritative rooms, grants, activity, file metadata, quotas
  └── private S3 → retained file objects

GitHub Actions → hourly authenticated cleanup call to the API
```

**Media is not relayed by the DropSync server.** The server only signals (offers, answers, ICE). Actual camera/mic/screen bits go peer-to-peer (or via TURN if configured).

---

## 3. Client architecture

### Contexts

| Context | Role |
|---------|------|
| `RoomContext` | Room session, activities, file transfers, rate-limit hint |
| `MeetingSessionContext` | Legacy standalone meeting code; no client route |
| `MeetingContext` | Legacy standalone media context |
| `ThemeContext` | Dark / light CSS variables |

### Key services

| File | Role |
|------|------|
| `services/api.js` | REST helpers including `getIceServers()` |
| `services/socket.js` | Room Socket.IO with bearer-token join |
| `services/roomFiles.js` | Direct S3 multipart upload, retry, and resume |
| `components/room/RoomCallDock.jsx` | In-room media, compact video dock, call moderation |
| `services/meetingSocket.js` | Meeting Socket.IO |
| `services/meetingWebRTC.js` | One `RTCPeerConnection` per remote peer; ICE queue; `replaceTrack` for screen |
| `services/meetingApi.js` | Meeting REST |

### Room call media notes

- Mesh size hard-capped at **6** participants.
- Lexicographic participant IDs decide who creates the offer (glare avoidance).
- Screen share uses `replaceTrack` on the existing video sender so all peers see the share without a new connection.
- Host/co-host force-mute emits `room-call-force-muted`; the client disables its microphone and the server rejects an unauthorized unmute state.
- The full dock occupies a third room column on desktop. Focusing chat/code input makes it compact while remote media playback stays mounted.

---

## 4. Server architecture

### Routes

- `routes/rooms.ts` — create / preview / authorized get / join / reopen / delete
- `routes/roomFiles.ts` — authorized multipart control and signed downloads
- `routes/meetings.ts` — create / get / join (mesh full = 403 at 6)
- `routes/transfers.ts` — short-lived legacy downloads and stats
- `GET /api/ice-servers` — STUN (+ TURN when env set)

### Socket modules

- `socket/index.ts` — room join, activity, file signal relay, leave/disconnect
- `socket/roomCalls.ts` — authorized in-room calls, signaling, admission, co-hosts, and moderation
- `socket/meetings.ts` — meeting join, media state, activity, **targeted** media signal relay, host ACL

Host-only actions are enforced server-side (`host-mute`, `host-remove`, `host-end`). Non-hosts are ignored.

### Stores

- `store/roomStore.ts` — MongoDB room lifecycle and grants, Redis expiry poller
- `store/meetingStore.ts` — Redis meeting documents, participants, media flags
- `services/roomFiles.ts` — multipart metadata, atomic quota reservations, completion
- `services/roomCleanup.ts` — retryable deletion of storage and private MongoDB data

### Rate limiting

`services/rateLimit.ts` — Redis fixed-window counters:

| Key pattern | Typical limit |
|-------------|----------------|
| `activity:{socketId}` / `meeting-activity:{socketId}` | 10 / 10s |
| `create-room` / `create-meeting` / join by IP | create ~10/min, join ~20/min |

Clients surface `rate_limited` as a calm inline “Slow down a bit” message.

---

## 5. Important user flows

### Create & join a room

1. `POST /api/rooms` → room, access token, and creator recovery key
2. Client navigates to `/room/:code`
3. `join-room` socket checks the access token → live `activity` / `room-state`
4. Guests: `POST /api/rooms/:code/join` (password if required) then socket join

### Share a file

1. Reserve room and app capacity through `/api/rooms/:code/files`
2. Browser uploads parts directly to private S3 through short signed URLs
3. Server verifies object size, commits metadata, and publishes file activity
4. Members request a signed download URL; incomplete uploads stay private

### Start a room call

1. Create or join a room using a Room Code or Room Link.
2. The existing `join-room` socket authenticates the participant grant.
3. Open the room's video button. `room-call-join` checks the active room and reserves one of six mesh slots.
4. Offer/answer/ICE pass over targeted `room-call-*` socket events. WebRTC carries media directly between peers or through TURN.
5. Chat, code, and direct S3 file uploads continue on the room page. The video dock shrinks while typing.

---

## 6. Limits & known trade-offs

| Topic | Behavior |
|-------|----------|
| Meeting size | Max **6** (mesh); larger groups need an SFU (not implemented) |
| Cross-network A/V | Needs working STUN; **TURN** strongly recommended for reliability |
| File delivery | Direct S3 multipart; 500 MiB/file, 2 GiB/room, 8 GiB/app |
| Recovery | 24 hours after expiry; creator key reopens for original duration |
| Render free tier | API may cold-start after idle |
| Playwright Meet E2E | Not in CI; use [manual-webrtc-meeting.md](./manual-webrtc-meeting.md) |

---

## 7. Environment reference

| Variable | Where | Purpose |
|----------|-------|---------|
| `CLIENT_ORIGIN` | Server | CORS + Socket.IO origin |
| `REDIS_URL` | Server | Required |
| `MONGODB_URI` | Server | Required |
| `STUN_URLS` / `TURN_*` | Server | ICE for clients via `/api/ice-servers` |
| `AWS_REGION`, `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Server | Private S3 region, bucket, and IAM credentials |
| `CLEANUP_SECRET` | Server and GitHub Actions | Authenticates hourly cleanup |
| `VITE_API_URL` | Client build | API + socket base URL |

---

## 8. Contributing checklist

Before a PR:

1. `npm run build` (root or both packages)
2. `npm test` with Redis and MongoDB replica set up
3. Manual [room call check](./manual-room-call.md) if you touched WebRTC or room call UI
4. Keep room file bytes on direct S3 requests
5. Keep host ACL logic in `meetings.ts` intact unless fixing a proven bug

---

## 9. Related docs

- [api-contract.md](./api-contract.md)
- [socket-events.md](./socket-events.md)
- [manual-webrtc-meeting.md](./manual-webrtc-meeting.md)
