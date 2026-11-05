# Entrance selection and loading correction

Refreshing sign-in previously displayed the original Waterfront artwork while the selected video loaded. A cold authenticated entrance also ignored the saved selection. Both pages now load one public preferences-only helper before rendering. It selects the scene and its matching first-frame poster before styles paint. Sign-in reuses the same video through authentication; the authenticated welcome uses that same selection on a cold load.

All existing MP4 files remain byte-for-byte unchanged. JPEG posters were extracted from their first frames. The new public routes allow only the enumerated decorative posters and preferences script; private application assets and APIs retain authentication.

The sign-in card has no outer fill, blur or shadow. Inputs and the button retain faint translucent fills, visible borders and focus outlines. Oceanfront moves to the lower pool, Fontainebleau to the left and Moonlit Forest lower over the water. Other scene anchors remain unchanged.

## Controls

- Automatic: Waterfront follows local time (06:00 morning, 11:00 midday, 17:00 evening, 21:00 night).
- Choose a scene: Use saves a fixed scene for subsequent sign-ins.
- Favorite: include/exclude a scene in the rotation pool without changing playback mode.
- Rotate favorites: select from that pool on a new entrance. With at least two favorites, exclude the previous favorite. An empty pool falls back to Waterfront.
- Preview: play a sample without changing selection.
- Preferences remain browser/device-local. A different Preview hostname has separate browser storage.

## Verification

85 targeted tests passed, zero failed/skipped, including delayed MP4 loading, repeated refreshes, fixed-scene changes, cold app initialization, authentication handoff, logout, no immediate favorite repeats, tablet/phone bounds, poster routing, auth and Calendar regressions. Local visual inspection covered Oceanfront, Fontainebleau and Moonlit Forest at tablet dimensions.

The broader suite was not green: Attention and Customer Activity browser fixture failures also reproduce at the unchanged b09b804 checkpoint. These unrelated application areas were left untouched. Physical-device and hosted acceptance of the new revision remain separate checks.

The original Waterfront clips are five-second 1280×720 videos. Removing the artificial poster blur does not increase their source resolution or repair their original loop seams. No media was rerendered and no credits were purchased.
