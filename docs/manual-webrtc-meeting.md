# Manual meeting WebRTC check (two participants)

Automated Playwright coverage for live camera/mic tracks is intentionally **not** in CI:
browser media permissions, fake devices, and ICE timing make it too flaky for a reliable gate.

## Steps

1. Start client + server (`npm run dev` from repo root).
2. Open two browser profiles/windows (or two devices on the same LAN).
3. Host: create a meeting from the Meet flow and allow camera/mic.
4. Guest: join via invite link, allow camera/mic, enter the call.
5. Confirm each side sees/hears the other’s live video and audio (not placeholders).
6. Mute on one side → other side should stop hearing audio (tile may still show video).
7. Start screen share → remote tile shows the shared screen updating live.
8. Host force-mute guest → guest mic stops and remote audio is silent.
9. Close one tab → the other side cleans up without hanging.
10. With TURN configured, repeat with two different networks (for example home Wi-Fi and mobile data). Confirm the selected ICE candidate pair includes a `relay` candidate in `chrome://webrtc-internals` when direct connectivity is unavailable. See [TURN setup](turn-setup.md).

If any step fails, treat Task 1 (meeting mesh) as incomplete.
