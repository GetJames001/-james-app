# James voice and wake integration — 13 November 2026

## Ownership and pinned base

Integration owner: NEW BUILDER 7. Dedicated branch `work/voice-wake-20261113`, based on accepted integration commit `4012695b5cdde4b5801f4d451d7ae2aefa3b40cd`. Owned files: `voice-session.js`, `wake-listener.js`, `wall-display.js`, voice route, narrowly scoped voice dialog CSS, associated tests and this document/workflow. No edits to PR90 TaskPad, PR91 background transport, Calendar, Mail, entrance scenes or separate Wardrobe source. Local recovery ancestry is synthetic; publish using the real remote base tree/parent.

## Requested experience and candidates

Michael's current brief is a warm, intelligent adult male, light refined British accent, comfortable middle register, natural pacing and occasional understated dry humour. This supersedes the old female-default request. Preserve his explicitly saved voice choice while offering Cedar in the existing voice selector. The existing Realtime service now receives the requested delivery instructions. Cedar is a practical first audition using the existing provider, not a verified acoustic match. No new provider/key/account, model migration, paid generation or live microphone test was performed to produce this candidate. The current five-minute limit remains visible.

| Candidate | Current evidence | Status |
| --- | --- | --- |
| Cedar with James's British delivery instructions | Already allowlisted in the existing OpenAI voice transport; can be selected without another integration | Available for audition; no listening acceptance claimed |
| ElevenLabs Archer | Official conversational voice guide describes a friendly British male; lists `L0Dsvb3SLTyegXwtm47J` | Best described match found; not connected or auditioned |
| Earlier Archer Conversational | Older handoff ID `Fahco4VZzobUeiPqni1S`; provider's public voice-library page still names Archer Conversational | Do not silently equate IDs or claim this is the same voice as current guide |
| Adrian Distinguished Gentlemen | Earlier handoff ID `v0RCLiw9p8Dhrblmk4YL` | Current official availability and sample not verified; not connected |

Use the same fictional concierge script for comparable auditions, then test an interrupted two-way exchange. A written style instruction does not establish the voice's actual accent, timbre, naturalness or interruption quality. Any ElevenLabs integration requires confirming exact voice availability and costs before activating it. An original designed voice remains an option; do not claim an actor/character clone.

Official references checked 13 November 2026:
- https://elevenlabs.io/docs/eleven-agents/customization/voice/best-practices/conversational-voice-design
- https://elevenlabs.io/voice-library/podcast
- https://developers.openai.com/api/docs/guides/voice-prompting
- https://www.openai.fm/

## Wake behavior

The existing local-only `Hey James` recognition path was already wired to ambient wall mode. This change makes it available in regular James from Voice settings, sharing the same listener and microphone handoff. It stays default-off; an old wall-only opt-in does not enable regular-mode listening. Saved regular-mode opt-in restores only when microphone permission is already granted. The UI gives enable, off, local speech-pack installation and actual status. Unsupported browsers keep tap-to-talk and external `#talk-to-james` entry.

No pre-wake room audio is sent to a cloud recognizer. Recognition must confirm `processLocally: true`. The local microphone must report release before a voice session starts. Wake listening pauses while voice owns the microphone or settings are open, and stops when the page is hidden/unloaded. Ending the shared conversation disables the current mode's wake preference. Returning to a visible page can resume previously enabled listening without requesting permission again. A cancelled or replaced wake handoff cannot start a delayed voice session.

Say “Hey James”, wait for the voice connection, then speak the request. The current local recognizer does not retain a command spoken with the wake phrase. The requested universal mobile/locked-screen wake experience is **not established** by this change. Availability is detected at runtime; do not infer local support merely from the presence of `webkitSpeechRecognition`. Browser and OS sleep still apply. The previous accepted external-launch journey is preserved.

- https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally
- https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/SpeechRecognition.json
- https://picovoice.ai/docs/quick-start/porcupine-web/ — possible cross-browser local keyword engine, requires provider account/access key and a suitable custom model; not activated.

## Validation and remaining proof

Local route/listener tests: 11 passed, zero failed. New actual-Chromium integration fixture covers opt-in, saved voice retention, regular-mode wake, microphone release, hidden/visible resume, explicit off, unsupported recognition and conversation-end cleanup, using synthetic microphone/provider calls only. Existing wall/voice browser tests remain in the full CI workflow. Local Chromium installation failed because the downloaded archive was empty/invalid; do not label these browser tests passed until hosted CI completes.

Still pending: exact hosted deployment/commit verification; live listening comparison; real-device wake availability and reliability; interruption/latency review; mobile/closed-app wake implementation. Neither local nor synthetic browser tests prove audio quality or physical-device behavior. This draft is not merged or promoted to production.
