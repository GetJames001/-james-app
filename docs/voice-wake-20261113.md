# James voice and wake integration — 13 November 2026

## Readiness and candidate-specific security continuation

Prior exact98f366b296326afd9bc9afa0cd090f5ff0261f0a passed 521total/520passed/0failed/1protected-test skip in actual Chromium/WebKit/Redis CI43519233657/job132208987995, audit0. Ready Preview was https://james-83rivyqk8-james-cb7a.vercel.app/ (DSghPc2w3Te6Wfia2KsTaSegYdPL). Earlier2d4e7b passed direct model recognition but timed out on Chromium's live AudioWorklet fixture; its cause was not established by the later successful run.

The current increment waits for a real silent decode acknowledgement before requesting the microphone. Startup could previously precede decoder readiness, and overflow silently dropped chunks. A maximum half-second queue now absorbs brief scheduling delays, preserves order and pauses with retry on sustained overflow. Two chunks remain the maximum in flight; a three-second decode stall and ten-second startup/resume deadline stop capture. Off cancels startup and clears all pending audio. This removes concrete timing/lifecycle weaknesses; it does not retrospectively prove the exact cause of the earlier fixture timeout. CI adds three consecutive real audio journeys per browser after the full suite.

The old protected workflow targets another release branch and cannot certify PR92. The new voice-preview-security workflow requires owner re-run, exact PR92/base4012695/branch/head approval, current PR metadata and Vercel-authored successful deployment mapping. Its sole temporary repository variable is JAMES_VOICE_REVIEW, a JSON object with pr:92, full head, deploymentId and immutableUrl taken together from the signed-in deployment dashboard. It preserves the older approval variables and encrypted JAMES_VERCEL_AUTOMATION_BYPASS secret. No secret reaches ordinary CI; the narrowly authorized probe checks immutable and branch hosts, private scripts/APIs, static prefix boundaries and separate login/worker policies. Remove the temporary variable immediately after verification. Never print or copy the encrypted bypass credential. This authorizes only read-only unauthenticated application-gateway probes, not account access, microphone capture, voice spending or deployment promotion. Results for the new exact head must be recorded in PR92 and the master checklist after they actually run.

The first hosted gate on ccfe0a29ffcb57afe90a0764baf58b708fdde7c0 reached the application and verified the first host's static/voice protections, then caught an inherited test mismatch: logout clearing cookies are SameSite=Strict in lib/auth.js and its existing unit tests, while the older deployed probe expected Lax. Only that probe assertion is corrected to Strict; cookie behavior and authentication are unchanged. The initial gate is retained as4passed/1failed/0skipped, not a security pass.

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

Exactly six immutable, non-sensitive licensed assets are served statically, so the approximately 40 MB model does not pass through a serverless response. Application scripts, APIs and account data still require the gateway. Production is not changed. The model/runtime downloads occur only during build and user opt-in, not initial app navigation. Generated binaries are reproducible and excluded from git; the build verifies original npm SHA512 and model ZIP SHA256. LICENSE/NOTICE and the original model README are retained.

Local targeted checks: 16 passed, zero failed. Chromium exists locally but the workspace denies its process socket, so actual-browser validation is assigned to CI. New tests use the real WASM/model with locally generated eSpeak synthetic speech, comparison phrases, and a synthetic MediaStream through the actual AudioWorklet. No real microphone or paid speech generation is used. Chromium and WebKit results, Ready deployment and physical-device acceptance must be recorded separately after they actually pass. Synthetic voices cannot establish Michael's accent/noise/latency/false-wake acceptance. Candidate-specific hosted security remains required before release.


Post-login follow-up: the new adapter must also be in the existing login script allowlist. The immutable vendor worker is extracted from the pinned npm bundle and the wrapper points to that same-origin file. Only that worker asset response permits its legacy generated-code runtime; the login document continues to reject JavaScript eval, Blob workers and external script origins. Its CSP adds same-origin workers so an authenticated handoff can start local wake without reloading the accepted entrance. Browser fixtures now exercise the retained login CSP, not an unrestricted blank page.

Initial mobile CI (0895835) verified all four synthetic acoustic comparisons in Chromium and WebKit, then failed the request-origin assertion because the embedded worker/WASM uses local Blob/data URLs. Two existing checks also caught the missing login loader entry and the intentional static asset exception. Those checks are corrected/extended without removing application authentication assertions. The initial hosted build lacked a public output directory; 643de026bc8e96eb7e74d5d72dc48ee9f3fff566 fixed asset output and reached Ready. Neither intermediate candidate is accepted or merged. Current-head results are still required.


Timing follow-up: ccfe0a2 passed the full525-check suite and three consecutive real audio journeys in each browser. The next test-only head ede091d reproduced a WebKit synthetic wake timeout after reaching listening, without overload/error. The fixture had begun playing inside getUserMedia, before the adapter had connected the stream; its arbitrary one-second lead-in did not bind speech to readiness. The revised fixture emits its single utterance only after the real listening cue, captures synthetic-only frame/result diagnostics, and keeps the same real model, confidence threshold, AudioWorklet and release assertions. There is no looping speech or retry that could conceal a miss. Await exact-head CI before claiming stability. This is a fixture timing correction; physical-device acoustics remain unverified.


The a2cc2e8 full suite passed525/0/1 and its exact hosted gate passed5/0/0; the three-journey repetition caught a WebKit result with exact text “hey james” but confidence0.701678 for “james,” below the unchanged0.8 minimum. The listener correctly did not wake; this was not a stuck decoder. Diagnostics showed continuous frames and one fewer non-silent chunk. The synthetic microphone had bridged two independently running AudioContexts. The next fixture creates its MediaStream source on the actual capture context clock to remove that artificial clock/resampling boundary. It still exercises the real MediaStream, AudioWorklet, WASM model and production threshold; no production confidence limit was relaxed. Repeat results remain required. Do not claim that this explains or eliminates real physical-device false negatives.
