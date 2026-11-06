# Voice device test follow-up — November 5, 2026

Michael reported successful natural voice conversations while auditioning voices, interruptions triggered by background sound, and then failure to reconnect. This is the first user-reported live voice acceptance evidence; it does not establish every voice or tool passed.

Vercel Request Logs inspected read-only in the existing browser: ten POST /api/james/voice requests in the visible 30-minute window returned HTTP 200, most recently November 5 at 4:01:23 p.m. Pacific. No HTTP quota or authentication rejection was visible in those filtered requests. A successful SDP response does not prove WebRTC/audio playback succeeded or rule out an in-session provider limit. The exact failing message on Michael's device is still needed to distinguish local device/transport, session limit, and provider error. Do not assert billing exhaustion or buy credits based on this report.

Changes: enable documented far-field input noise reduction before VAD/model processing while retaining semantic VAD and current turn coordinator. This is a tuning candidate, not proof that background voices will be rejected. Keep browser echo cancellation and noise suppression. Preserve immediate intentional voice interruption and Stop reply.

Classify allowlisted provider quota/spend-limit codes separately from rate limiting; unknown 429 remains ambiguous. Provider response bodies, keys, SDP and transcripts are not logged. Only sanitized status/category is logged for failed session creation. In-session provider errors retain a useful billing/rate-limit message when coordinator-driven teardown closes the transport. No automatic retries or purchases.

Ten focused checks passed covering authentication, scope validation, provider failure classification, no provider detail leakage, login script policy, browser turn correlation/End, quota event cleanup, and microphone errors. Real noisy-room performance and the reported reconnect failure remain device acceptance gates. Production, accepted entrance, Calendar configuration and credentials untouched.
