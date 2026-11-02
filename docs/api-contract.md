# DropSync API contract

Base URL: `http://localhost:3001` (or your deployed server origin).

All room payloads use ISO-8601 timestamps. Room codes are 6-character alphanumeric strings (normalized to uppercase).

---

## `GET /health`

Liveness check. Does not depend on Redis/Mongo connectivity beyond process start.

### Response `200`

```json
{
  "status": "ok",
  "timestamp": "2026-08-18T14:00:00.000Z"
}
```

---

## `GET /ready`

Readiness check for MongoDB and Redis. Each dependency is pinged with a one-second timeout. Returns `200` when both are available and `503` during shutdown or when either dependency is unavailable.

```json
{
  "status": "ready",
  "dependencies": { "mongo": true, "redis": true }
}
```

---

## Room and file API

The current room lifecycle, bearer-token authorization, multipart file endpoints, recovery, and deletion contracts are documented in [temporary-storage.md](temporary-storage.md).

---

## `GET /api/ice-servers`

ICE servers for standalone meeting peer connections (STUN always; TURN only if configured). `turnConfigured` reports configuration, not proof that the relay is reachable. When `TURN_URLS` is set, the TURN entry's `urls` is an array of all configured transports.

### Response `200`

```json
{
  "iceServers": [{ "urls": "stun:stun.l.google.com:19302" }],
  "turnConfigured": false
}
```

---

## `GET /api/transfer-stats`

In-memory counters for completed transfers.

### Response `200`

```json
{
  "direct": 1,
  "relay": 0,
  "storage": 2,
  "total": 3
}
```

---

## Legacy transfer downloads

New file uploads use `/api/rooms/:code/files`; the old upload endpoint has been removed. `/api/transfers/:transferId/download` remains briefly for previously issued links.

---

## `POST /api/meetings`

Create a standalone video meeting. Creator is recorded as host.

### Response `201`

```json
{
  "meeting": {
    "code": "XYZ789",
    "hostParticipantId": "550e8400-e29b-41d4-a716-446655440000",
    "createdAt": "2026-08-18T14:00:00.000Z",
    "expiresAt": "2026-08-18T22:00:00.000Z",
    "permissions": { "requireAdmission": true, "allowScreenShare": true, "allowParticipantUnmute": true },
    "participants": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "name": "Host",
        "isHost": true,
        "isCoHost": false,
        "isMuted": false,
        "isCameraOff": false,
        "isScreenSharing": false
      }
    ]
  },
  "participantId": "550e8400-e29b-41d4-a716-446655440000",
  "accessToken": "random-participant-token"
}
```

---

## `GET /api/meetings/:code`

### Response `200`

```json
{ "meeting": { "...": "PublicMeetingRecord" } }
```

### Response `404`

```json
{ "error": "Meeting not found or ended" }
```

---

## `POST /api/meetings/:code/join`

### Request body

```json
{ "displayName": "Alex" }
```

### Response `200`

```json
{
  "meeting": { "...": "PublicMeetingRecord" },
  "participantId": "uuid",
  "accessToken": "random-participant-token"
}
```

The token is private to that participant and is required when joining the meeting socket. When admission is required, REST join reserves a place but omits the waiting participant from the public roster until a moderator admits them.

---

## Shared types

### `RoomRecord`

| Field | Type | Description |
|-------|------|-------------|
| `code` | string | Room code |
| `createdAt` | string (ISO) | Creation time |
| `expiresAt` | string (ISO) | TTL end time |
| `participants` | `Participant[]` | Current participants |
| `activities` | `ActivityItem[]` | Activity feed |
| `hasPassword` | boolean | Whether the room requires a password (hash never exposed) |

### `Participant`

| Field | Type | Description |
|-------|------|-------------|
| `id` | string (uuid) | Participant id |
| `name` | string | Display name |
| `socketId` | string? | Bound Socket.IO id when connected (never sent to clients) |

### `MeetingRecord` / public meeting

| Field | Type | Description |
|-------|------|-------------|
| `code` | string | Meeting code |
| `hostParticipantId` | string (uuid) | Host participant id |
| `createdAt` / `expiresAt` | string (ISO) | Lifetime |
| `permissions` | object | Admission, participant screen sharing, and participant unmute settings |
| `participants` | array | Admitted members only: `{ id, name, isHost, isCoHost, isMuted, isCameraOff, isScreenSharing }` |

### `ActivityItem`

| Field | Type | Description |
|-------|------|-------------|
| `id` | string (uuid) | Activity id |
| `type` | `"system" \| "message" \| "file" \| "link" \| "clipboard" \| "code" \| "meeting"` | Kind |
| `content` | string | Payload text / description |
| `sender` | string? | Display name |
| `senderId` | string? | Participant id |
| `timestamp` | string (ISO) | Created at |
| `fileMeta` | object? | `{ fileName, fileSize, mimeType }` for file activities |

---

## `404` (unknown routes)

```json
{ "error": "Not found" }
```
