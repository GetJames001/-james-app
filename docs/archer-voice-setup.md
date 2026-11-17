# Archer voice connection

Michael selected Archer – Conversational, voice ID `Fahco4VZzobUeiPqni1S`.

The authenticated OpenAI WebRTC session and James tools handle input, navigation and saved-recipe guidance. Archer uses text-only responses and the server-only ElevenLabs speech endpoint. Interrupted or ended turns discard late audio; unavailable Archer never silently switches voices.

## Verified November 17, 2026

- Combined Preview code: `d4846ef543d80eefc943d09a97bee3288c732ed8`.
- Vercel James Preview deployment succeeded: https://vercel.com/james-cb7a/james-app/FoTCtEdztn6iTmJRxXZhS1HtXnwG
- Full CI run 44157019316: 566 passed, 0 failed, 1 skipped. Audit and public cookbook-source verification passed. Includes navigation continuation audio and Archer lifecycle browser checks.
- ElevenLabs authenticated account is on Free. Archer was added to My Voices.
- A restricted key named James Preview Archer Speech was created: text-to-speech access only, 10,000-credit per-period cap, auto-disable-if-leaked enabled.
- Credential securely stored as Secret `ELEVENLABS_API_KEY`, solely for Preview branch `fix/calendar-refresh-diagnosis-20261031`. No production variables changed.
- `JAMES_ARCHER_ENABLED` was NOT saved. Archer is not active or selected on Michael's devices. No actual provider speech request or subscription purchase occurred.
- The environment credential was added after the deployment above. Redeploy after activation to pick up environment changes.

## Exact remaining blocker

ElevenLabs documentation says Voice Library voices cannot be used through the API on Free, even when website previews work:
https://elevenlabs.io/docs/overview/capabilities/voices

The signed-in monthly subscription screen offers Starter at $1 for the first month, then $6/month (taxes excluded). Michael subsequently approved a one-month trial with a renewal reminder, then asked to pause plan selection for a voice-quality and value review. Purchase remains paused pending that review and choice. Do not treat the earlier approval as an instruction to complete checkout now. Current key cap is deliberately conservative and should be reviewed before sustained daily use.

## After subscription approval and account upgrade

1. Set `JAMES_ARCHER_ENABLED=true` only for the combined Preview branch and redeploy it.
2. Verify authenticated GET `/api/james/speech` reports ready. This is configuration presence, not provider entitlement.
3. Verify an actual short Archer request succeeds, then select Archer in James Voice Settings.
4. Give Michael one focused iPad check: say “open recipes” and confirm the complete spoken response continues after navigation. Android interruption check follows separately.

Model: `eleven_flash_v2_5`; output: `mp3_44100_128`. Account/API pricing shows $0.04 per 1,000 Flash/Turbo characters. Existing OpenAI input/reasoning usage remains.

Wardrobe header fix remains independently deployed to the private Wardrobe site, source `58e68a1fc9fcd634626ebe8b3459134af17de86d`: Back to James replaces AARU Home, Working preview removed, direct entry/refresh opens Wardrobe. Closet data and lookbook preserved. 96 checks passed; legacy inspiration browser check unavailable due to missing local Chromium.

## Voice-quality review

The November 17 review and next implementation gates are recorded in [voice-delivery-decision-20261117.md](voice-delivery-decision-20261117.md). Current speech is fully buffered, not end-to-end streaming. Model auditions and live voice quality remain unverified. The recommendation preserves James's existing conversation/tools while improving speech delivery; it does not activate Archer or a new model.
