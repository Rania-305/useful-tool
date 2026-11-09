# PRD — F1 Driver Comparison Tool

## Goal
Let an F1 fan compare the race pace of multiple drivers within a single 2025 Grand Prix, using only real OpenF1 data, as a single static `index.html` with no backend.

## Audience and key action
**Audience:** an F1 fan (new or longtime) who wants to compare drivers' pace within one race, without digging through raw timing data.

**Key action (end to end):** pick a 2025 Grand Prix race session → pick 2–6 drivers → see their average race lap time for that session, ranked side by side.

## Features (version 1)
1. **Race picker** — dropdown of 2025 meetings (Grand Prix weekends), populated from OpenF1 `/meetings`. Selecting one loads that meeting's `Race` session via `/sessions`.
2. **Driver picker** — checkbox list of drivers who took part in the selected race session, populated from `/drivers?session_key=...`. User selects 2–6 drivers.
3. **Compare action** — a "Compare" button/step that validates the selection and triggers the lap-time fetch and calculation.
4. **Ranked comparison view** — side-by-side cards or table showing each selected driver's average race lap time for that session, sorted fastest to slowest.
5. **Decorative track/car graphic** — a CSS/SVG track with pixel-car icons whose animation reflects the current UI state (idle, driving, crashed) per the States section below.

## Content and data (have / missing / from whom)
| Item | Status | From whom |
|---|---|---|
| Meetings list for 2025 (`/meetings`) | Have — live from OpenF1 | OpenF1 API |
| Race sessions per meeting (`/sessions`, `session_type=Race`) | Have — live from OpenF1 | OpenF1 API |
| Drivers per session (`/drivers?session_key=...`): `driver_number`, `full_name`, `team_name` | Have — live from OpenF1 | OpenF1 API |
| Lap times per driver per session (`/laps`), excluding `is_pit_out_lap: true` | Have — live from OpenF1 | OpenF1 API |
| Exact course due date | **Missing** — recorded as 11/8/2026, which is already past relative to today (11/9/2026); confirmed by student as correct but needs re-verification | Student |
| Pixel car/track art assets | **Missing** — no asset source chosen yet | Student to provide or confirm hand-drawn/CSS-only approach |

No driver stats, lap times, or results are invented; all computed values (average lap time) are derived only from `/laps` responses for the selected race session.

## Look
Visual direction (colors, fonts, motion, effects) is defined in [DESIGN.md](DESIGN.md) — do not restate those values here; follow that file as the single source of truth.

## States
Per the UI Stack model, the states this page can actually reach are:

- **Empty** — no race selected yet. Show the track graphic with cars idle/parked, and the race picker as the only active control.
- **Loading** — a request to OpenF1 (meetings, sessions, drivers, or laps) is in flight. Show the track graphic with cars driving/animating, and disable selection controls until the response resolves.
- **Error** — an OpenF1 request fails or returns an unexpected shape (e.g., network error, non-200 response). Show the HTTP status/error type plus a crashed-racecar graphic, and let the user retry.
- **Partial** — a race is selected and drivers/laps are loading or only some selected drivers have lap data available (e.g., a driver retired early and has fewer valid laps). Show the comparison view with available drivers/laps and a note on which are incomplete, rather than blocking the whole view.
- *(Ideal state is the standard "race + 2–6 drivers selected, laps loaded, ranked comparison shown" result — not separately listed since it's the default successful render covered by the Features section.)*

**Invalid Input** (not one of the five Stack states, but required by this project): triggered when the user clicks "Compare" with no race session selected, or fewer than 2 drivers selected. Shows inline text (e.g., "Select a race and at least 2 drivers") rather than running the comparison.

## Checks
A user must be able to:
1. Select a 2025 Grand Prix race from the dropdown and see its drivers load.
2. Select between 2 and 6 drivers and click Compare to see a ranked average-lap-time comparison.
3. Click Compare with no race or fewer than 2 drivers selected and see the Invalid Input message instead of a broken view.
4. See a clear error state (with status/type) if an OpenF1 request fails, instead of a blank or stuck page.
5. See lap times that visibly exclude pit in/out laps (i.e., averages are not skewed by obviously slow pit laps).

## Out of scope
- Typed/free-text search for races or drivers (selection is dropdown/checkbox only).
- Season-wide or multi-race aggregated stats (all calculations are scoped to one race session).
- Practice, Qualifying, and Sprint session lap times (only the Race session is used).
- Real car telemetry/position data driving the track graphic (it is decorative/state-driven only).
- Any backend, database, authentication, or payment flow.

## Later
- Support seasons other than 2025.
- Include Qualifying/Sprint sessions as additional comparison modes.
- Onboarding/explainer content for fans new to F1 terminology.
- Live/real-time telemetry-driven car positions on the track graphic.
- Saving or sharing a specific comparison (e.g., via URL state).
