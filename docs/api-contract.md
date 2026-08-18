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

## `POST /api/rooms`

Create a new ephemeral room. The creator is added as the first participant (`name: "You"`).

### Request body

Optional JSON:

```json
{
  "password": "secret"
}
```

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `password` | string | no | 4–64 chars if set; omit or empty for an open room |

### Response `201`

```json
{
  "room": {
    "code": "ABC123",
    "createdAt": "2026-08-18T14:00:00.000Z",
    "expiresAt": "2026-08-18T14:05:00.000Z",
    "participants": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "name": "You"
      }
    ],
    "activities": [
      {
        "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        "type": "system",
        "content": "Room created — share the code or QR to invite others",
        "timestamp": "2026-08-18T14:00:00.000Z"
      }
    ],
    "meetingActive": false,
    "hasPassword": true
  },
  "participantId": "550e8400-e29b-41d4-a716-446655440000"
}
```

Password hashes are never returned — only `hasPassword`.

> Note: Rooms no longer host video meetings. Use `/api/meetings` for standalone calls. `meetingActive` may be absent on newer servers.
---

## `GET /api/rooms/:code`

Fetch current room state by code.

### Path params

| Param | Type | Description |
|-------|------|-------------|
| `code` | string | Room code (case-insensitive; non-alphanumeric chars stripped) |

### Response `200`

```json
{
  "room": {
    "code": "ABC123",
    "createdAt": "2026-08-18T14:00:00.000Z",
    "expiresAt": "2026-08-18T14:05:00.000Z",
    "participants": [],
    "activities": [],
    "meetingActive": false
  }
}
```

### Errors

| Status | Body | When |
|--------|------|------|
| `400` | `{ "error": "Invalid room code" }` | Code is not 6 alphanumeric chars after normalization |
| `404` | `{ "error": "Room not found or expired" }` | Missing or past `expiresAt` |

---

## `POST /api/rooms/:code/join`

Join an existing room as a new participant.

### Path params

| Param | Type | Description |
|-------|------|-------------|
| `code` | string | Room code |

### Request body

```json
{
  "displayName": "Alex",
  "password": "secret"
}
```

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `displayName` | string | no | trimmed, 1–32 chars; defaults to `"Guest"` |
| `password` | string | when room is protected | max 64 chars |

### Response `200`

```json
{
  "room": { "...": "public room including the new participant and join system activity" },
  "participantId": "550e8400-e29b-41d4-a716-446655440001"
}
```

### Errors

| Status | Body | When |
|--------|------|------|
| `400` | `{ "error": "Invalid room code" }` | Invalid code |
| `400` | `{ "error": "Invalid request body" }` | Body fails validation |
| `401` | `{ "error": "password_required" }` | Room is protected and password omitted |
| `401` | `{ "error": "incorrect_password" }` | Password does not match |
| `404` | `{ "error": "Room not found or expired" }` | Room missing or expired |

---

## `GET /api/ice-servers`

ICE servers for file-transfer peer connections (STUN always; TURN only if configured).

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

## `POST /api/transfers/upload`

Fallback upload when P2P fails (raw body, max 32MB). Headers: `x-file-name`, `x-mime-type`.

### Response `201`

```json
{
  "transferId": "uuid",
  "downloadUrl": "https://host/api/transfers/{id}/download",
  "path": "storage"
}
```

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
    "participants": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "name": "Host",
        "isHost": true,
        "isMuted": false,
        "isCameraOff": false,
        "isScreenSharing": false
      }
    ]
  },
  "participantId": "550e8400-e29b-41d4-a716-446655440000"
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
  "participantId": "uuid"
}
```

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
| `participants` | array | `{ id, name, isHost, isMuted, isCameraOff, isScreenSharing }` |

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
