# Design

## Tokens

### Colors
| Token | Value | Used for |
|---|---|---|
| `--bg-track` | `#0d0d0d` | Page background — near-black, like a track at night, sets the retro arcade mood |
| `--bg-panel` | `#161616` | Cards, the comparison table, and dropdown panels sitting on top of the background |
| `--border-flag` | `#2b2b2b` | Hairline borders between panels and table rows |
| `--accent-red` | `#e10600` | Primary action (Compare button), active/selected states, error text and the crash graphic |
| `--accent-yellow` | `#f6c90e` | Hover and focus states — the "caution flag" color, also used on loading accents |
| `--accent-green` | `#17c964` | Valid input confirmation and the "in use" status dot |
| `--text-primary` | `#f5f5f5` | Headings and primary body text |
| `--text-muted` | `#9a9a9a` | Secondary text, placeholder copy, captions |
| `--checkered-black` / `--checkered-white` | `#000000` / `#ffffff` | The checkered-flag pattern used on section dividers and page transitions |

### Typography
- Headings: a pixel/arcade display font (e.g. "Press Start 2P") — reinforces the retro racing-game vibe, used sparingly (titles only, not body copy, to stay readable).
- Body and data (lap times, tables): a monospace font — reads like a timing readout.

### Spacing & Motion
- Spacing scale: `4px / 8px / 16px / 24px / 32px / 48px`.
- Transitions: `200ms ease` for hovers, `400ms ease` for page/section transitions, using a checkered-flag wipe rather than a plain fade.
- A small pixelated race car animates across the hero area on load and during the loading state — this is the one place motion is always present; elsewhere motion is limited to transitions so the page doesn't feel busy.

## Design Direction
- This tool should be visually stunning and use dark elements to give a retro racing game vibe:
    - Use of pixelated race car graphics is a must
    - Some motion on screen with the cars
    - Clean transitions between pages and the use of checkered racing flags
- My own rule: nothing should look like generic AI-slop. Every graphic and transition must earn its place, and the page must stay easy to navigate even with the retro styling.

## Overview
This page is for F1 fans — myself included — who want to compare drivers' race-by-race performance without digging through raw timing data. In the first five seconds, a visitor needs to see: (1) what the tool does — compare F1 drivers' lap times side by side — (2) that they must pick a Grand Prix to start, and (3) enough of the retro racing look (dark background, pixel car, checkered accents) to trust this is a focused racing tool rather than a generic form.

## Layout
What a visitor sees, top to bottom:

1. **First — Header/hero.** Page title and one-line description, a small pixel race car animating across the strip, and a checkered-flag divider underneath. This is the "visually stunning" first impression and confirms the page's purpose immediately.
2. **Second — Controls bar.** Grand Prix selector, driver search/filter field, and the Compare button, laid out in a row. This is what the visitor interacts with before anything else can happen.
3. **Third — Comparison panel.** The computed average-lap-time comparison table for the selected race, or the empty/loading/error graphic in that same space when there's nothing to show yet.

A footer with the OpenF1 attribution link sits below the comparison panel.

**On a phone,** everything stacks into a single column, full width: hero first (pixel car animation shrinks and slows to keep it smooth), then the controls stacked vertically in order (race selector, driver search, Compare button, each full-width for easy tapping), then the comparison panel below. The comparison table scrolls horizontally rather than shrinking its text unreadably small.

## Components
One entry per state (Empty, Loading, Error, Invalid Input, In Use), per the PRD.

### Buttons
**Compare button**
- Empty: disabled/dimmed, label "Compare" — nothing to compare until a race is picked.
- Loading: label becomes "Loading…", disabled, small spinner replaces the icon.
- Error: label "Try Again", `--accent-red` border, enabled.
- Invalid Input: disabled, border flashes `--accent-red` once to draw the eye to the bad field.
- In Use: label "Compare", enabled, `--accent-yellow` on hover/focus.

**Clear/Reset button**
- Empty: disabled — nothing to clear.
- Loading: disabled — don't let the user change inputs mid-fetch.
- Error: enabled, lets the user reset and start over.
- Invalid Input: enabled, clears the bad value back to its placeholder.
- In Use: enabled, clears the current comparison back to the empty state.

### Links
**"Data by OpenF1" footer link**
- Present and identical across all five states — it's static, always points to the OpenF1 site, `--accent-yellow` on hover.

**Driver row link (opens driver detail)**
- Empty / Loading / Error / Invalid Input: not rendered — there's no data to link to yet.
- In Use: each driver row in the comparison table links/expands to that driver's lap-by-lap detail.

### Form fields
**Grand Prix selector (dropdown)**
- Empty: shows placeholder "Select a Grand Prix", empty track graphic visible behind it.
- Loading: disabled while the race list loads, shows a shimmer placeholder.
- Error: `--accent-red` outline, error icon, helper text "Couldn't load races."
- Invalid Input: not applicable — the dropdown only offers valid races, so it can't be invalid.
- In Use: shows the selected race name, enabled.

**Driver search/filter field**
- Empty: placeholder text "Search drivers…", disabled until a race is selected.
- Loading: disabled, spinner at the right edge.
- Error: `--accent-red` outline, disabled.
- Invalid Input: `--accent-red` outline, inline message "No driver matches that name."
- In Use: enabled, matched drivers shown as removable chips.

### Messages
- Empty: empty race track graphic with caption "Select a Grand Prix to begin."
- Loading: looping pixel car animation with caption "Fetching lap data…"
- Error: crashed pixel race car graphic with caption showing the error code/type, e.g. "404 — couldn't reach OpenF1."
- Invalid Input: small inline `--accent-red` text reading "Input invalid" next to the offending field.
- In Use: no blocking message — a small caption above the table reads "Showing average lap times for [Grand Prix name]."