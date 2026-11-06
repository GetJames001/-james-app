# Voice/orb follow-up

Continue the existing James voice implementation; preserve Marin, the current provider/model configuration, API credentials, Calendar, accepted entrance and tested mail updates. No ElevenLabs integration or additional provider is authorized by this change. Michael wants to listen to public samples and choose first; keep the existing voice selection unchanged.

## Fixes

The accepted orb artwork intentionally disables box-shadow and its pseudo-element halo. Existing listening/thinking rules depended on those disabled effects. Add phase-specific filter glows and restrained motion to the persistent in-app orb, without touching entrance imagery. Thinking rocks gently, speaking pulses, listening glows, connecting breathes and muted dims. These are phase animations, not a measured live audio waveform. Reduced-motion settings still disable animations.

Mute/unmute now updates the actual microphone state, orb phase and tooltip immediately. A brief WebRTC disconnected state receives an8-second recovery window on the existing peer; there is no new session/API retry. If connected returns, the orb resumes its phase; failed/closed or sustained disconnection closes and cleans up. Closing voice now clearly says voice is off and can be started again. Async event-handler failures are caught and clean up only the current session.

No VAD/noise-filter changes are made: far-field reduction, semantic VAD and existing host-owned interruption/correlation remain. Those filters do not establish speaker identity or guarantee rejection of background conversations. Five-minute limits, background/pagehide closure and End remain intact.

## Verification

21 voice-route/coordinator checks passed with synthetic provider responses. Browser test uses the real coordinator and CSS with synthetic media/WebRTC, and verifies listening/speaking styles, reduced motion, mute feedback, single-peer recovery after7 seconds, sustained8-second timeout cleanup, navigation continuity, stale-event rejection, End cleanup, quota messaging and microphone errors. No live audio generation, paid samples, secret access or provider configuration changes.

Real-device audition remains necessary for actual audio quality, room noise and interruption feel. Public ElevenLabs previews are for choosing potential future voices only; they are not installed in James and may require sign-in for full-library access.
