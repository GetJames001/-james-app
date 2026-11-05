# James voice foundation — Builder 5, November 5, 2026

Status: isolated working draft. Not live-audio or device acceptance. Production and the accepted Calendar/entrance preview remain at `7573bdd46547784ca1835bad51591ba610ebb558`.

## Recovered decisions

- One James owns the conversation across pages. Wardrobe, Workbench, work, finance, health and growth are capabilities, not new assistant personalities.
- October 12: intentional continuous conversation and a quick wake mode; clear active/off states, interruption and explicit stop. Browser background wake-word support was not proven.
- September concierge/wingman direction and October J23: direct, natural, useful conversation with light humor. No fabricated memory or completed actions.
- Current instruction: preserve the accepted entrance; speak in Daily Briefing, review the actual day, then ask the departure point when travel is relevant. Read the full briefing on request. Ordinary questions include Raiders times, a date's appointments and travel to Spago. A calendar update is only complete after provider confirmation.
- Current voice preference: feminine starting point, multiple auditions; no final voice selected. The draft starts with Marin and offers all ten currently documented Realtime voices. The linked OpenAI.fm audition demo also contains TTS-only voices; Fable, Nova and Onyx are not choices for this Realtime adapter.
- Preserve the existing orb artwork, breathing/halo treatment and listening glow. Exact earlier approval of thinking/rotation choreography was not recovered; the new thinking and speaking distinctions are implementation proposals, not recovered historical approvals.

Sources read: `James_New_Lead_Full_Recovery_2026-10-31.txt` (Library `libfile_5868bb513e188191995e6422ebcc8a08`), `james_backlog_roadmap(2).md` (`libfile_6eda6f2cdf988191b9c9ff46b1311655`), `James_Historical_Architecture_Decision_Audit_2026-10-20.md` (`libfile_598606f879708191bd0094546738f905`), `James_Audio_Correction_Independent_184_Check_Recheck_2026-10-19.txt` (`libfile_83f2a84a16ec819183098505fa19b682`), and retrieved October 12 conversation context. Full original orb-design transcripts remain incomplete.

## Source reuse and plumbing

Recovered the exact corrected source package `James_Typed_Voice_Audio_Corrected_184_Checks_Full_Source.txt`, Library `libfile_9170b70257488191bb39652ad93480d5`. Verified TXT SHA256 `31aa08ae941a0328515aa65f25482b0ce2ed511a9dc1ee02ee8b165f526c6864`, embedded ZIP SHA256 `05a6659415f12fddf02c0f3364cd9004e31bfb14d9af9e038507f4a7332079ae`, ZIP integrity and extraction paths.

Reused `realtime-coordinator.mjs` and `turn-timing.mjs` byte-for-byte. Recovered coordinator regressions change only the import path. This retains host-owned account/conversation/generation, committed audio-item IDs, response/request metadata correlation, duplicate/stale response rejection, cancellation, End and guarded tool continuation. Muting/unmuting follows accepted events; stale creation must not alter current playback.

The draft replaces the orb's fabricated route script and single-shot browser dictation with an opt-in WebRTC session. Browser mic permission is requested only by a user action. The authenticated, same-origin `/api/james/voice` route verifies the current server conversation before exchanging SDP using the existing server-side `OPENAI_API_KEY`. It never returns that key. `JAMES_VOICE_MODEL` is an optional override, defaulting to the currently documented `gpt-realtime-2.1`; no environment variables or credentials changed.

Voice uses the existing host identity and history. Typed turns remain on the existing Fast/Council backend and are passed as context to active voice. Voice research delegates to that backend. Business-scoped database answers are displayed in their existing workspace and are not copied into the voice session. Current conversation recovery is browser-session scoped, not durable narrative memory across devices.

Tools are limited to read_briefing, read_calendar, ask_james and open_page. No arbitrary provider tool, send, purchase, delete or calendar-write operation is exposed. Navigation retains the connection. End/sign-out/pagehide/background stop it; five-minute session and inactivity limits bound use. The panel states that OpenAI usage is separate from Vercel.

Calendar queries refresh existing Google/Hotmail readers and disclose their separate source states. The existing Google range is approximately yesterday through 90 days ahead; outside-range dates are unverified. Date/weekday conflicts require clarification. Full briefing includes available calendar, tasks, perspective, weather and mail counts, with unavailable and truncation states; Attention has not been scanned by that tool.

## Verification and remaining gates

- Recovered source aggregate reproduced: 184 passing offline checks, no live provider calls.
- Current integrated focused suite: 103 passing checks after the final playback-order refinement. Covers conversation, provider errors, auth, Workbench navigation, calendar rendering, voice route and simulated browser media/navigation/End.
- No new production release, merge, credentials, paid media, deployment deletion or hardware purchase.
- Still required: actual model access and WebRTC negotiation, microphone/speaker audibility, pauses and interruption on iPad/Android/desktop; full brief completeness; selected date and current-fact lookup; voice audition; login-to-briefing playback permission and opt-in behavior. No claim that microphone operation or a hosted voice call has passed.
- Real traffic/travel estimates and calendar writing are absent in the current app. Inspect existing provider/account setup before proposing another service or expanded Google scopes. Present a route as a proposal until connected and verified.
- Wake word/locked-screen/background operation needs a device-specific native plan and real-device proof. Built-in microphone/speaker are sufficient to test foreground browser conversation; no hardware purchase is presently justified.

## Wardrobe and following priorities

Preserve closet originals, garment identity/colors/patterns, saved looks and inspiration; audit multi-item/video upload, duplicates, luxury editorial/ghost-mannequin output, Save/Swap/Remix/build-around, Undo/remove, closet-first styling, Pinterest/missing-piece shopping and outfit planning. The original AARU Working Review v171 source `29fddb9f6fe452f9bb8df6f1c7b0aef4fd69e257` is identified; its full Wardrobe bytes are not yet retrieved. Its old five-personality landing text is superseded, not a reason to erase domain work.

After voice and Wardrobe: durable cross-device conversation/project recovery; Customer Information and Files import/search/scale; Workbench close/resume; Attention and important-message follow-through; callbacks/carryover/end-of-day review; approved action workflows (drafts/forms/shopping/reservations); then room display/music/alarms and vehicle/native extensions. Preserve recently accepted functionality; audit each item before claiming it missing or rebuilding it.

Official references checked November 5: https://developers.openai.com/api/docs/guides/voice-webrtc?voice-api=realtime , https://developers.openai.com/api/docs/guides/realtime-conversations , https://developers.openai.com/api/reference/resources/realtime/client-events , https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia .
