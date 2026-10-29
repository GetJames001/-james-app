# Briefing calendar quick access and midnight theme

Adds a compact month calendar next to Next appointment at desktop/iPad landscape widths, stacked on narrower screens. Today is outlined; dots represent received timed/all-day events. Selecting a day opens the existing read-only Appointments view. Today, Tomorrow and 7 days shortcuts are directly accessible from Briefing. Month navigation remains within the existing today-through-88-days coverage, with out-of-range dates disabled. Cached dots remain visible after failed reads with explicit stale status; unknown empty days are not described as verified free time.

The seven-day agenda now groups each date inside its own section, with a weekday/full-date header, border and spacing. The existing today-only briefing remains unchanged in meaning. The approved midnight navy/gold palette is applied to the live UI, with a muted slate calendar surface and readable controls/panels.

No provider selections, OAuth permissions, event mutations, Mail logic, tasks, Redis, credentials or gateway changes. Uses existing served assets only. Browser checks cover quick navigation, day grouping, event dots, failed refresh preservation and phone/tablet/desktop containment.
