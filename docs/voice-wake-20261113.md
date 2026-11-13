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

Say “Hey James”, wait for the voice connection, then speak the request. The current local recognizer does not retain a command spoken with the wake phrase. The requested universal mobile/locked-screen wake experience is **not established** by this change. Availability is detected at runtime; do not infer local support merely from the presence of `webkitSpeechRecognition`. MDN currently lists local recognition as unavailable in Safari/iOS and Chrome Android, so this path alone is not the promised iPad/Android wake solution. Browser and OS sleep still apply. The previous accepted external-launch journey is preserved.

- https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally
- https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/SpeechRecognition.json
- https://picovoice.ai/docs/quick-start/porcupine-web/ — possible cross-browser local keyword engine, requires provider account/access key and a suitable custom model; not activated.

## Validation and remaining proof

Local route/listener tests: 11 passed, zero failed. New actual-Chromium integration fixture covers opt-in, saved voice retention, regular-mode wake, microphone release, hidden/visible resume, explicit off, unsupported recognition and conversation-end cleanup, using synthetic microphone/provider calls only. Existing wall/voice browser tests remain in the full CI workflow. Local Chromium installation failed because the downloaded archive was empty/invalid; do not label these browser tests passed until hosted CI completes.

Initial hosted run43503095294/job132153660881: 514 total, 512 passed, 1 failed, 1 protected-test skip. The failure was the new fixture missing UTF-8 response headers; existing voice and wall journeys passed. Fixture encoding and paused-setting state have been corrected; current-head CI is required. Initial 9b262f0 Preview was Ready at deployment GrjMHWZsdtcEWcv7WJjcUeTV8p7n; it reached James sign-in, not authenticated voice acceptance.

Still pending: current-head hosted deployment/commit verification; live listening comparison; real-device wake availability and reliability; interruption/latency review; mobile/closed-app wake implementation. Neither local nor synthetic browser tests prove audio quality or physical-device behavior. This draft is not merged or promoted to production.


## Mobile wake increment, 13 November (after 9ad70f2)

Previous exact head 9ad70f27d2ffa8edecd2614ffe10d27258c3e715 passed two full CI runs: 514 total / 513 passed / zero failed / one protected-test skip, audit zero. Ready Preview was https://james-158nokcjh-james-cb7a.vercel.app/ (5jyUqv5xdzGj3njcPeWZr6YBHkiK). This supersedes the earlier pending-CI paragraph above, but does not certify the new mobile increment.

The portable candidate uses vosk-browser 0.0.8 and the official small US-English Vosk 0.15 model, each integrity pinned at build time. Official model listing: https://alphacephei.com/vosk/models (40 MB, Apache 2.0; roughly 300 MB runtime memory typical for small models). This is a constrained offline recognizer, not a trained custom wake-word model. Sherpa-ONNX is another option, but its prebuilt path requires more packaging work; Picovoice requires a new provider account/licensing arrangement. Neither was activated.

Owned additions: mobile-wake-recognition.js, mobile-wake-worklet.js, wake-assets-build.cjs, licensed assets/wake/v1 notices, mobile tests/audio fixtures; narrow index.html script loading, gateway/app asset allowlists and vercel.json static asset routes/build command. Other PRs and accepted integration remain unchanged.

Native local recognition remains preferred. If it is unavailable and the browser supports secure WebAssembly, Worker, Web Audio and AudioWorklet, the portable path is available from the same explicit Enable Hey James control. First use downloads about 45 MB from this James deployment. Model bytes may be cached in browser storage; microphone audio and transcripts are not saved. A short local PCM buffer goes to the worker; only the exact confident Hey James result leaves the adapter. Unknown speech and several confusable alternatives are included in the restricted grammar. No cloud recognizer, voice provider request, new subscription or new credential is involved in wake detection. An actual conversation after wake still uses the existing service and pricing.

The worker and audio context are terminated on off/pause; a microphone permission response arriving late is stopped before release is acknowledged. At most two audio chunks may be in flight; a stalled decoder stops rather than accumulating audio. The existing release-before-voice, opt-in, visibility, cancellation and wall/regular controls apply. Safari may require another tap after returning; no mobile background, locked-screen or closed-app wake is promised.

Exactly five immutable, non-sensitive licensed assets are served statically, so the approximately 40 MB model does not pass through a serverless response. Application scripts, APIs and account data still require the gateway. Production is not changed. The model/runtime downloads occur only during build and user opt-in, not initial app navigation. Generated binaries are reproducible and excluded from git; the build verifies original npm SHA512 and model ZIP SHA256. LICENSE/NOTICE and the original model README are retained.

Local targeted checks: 16 passed, zero failed. Chromium exists locally but the workspace denies its process socket, so actual-browser validation is assigned to CI. New tests use the real WASM/model with locally generated eSpeak synthetic speech, comparison phrases, and a synthetic MediaStream through the actual AudioWorklet. No real microphone or paid speech generation is used. Chromium and WebKit results, Ready deployment and physical-device acceptance must be recorded separately after they actually pass. Synthetic voices cannot establish Michael's accent/noise/latency/false-wake acceptance. Candidate-specific hosted security remains required before release.
