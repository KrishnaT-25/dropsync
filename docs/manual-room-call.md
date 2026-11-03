# In-room call check

Use two browsers or devices with working cameras and microphones. TURN should be configured on the API when testing across different networks.

1. Create a room. Copy its **Room Link** from the chat header or room settings.
2. Open the link in the second browser. Confirm it joins the same room and can see the chat and files.
3. In the creator browser, click the video button in the room header and start the room call. Join it from the second browser using that same button. Confirm both voices and videos work.
4. While both are on the call, send chat messages, code, and a small file. Confirm the activity and file download appear for both browsers without ending the call.
5. Focus the chat input. Confirm the video dock shrinks, the other person's audio continues, and the message input remains usable. Expand the dock again.
6. Toggle microphone and camera, then share a screen. Check the other browser receives the changes.
7. As creator, require admission. Leave and rejoin from the second browser. Confirm it waits for admission. Admit it, make it a co-host, then test mute and remove controls.
8. Let a five-minute test room expire. Confirm the call ends and new call joins are rejected while recovery remains read-only.
