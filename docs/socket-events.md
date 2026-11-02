# DropSync Socket.IO events

The Socket.IO server runs beside the REST API. Room channels use the six-character code; meeting channels use `meeting:{code}`. The Redis adapter distributes events across server instances.

## Sharing rooms

Create or join through REST first. `join-room` requires `{ code, participantId, accessToken }` and returns `{ ok, room? }`. The server checks the bearer token against its hashed MongoDB grant and refuses expired rooms. Room codes or participant IDs alone do not grant access.

| Direction | Event | Payload and behavior |
|---|---|---|
| Client → server | `activity` | `{ type, content }` for `message`, `link`, `clipboard`, `code`, or `meeting`. Active members only; the server validates, persists, and broadcasts the item. File activities are created by the verified file-completion API. |
| Client → server | `leave-room` | Unbinds the socket. The durable member grant remains so the participant can return during recovery. |
| Server → client | `room-state` | Public room snapshot after membership or storage changes. |
| Server → client | `activity` | Newly persisted activity item, including completed files. |
| Server → client | `room-expired` | Active period ended or creator requested deletion. Clients refresh via authorized REST and show the read-only recovery view when eligible. |

The older `file-offer`, `file-answer`, `file-ice-candidate`, and `file-transfer-complete` handlers remain temporarily for compatibility but the new client does not use them. New files use the private multipart API in [temporary-storage.md](temporary-storage.md).

## Standalone meetings

Meetings remain separate from sharing rooms. `join-meeting` uses `{ code, participantId, accessToken, displayName }` after REST create/join. The server responds with `{ ok, meeting? }` and joins admitted sockets to `meeting:{code}`. A waiting guest receives `{ ok: true, waiting: true }` and cannot send meeting media or activity until admitted and joined again.

| Direction | Events | Purpose |
|---|---|---|
| Client → server | `meeting-media-state`, `meeting-activity` | Update participant flags and broadcast call activity. |
| Client → server | `meeting-offer`, `meeting-answer`, `meeting-ice-candidate` | WebRTC signaling; browser media travels peer to peer. |
| Client → server | `host-mute`, `host-remove`, `host-end`, `leave-meeting` | Moderation and departure. Co-hosts may mute/remove ordinary guests; only the host may end the meeting. |
| Client → server | `meeting-admit`, `meeting-permissions`, `meeting-cohost` | Admit a waiting guest; host changes permissions and assigns/removes co-hosts. Only the original host can change permissions or co-host roles. |
| Server → client | `meeting-state`, `peer-joined`, `peer-left` | Meeting roster updates. |
| Server → client | `meeting-activity`, `force-muted`, `removed-by-host`, `meeting-ended` | Call activity and control results. |
| Server → client | `meeting-waiting`, `meeting-admitted` | Private waiting list for moderators; admission notice for the waiting guest. |

Meeting media is a six-person WebRTC mesh with optional TURN. The server relays signaling, not audio or video.
