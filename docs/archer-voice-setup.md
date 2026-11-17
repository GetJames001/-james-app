# Archer voice connection

Michael selected Archer – Conversational, voice ID `Fahco4VZzobUeiPqni1S`.

The existing authenticated WebRTC session, manual turn coordinator and James tools continue to handle input, navigation and recipe guidance. Archer requests text output from that session and speaks the final answer through the server-only ElevenLabs endpoint. It does not play a different voice silently when Archer is unavailable. Interrupted or ended turns discard late audio.

Activation is not complete. No speech generation, subscription, purchase or new paid call was made during implementation. The current Vercel connector returned no James project for either default scope or James team `team_lVrzYRomAyAMMK3W3Rf0WWhl`, so its environment could not be verified or edited.

After access and additional usage approval:

1. Configure `ELEVENLABS_API_KEY` as a sensitive Preview-only variable, scoped to `fix/calendar-refresh-diagnosis-20261031`. Do not paste secrets into chat or source.
2. Set `JAMES_ARCHER_ENABLED=true` on that Preview only and deploy the same branch.
3. Verify authenticated GET `/api/james/speech` reports ready. This verifies configuration presence, not provider credentials or voice entitlement.
4. Select Archer in James Voice Settings and test one complete spoken navigation response on iPad, then interruptions on Android. Confirm the voice entitlement with an actual authorized request.

Model: `eleven_flash_v2_5`; output: `mp3_44100_128`. Official ElevenLabs API pricing reviewed November 17, 2026 lists Flash/Turbo at $0.04 per 1,000 characters. Account terms and voice access must be verified before activation. Existing OpenAI input/reasoning usage remains. Reference: https://elevenlabs.io/pricing/api and https://elevenlabs.io/docs/api-reference/text-to-speech/stream

The Wardrobe header fix is independently deployed to the existing private Wardrobe site, source commit `58e68a1fc9fcd634626ebe8b3459134af17de86d`: Back to James replaces AARU Home, Working preview removed, direct entry/refresh opens Wardrobe, retired dashboard no longer displayed. Closet storage and lookbook are unchanged. 96 automated checks passed; the legacy inspiration browser check was blocked by an unavailable Chromium executable.
