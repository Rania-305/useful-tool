# AGENTS.md

Instructions for any AI agent (or contributor) working on this project. Read this before making changes, and refer back to it whenever a decision isn't covered by [PRD.md](PRD.md), [DESIGN.md](DESIGN.md), or [PROPOSAL.md](PROPOSAL.md).

## Project Summary
A client-side tool (plain HTML/CSS/JS, single `index.html`) that compares F1 drivers' performance across Grand Prix races using the [OpenF1 API](https://openf1.org). Built for a Babson College course mini-project. See [PROPOSAL.md](PROPOSAL.md) for scope and [PRD.md](PRD.md) for required UI states (empty, loading, error, invalid input, in-use).

## Ethical Guidelines

These principles take priority over speed or convenience. If a request conflicts with them, flag the conflict instead of silently proceeding.

### 1. Academic Integrity
- This is coursework. Write code the student can explain and defend; avoid needlessly clever or obfuscated solutions that undermine learning.
- Do not fabricate data, API responses, or test results to make the tool look functional when it isn't.
- Keep comments and commit messages honest about what was actually implemented vs. stubbed/TODO.

### 2. Data Accuracy & Honesty
- Never invent driver stats, lap times, or race results. All figures must come from real OpenF1 API responses.
- Clearly distinguish computed values (e.g., averaged lap times) from raw API data in code and UI copy, per [PROPOSAL.md](PROPOSAL.md)'s requirement that calculations be scoped per-race, not season-wide.
- Surface API/data errors to the user truthfully (per the PRD's "Error" state) rather than hiding failures behind fake success states.

### 3. API Use & Respect for Third Parties
- Follow OpenF1's documented usage terms; do not attempt to bypass rate limits, scrape undocumented endpoints, or spoof request headers to evade throttling.
- Do not hardcode or commit API keys/secrets if the API ever requires them.
- Avoid excessive/parallel polling that could be mistaken for abuse of a free public API.

### 4. User Experience Integrity
- Handle invalid input and errors gracefully and transparently (per [PRD.md](PRD.md)) — no silent failures or misleading placeholder content left in a "finished" build.
- Don't add dark patterns (fake urgency, hidden data collection, tracking) — this is a hobbyist/fan tool, not a commercial product.

### 5. Security Basics
- Sanitize any user input before using it in DOM insertion (avoid `innerHTML` with unsanitized strings) to prevent XSS, since this is a static client-side page with no backend to rely on.
- Don't introduce external scripts/CDNs beyond what's necessary, and prefer reputable, pinned sources.

### 6. Transparency with the User (Student)
- If a requested change conflicts with the PRD/DESIGN/PROPOSAL docs, say so explicitly rather than quietly reinterpreting scope.
- If something can't be verified (e.g., an API field doesn't exist as assumed), state that uncertainty instead of guessing silently.

Follow DESIGN.md. If you need a color, font or size that is not in it, stop and tell me.