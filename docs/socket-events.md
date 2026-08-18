# DropSync Socket.IO events

Transport: Socket.IO over the same HTTP server as the REST API (`CLIENT_ORIGIN` CORS).

Clients connect to the server origin (e.g. `http://localhost:3001`). After joining via REST, they emit `join-room` with the returned `participantId` to bind the socket and receive live updates.

Room channels use the room **code** as the Socket.IO room name.

---

## Client → server

### `join-room`

Bind this socket to a participant and join the room channel.

**Payload**

```json
{
  "code": "ABC123",
  "participantId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Ack** (optional callback)

Success:

```json
{
  "ok": true,
  "room": { "...": "RoomRecord" }
}
```

Failure:

```json
{
  "ok": false,
  "error": "Invalid join payload | Invalid room code | Room not found or participant invalid"
}
```

**Side effects**

- Sets `participant.socketId` on the room record
- Emits `room-state` to *other* sockets in the room (not the joiner; joiner gets room via ack)

---

### `activity`

Share a feed item (message, file metadata, link, clipboard, code, or meeting note).

**Payload**

```json
{
  "type": "message",
  "content": "Hello",
  "fileMeta": {
    "fileName": "notes.txt",
    "fileSize": 128,
    "mimeType": "text/plain"
  }
}
```

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `type` | string | yes | `"message" \| "file" \| "link" \| "clipboard" \| "code" \| "meeting"` |
| `content` | string | yes | 1–10000 chars |
| `fileMeta` | object | no | `{ fileName: string, fileSize: number, mimeType: string }` |

Requires an active `join-room` session. Invalid payloads are ignored (no ack).

**Side effects**

- Persists activity on the room
- Broadcasts `activity` to all sockets in the room (including sender)

---

### `meeting-state`

Update this participant’s meeting flags.

**Payload** (all fields optional)

```json
{
  "inMeeting": true,
  "isMuted": false,
  "isCameraOff": true,
  "isScreenSharing": false
}
```

Requires an active session. On success, broadcasts `room-state` to the room.

---

### `system-activity`

Convenience event for meeting-related system lines (stored as `type: "meeting"`).

**Payload**

```ts
content: string  // non-empty after trim
```

Requires an active session. Broadcasts `activity` to the room.

---

### `leave-room`

Unbind socket flags for this participant without removing them from the room roster.

**Payload:** none

**Side effects**

- Clears `socketId` and meeting flags on the participant
- Leaves the Socket.IO room
- Broadcasts `room-state` if the room still exists

---

### `disconnect` (Socket.IO built-in)

When the transport disconnects with an active session:

- Removes the participant from the room
- If others remain → broadcast `room-state`
- If the room is empty → room is deleted and `room-expired` is emitted to the room channel

---

### `file-offer` / `file-answer` / `file-ice-candidate`

WebRTC signaling for **file-transfer data channels only** (not meeting media).

**Payload**

```json
{
  "targetParticipantId": "uuid",
  "senderParticipantId": "uuid",
  "payload": {}
}
```

Relayed by the server only to the target participant’s socket.

---

### `file-transfer-complete`

After a storage-fallback upload, tell the room a download URL is ready.

```json
{
  "activityId": "uuid",
  "transferId": "uuid",
  "downloadUrl": "https://...",
  "transferPath": "storage"
}
```

---

## Server → client

### `room-state`

Full room snapshot after joins, leaves, meeting updates, etc.

**Payload:** `RoomRecord` (same shape as REST)

---

### `file-offer` / `file-answer` / `file-ice-candidate`

Same shape as the client→server events; delivered to the addressed peer.

---

### `file-transfer-complete`

```json
{
  "activityId": "uuid",
  "transferId": "uuid",
  "downloadUrl": "https://...",
  "transferPath": "storage",
  "senderParticipantId": "uuid"
}
```

---

### `activity`

A newly appended activity item.

**Payload:** `ActivityItem`

```json
{
  "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "type": "message",
  "content": "Hello",
  "sender": "Alex",
  "senderId": "550e8400-e29b-41d4-a716-446655440001",
  "timestamp": "2026-08-18T14:01:00.000Z"
}
```

---

### `room-expired`

Room TTL reached, or the last participant disconnected (room deleted).

**Payload:** none

Clients should leave the room UI. Sockets are also removed from the Socket.IO room on TTL expiry.

---

## Multi-instance notes

The server uses the Socket.IO Redis adapter so `room-state`, `activity`, and `room-expired` fan out correctly across multiple Node processes sharing the same Redis.

Live room documents live in Redis (`room:data:{code}`) with Redis `EXPIRE` plus an expiry index; a short poller claims and processes due rooms so expiry stays correct after restarts and across instances.
