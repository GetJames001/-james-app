# James voice decision and implementation gates — November 17, 2026

Status: research complete; recommendation prepared, not a listening-quality pass or provider activation. Michael requested study before choosing the monthly plan. Purchase remains paused.

Reviewed combined Preview head: b4524ed37d5ab34abf8a1c491486d361110af67e.
Read James_Master_Checklist.md version 160 (last modified November 16), then used current branch and Michael's newer instructions for voice scope.

## Recommended direction

Keep James's existing OpenAI conversation, authenticated tools and saved-recipe state. Improve the ElevenLabs speech-output adapter rather than migrate the assistant to ElevenAgents now. Retain Archer as the first audition candidate, compare Flash v2.5 against v4 Turbo, and choose the lowest paid tier that supports the verified voice and measured usage. Creator/Pro are not an automatic dialogue-quality upgrade.

This does not select a new model in deployed James. No live samples, new charges, subscription changes, production changes or device acceptance occurred during this review.

## Findings in current source

- lib/routes/voice.js already uses semantic_vad, eagerness auto, far_field noise reduction, and application-controlled response/interruption creation. Do not claim semantic turn detection is missing.
- lib/routes/speech.js fixes Archer to Fahco4VZzobUeiPqni1S and Flash v2.5. It requests a provider stream but reads every chunk into a Buffer before responding.
- voice-session.js waits for response.done, then response.blob(), then plays a new audio source. Both server and client currently buffer a complete utterance.
- Speech-start cancels the local reply. End/interrupt rejects late audio. Preserve these safeguards.
- Voice preference is stored in localStorage; selecting a voice on iPad does not prove it is selected on Android.
- Current key is documented as TTS-only with a 10,000-credit cap. Do not enlarge permissions or the cap as an incidental implementation step.
- Current source stops voice after five minutes and on backgrounding. Preserve existing bounded behavior while measuring; do not promise uninterrupted long cooking sessions or background listening.

## Voice and model choice

Archer is Michael's chosen identity, not a model name. Keep its exact ID; an ElevenLabs conversational guide lists another Archer ID, so name matching alone is unsafe. Adrian's exact earlier sample identity remains unresolved; do not install a guessed Adrian.

Candidate order:
1. Exact Archer on current Flash v2.5 as baseline.
2. Same Archer on v4 Turbo, subject to actual account/model/voice compatibility.
3. Exact Adrian only after recovering its voice ID and sample provenance.

Use identical short synthetic texts, speaker volume and playback device. Test navigation confirmation, a morning briefing, and recipe quantities (including fractions). Judge warmth, British accent, intelligibility and natural pauses. No claim of audible superiority until real comparison.

Provider model references:
https://elevenlabs.io/docs/overview/models
https://elevenlabs.io/docs/eleven-creative/playground/text-to-speech
https://elevenlabs.io/docs/eleven-agents/customization/voice/best-practices/conversational-voice-design

## Connection work

First remove full-audio buffering behind a Preview-only switch. Maintain authentication, CSRF, scope checks, bounded request size and server-only credentials. Play partial audio with a bounded queue; verify iPad browser support rather than assume an MP3 streaming implementation works everywhere. Abort provider work on cancellation/client disconnect, discard late chunks, and report stream errors honestly. Do not silently retry billable generation or switch voices.

Then evaluate incremental text delivery. Tool confirmations must follow successful tool results; never speak a preamble as though navigation or a save completed. Retain turn IDs and final-text/history reconciliation. Recipe instructions come only from the saved source; reading/playback must never auto-advance the recipe.

A model change is not just swapping a string on every transport. Flash uses the TTS WebSocket protocol; v4 Turbo uses the Text-to-Dialogue protocol for incremental text. Current TTS-only key permissions may not cover that endpoint. Inspect and report exact entitlement before changing permissions. Prefer the existing HTTP route for the initial audio-streaming increment if supported by the chosen model and browser playback.

https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/tts-vs-ttd-websockets
https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/latency-optimization

## Cost and alternative

Published monthly prices: Starter $6 (advertised $1 first month), Creator $22 ($11 first month), Pro $99, before tax. Verify checkout promotion. API page lists Flash and v4 Turbo at $0.04 per 1,000 characters, but Creative credits and API included-character tables differ; do not promise a usage allowance without account confirmation. Some library voices have legacy multipliers. Existing OpenAI input/reasoning remains separately billed.

Speech Engine can retain our own agent logic while replacing speech recognition, turn handling and playback. It requires a server WebSocket integration. Treat it as a separate measured prototype if the smaller change fails, not something a subscription automatically enables. Verify hosting fit and total costs before migration.

https://elevenlabs.io/pricing
https://elevenlabs.io/pricing/api
https://elevenlabs.io/docs/help-center/product/voices/voice-library/what-are-custom-rates-and-credit-multipliers
https://elevenlabs.io/docs/overview/capabilities/speech-engine/

## Verification gates

Automated tests for changed behavior:
- first audio plays before the final network chunk;
- interrupt before first audio and during playback stops queued/future audio;
- canceled turn cannot play after a new reply starts;
- navigation/tool continuation yields one complete confirmation;
- malformed, interrupted, forbidden and exhausted-quota responses remain usable and do not replay;
- recipe next/repeat/previous and ingredient questions preserve authoritative step state;
- model configuration cannot be selected arbitrarily by client input;
- browser fixture covers normal completion and autoplay denial.

Measure separately: speech end to final text, text to first provider audio, and first audio to audible playback. Record generation/usage metadata without private transcript logging. Provider marketing latency is not end-to-end James latency.

A scripted simulated stream is engineering evidence only. Actual authorized provider request, real listening and iPad/Android checks remain required after implementation and entitlement. Give Michael one focused iPad check first: open recipes, hear the complete reply, interrupt it, and resume. Android follows for microphone/noise behavior.

Next implementation: bounded streaming playback proof and regression tests, followed by actual voice/model audition once account access permits. Preserve approved screens and all working James tools.
