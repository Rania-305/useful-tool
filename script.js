// ============================================================
// SETTINGS
// ============================================================
const API = 'https://api.openf1.org/v1';
const YEAR = 2025;
const MIN_DRIVERS = 2;
const MAX_DRIVERS = 6;
const REQUEST_GAP_MS = 400; // OpenF1 free tier: max 3 requests/second, 30/minute

// ============================================================
// PAGE ELEMENTS
// ============================================================
const els = {
  form: document.getElementById('controls'),
  race: document.getElementById('race'),
  raceError: document.getElementById('race-error'),
  compare: document.getElementById('compare'),
  compareLabel: document.getElementById('compare-label'),
  reset: document.getElementById('reset'),
  driverBox: document.getElementById('drivers'),
  driverList: document.getElementById('driver-list'),
  clearDrivers: document.getElementById('clear-drivers'),
  driverCount: document.getElementById('driver-count'),
  driverCountText: document.getElementById('driver-count-text'),
  inputMsg: document.getElementById('input-msg'),
  panel: document.getElementById('panel'),
  caption: document.getElementById('caption'),
  results: document.getElementById('results'),
  resultsBody: document.getElementById('results-body'),
  cards: document.getElementById('driver-cards'),
  partialNote: document.getElementById('partial-note'),
  mockRace: document.getElementById('mock-race'),
  mockRaceNote: document.getElementById('mock-race-note'),
  raceSvg: document.getElementById('race-svg'),
  raceLap: document.getElementById('race-lap'),
  racePlay: document.getElementById('race-play'),
  raceLegend: document.getElementById('race-legend'),
};

// ============================================================
// APP STATE
// ============================================================
const app = {
  busy: false,      // true while any OpenF1 request is in flight
  view: 'loading',  // 'empty' | 'loading' | 'error' | 'inuse'
  meetings: [],     // 2025 Grand Prix meetings
  meeting: null,    // the selected meeting
  session: null,    // that meeting's Race session
  qualifying: null, // that meeting's Qualifying session (OpenF1 stores the starting grid under it)
  drivers: [],      // drivers in that session
  retry: null,      // function to run when the user presses "Try Again"
};

// ============================================================
// FETCHING FROM OPENF1
// ============================================================
const cache = new Map();   // URL path -> data, so repeat comparisons don't re-download
let lastRequestAt = 0;

class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Fetch one OpenF1 endpoint and return its array of results.
async function getJSON(path) {
  if (cache.has(path)) return cache.get(path);

  // One request at a time, spaced out.
  const wait = lastRequestAt + REQUEST_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();

  let res;
  try {
    res = await fetch(API + path);
  } catch {
    throw new ApiError('Network error', "couldn't reach OpenF1. Check your connection.");
  }

  let body;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(res.status, 'OpenF1 sent a response that is not JSON.');
  }

  // OpenF1 answers a query with no matches as 404 + {"detail":"No results found."}.
  // That means "empty", not "broken".
  if (res.status === 404 && body && body.detail === 'No results found.') {
    cache.set(path, []);
    return [];
  }
  if (!res.ok) {
    const reason = res.status === 429
      ? "OpenF1's free limit (30 requests a minute) was hit. Wait a minute, then try again."
      : "couldn't load data from OpenF1.";
    throw new ApiError(res.status, reason);
  }
  if (!Array.isArray(body)) {
    throw new ApiError('Bad data', 'OpenF1 sent an unexpected response shape.');
  }

  cache.set(path, body);
  return body;
}

// ============================================================
// CALCULATION — average lap time for ONE driver in ONE race
// ============================================================
// laps:       that driver's /laps rows for this race session
// pitInLaps:  Set of lap numbers on which this driver entered the pits (from /pit)
// stints:     that driver's /stints rows (tyre compound + first/last lap of each stint)
// periods:    neutralised periods for the race (from neutralisedPeriods below)
function summarizeDriver(laps, pitInLaps, stints, periods) {
  const sortedStints = stints.slice().sort((a, b) => a.stint_number - b.stint_number);
  const stintFor = lapNumber =>
    sortedStints.find(s => lapNumber >= s.lap_start && lapNumber <= s.lap_end) || null;

  const rows = laps
    .slice()
    .sort((a, b) => a.lap_number - b.lap_number)
    .map(lap => {
      let excluded = null;
      if (typeof lap.lap_duration !== 'number') excluded = 'no time';
      else if (lap.is_pit_out_lap) excluded = 'pit-out';
      else if (pitInLaps.has(lap.lap_number)) excluded = 'pit-in';
      else excluded = neutralisedReason(lap, periods);
      const stint = stintFor(lap.lap_number);
      return { lap: lap.lap_number, seconds: lap.lap_duration, excluded,
               compound: stint ? stint.compound : null, dateStart: lap.date_start };
    });

  const counted = rows.filter(r => !r.excluded);
  const average = averageOf(counted);
  // Computed: the quickest of the counted laps (used to pace the mock race).
  const fastest = counted.reduce((best, r) => (!best || r.seconds < best.seconds ? r : best), null);

  // Computed: the same average, but only over the counted laps inside each stint,
  // so pace on different tyres can be compared fairly.
  const stintSummaries = sortedStints.map(s => {
    const inStint = counted.filter(r => r.lap >= s.lap_start && r.lap <= s.lap_end);
    return {
      number: s.stint_number,
      compound: s.compound,
      lapStart: s.lap_start,
      lapEnd: s.lap_end,
      tyreAgeAtStart: s.tyre_age_at_start,
      countedLaps: inStint.length,
      average: averageOf(inStint),
    };
  });

  return { rows, countedLaps: counted.length, average, fastest, stintSummaries };
}

function averageOf(rows) {
  if (!rows.length) return null;
  return rows.reduce((sum, r) => sum + r.seconds, 0) / rows.length;
}

// OpenF1 compound names -> short labels. Anything else (e.g. "UNKNOWN") -> "?".
const COMPOUND_SHORT = { SOFT: 'S', MEDIUM: 'M', HARD: 'H', INTERMEDIATE: 'I', WET: 'W' };
function compoundShort(compound) {
  return COMPOUND_SHORT[compound] || '?';
}
function compoundName(compound) {
  return COMPOUND_SHORT[compound]
    ? compound.charAt(0) + compound.slice(1).toLowerCase()
    : 'Unknown tyre';
}

// "I (1) → M (11) → M (32)": compound and number of laps in each stint.
function describeStrategy(stintSummaries) {
  if (!stintSummaries.length) return 'No tyre data';
  return stintSummaries
    .map(s => `${compoundShort(s.compound)} (${s.lapEnd - s.lapStart + 1})`)
    .join(' → ');
}

// Grid slot from /starting_grid + classified result from /session_result -> "P2 → P4".
function describeGridToFinish(gridSlot, result) {
  const start = gridSlot && typeof gridSlot.position === 'number' ? `P${gridSlot.position}` : '—';
  let finish = '—';
  if (result) {
    if (result.dsq) finish = 'DSQ';
    else if (result.dns) finish = 'DNS';
    else if (result.dnf) finish = 'DNF';
    else if (typeof result.position === 'number') finish = `P${result.position}`;
  }
  return `${start} → ${finish}`;
}

// Turn /race_control messages into time windows when the race was neutralised.
// What OpenF1 actually sends (checked against 2025 Melbourne, Miami and Spa):
//   start: category "SafetyCar" with "SAFETY CAR DEPLOYED" or "VIRTUAL SAFETY CAR DEPLOYED",
//          or a Track-scope flag "RED"
//   end:   the next Track-scope flag "CLEAR" ("TRACK CLEAR") or "GREEN"
// Known gap: a race that STARTS behind the safety car (e.g. Spa 2025) has no
// "DEPLOYED" message, so those opening laps are not caught by this rule.
function neutralisedPeriods(messages) {
  const sorted = messages.slice().sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const periods = [];
  let open = null;

  for (const m of sorted) {
    const time = Date.parse(m.date);
    if (Number.isNaN(time)) continue;
    const text = m.message || '';
    const isTrackFlag = m.category === 'Flag' && m.scope === 'Track';

    let kind = null;
    if (m.category === 'SafetyCar' && /DEPLOYED/.test(text)) kind = /VIRTUAL/.test(text) ? 'VSC' : 'safety car';
    else if (isTrackFlag && m.flag === 'RED') kind = 'red flag';

    if (kind) {
      if (!open) open = { start: time, kinds: new Set() };
      open.kinds.add(kind); // e.g. a VSC upgraded to a full safety car
    } else if (open && isTrackFlag && (m.flag === 'CLEAR' || m.flag === 'GREEN')) {
      periods.push({ start: open.start, end: time, kind: [...open.kinds].join(' + ') });
      open = null;
    }
  }
  // Still neutralised when the messages run out (e.g. finished under the safety car)
  if (open) periods.push({ start: open.start, end: Infinity, kind: [...open.kinds].join(' + ') });
  return periods;
}

// If any part of this lap overlaps a neutralised period, return that period's kind.
// Laps without a start time can't be checked, so they stay counted.
function neutralisedReason(lap, periods) {
  const start = Date.parse(lap.date_start);
  if (Number.isNaN(start)) return null;
  const end = start + lap.lap_duration * 1000;
  const hit = periods.find(p => start < p.end && end > p.start);
  return hit ? hit.kind : null;
}

// 89.437 -> "1:29.437"
function formatLap(seconds) {
  const m = Math.floor(seconds / 60);
  const s = (seconds - m * 60).toFixed(3).padStart(6, '0');
  return `${m}:${s}`;
}

// ============================================================
// VIEW / STATE HELPERS
// ============================================================
function setView(view, captionText) {
  if (view !== app.view) {
    // Checkered-flag wipe between states
    els.panel.classList.remove('wipe');
    void els.panel.offsetWidth; // restart the animation
    els.panel.classList.add('wipe');
  }
  app.view = view;
  els.panel.dataset.view = view;
  els.caption.textContent = captionText;
  refreshControls();
}

function setBusy(isBusy) {
  app.busy = isBusy;
  document.body.classList.toggle('is-busy', isBusy);
  refreshControls();
}

function showError(err, retryFn) {
  app.retry = retryFn;
  const code = err instanceof ApiError ? err.code : 'Error';
  const message = err instanceof ApiError ? err.message : 'something went wrong.';
  console.error(err);
  setView('error', `${code} — ${message}`);
}

function selectedDriverNumbers() {
  return [...els.driverList.querySelectorAll('input:checked')].map(i => Number(i.value));
}

// One place that decides what every control looks like right now.
function refreshControls() {
  const isError = app.view === 'error';
  const picked = selectedDriverNumbers().length;

  els.race.disabled = app.busy || app.meetings.length === 0;
  els.race.classList.toggle('is-shimmer', app.busy && app.meetings.length === 0);

  els.compare.classList.toggle('is-retry', isError);
  if (app.busy) {
    els.compare.disabled = true;
    els.compareLabel.textContent = 'Loading…';
  } else if (isError) {
    els.compare.disabled = false;
    els.compareLabel.textContent = 'Try Again';
  } else {
    els.compare.disabled = !app.session;
    // Stays clickable (so the Invalid Input state is reachable), but says what's still needed.
    const need = MIN_DRIVERS - picked;
    els.compareLabel.textContent = app.session && need > 0 ? `Compare (pick ${need} more)` : 'Compare';
  }

  els.reset.disabled = app.busy || (!app.meeting && !isError);
  els.clearDrivers.disabled = app.busy || picked === 0;

  // Checkboxes: locked while loading; once 6 are picked, the rest lock.
  els.driverList.querySelectorAll('input').forEach(input => {
    input.disabled = app.busy || (!input.checked && picked >= MAX_DRIVERS);
  });

  els.driverCountText.textContent = picked >= MAX_DRIVERS
    ? `${picked} selected (maximum)`
    : `${picked} selected`;
  els.driverCount.classList.toggle('is-valid', picked >= MIN_DRIVERS && picked <= MAX_DRIVERS);
}

function clearResults() {
  stopMockRace();
  els.mockRace.hidden = true;
  els.results.hidden = true;
  els.resultsBody.replaceChildren();
  els.cards.replaceChildren();
  els.partialNote.hidden = true;
}

function clearDrivers() {
  app.drivers = [];
  els.driverList.replaceChildren();
  els.driverBox.hidden = true;
}

// ============================================================
// STEP 1 — load the 2025 Grand Prix list
// ============================================================
async function loadMeetings() {
  setBusy(true);
  setView('loading', `Loading the ${YEAR} Grand Prix list…`);
  els.race.classList.remove('is-error-outline');
  els.raceError.hidden = true;
  try {
    const meetings = await getJSON(`/meetings?year=${YEAR}`);
    const now = new Date();
    app.meetings = meetings
      .filter(m => /Grand Prix/i.test(m.meeting_name || '')) // drops Pre-Season Testing
      .filter(m => !m.is_cancelled && new Date(m.date_end) < now)
      .sort((a, b) => new Date(a.date_start) - new Date(b.date_start));

    for (const m of app.meetings) {
      const opt = document.createElement('option');
      opt.value = String(m.meeting_key);
      opt.textContent = m.meeting_name;
      els.race.append(opt);
    }
    setBusy(false);
    setView('empty', 'Select a Grand Prix to begin.');
  } catch (err) {
    setBusy(false);
    els.race.classList.add('is-error-outline');
    els.raceError.hidden = false;
    showError(err, loadMeetings);
  }
}

// ============================================================
// STEP 2 — a Grand Prix was picked: find its Race session + drivers
// ============================================================
async function loadRace(meetingKey) {
  app.meeting = app.meetings.find(m => String(m.meeting_key) === meetingKey) || null;
  app.session = null;
  app.qualifying = null;
  clearDrivers();
  clearResults();
  els.inputMsg.textContent = '';
  if (!app.meeting) { setView('empty', 'Select a Grand Prix to begin.'); return; }

  setBusy(true);
  setView('loading', `Loading drivers for the ${app.meeting.meeting_name}…`);
  try {
    // All sessions of this weekend in one request: we need the Race, and also the
    // (Grand Prix) Qualifying session, because OpenF1 files /starting_grid under it.
    const sessions = await getJSON(`/sessions?meeting_key=${encodeURIComponent(meetingKey)}`);
    const session = sessions.find(s => s.session_name === 'Race');
    if (!session) {
      throw new ApiError('No race', `OpenF1 has no Race session for the ${app.meeting.meeting_name}.`);
    }
    // Not "Sprint Qualifying" — that grid is for the Sprint, not the Grand Prix.
    app.qualifying = sessions.find(s => s.session_name === 'Qualifying') || null;

    const drivers = await getJSON(`/drivers?session_key=${encodeURIComponent(session.session_key)}`);
    if (drivers.length === 0) {
      throw new ApiError('No drivers', `OpenF1 lists no drivers for the ${app.meeting.meeting_name} race.`);
    }

    // One entry per car number; teammates next to each other.
    const byNumber = new Map();
    drivers.forEach(d => byNumber.set(d.driver_number, d));
    app.drivers = [...byNumber.values()].sort((a, b) =>
      (a.team_name || '').localeCompare(b.team_name || '') || a.driver_number - b.driver_number);
    app.session = session;

    renderDriverChips();
    setBusy(false);
    setView('empty', `Pick ${MIN_DRIVERS}–${MAX_DRIVERS} drivers, then press Compare.`);
  } catch (err) {
    setBusy(false);
    showError(err, () => loadRace(meetingKey));
  }
}

function renderDriverChips() {
  els.driverList.replaceChildren();
  els.driverBox.hidden = false;
  for (const d of app.drivers) {
    const id = `driver-${d.driver_number}`;
    const li = document.createElement('li');

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.value = String(d.driver_number);

    const label = document.createElement('label');
    label.className = 'chip';
    label.htmlFor = id;

    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = `#${d.driver_number}`;
    const name = document.createElement('span');
    name.textContent = d.full_name || d.broadcast_name || `Driver ${d.driver_number}`;
    const team = document.createElement('span');
    team.className = 'team';
    team.textContent = d.team_name || '';

    label.append(num, name, team);
    li.append(input, label);
    els.driverList.append(li);
  }
}

// ============================================================
// STEP 3 — Compare: validate, fetch laps, compute, render
// ============================================================
async function compare() {
  els.inputMsg.textContent = '';
  const picked = selectedDriverNumbers();

  // Invalid input
  if (!app.session || picked.length < MIN_DRIVERS || picked.length > MAX_DRIVERS) {
    els.inputMsg.textContent = !app.session
      ? 'Input invalid: select a Grand Prix first.'
      : `Input invalid: select ${MIN_DRIVERS}–${MAX_DRIVERS} drivers (you picked ${picked.length}).`;
    els.compare.classList.remove('flash');
    void els.compare.offsetWidth;
    els.compare.classList.add('flash');
    return;
  }

  const sessionKey = encodeURIComponent(app.session.session_key);
  setBusy(true);
  clearResults();
  setView('loading', 'Fetching lap data…');
  try {
    // Two requests cover the whole race (all drivers), and both are cached,
    // so comparing different drivers from the same race costs no extra requests.
    const pits = await getJSON(`/pit?session_key=${sessionKey}`);
    const allLaps = await getJSON(`/laps?session_key=${sessionKey}`);

    // Extras: tyres, finishing result, starting grid. If one of these fails we still
    // show the averages, and say which extra is missing instead of hiding it.
    const missing = [];
    const optional = async (label, path) => {
      try { return await getJSON(path); }
      catch (err) {
        console.error(err);
        missing.push(`${label} (${err instanceof ApiError ? err.code : 'Error'})`);
        return [];
      }
    };
    const stints = await optional('tyre stints', `/stints?session_key=${sessionKey}`);
    const results = await optional('race result', `/session_result?session_key=${sessionKey}`);
    const grid = app.qualifying
      ? await optional('starting grid',
          `/starting_grid?session_key=${encodeURIComponent(app.qualifying.session_key)}`)
      : [];
    if (!app.qualifying) missing.push('starting grid (no Qualifying session in OpenF1)');
    // Race control: used to drop safety car / VSC / red-flag laps from the averages.
    // If it fails, averages still show, but a note says those laps could NOT be excluded.
    let raceControl = [];
    let raceControlLoaded = true;
    try {
      raceControl = await getJSON(`/race_control?session_key=${sessionKey}`);
    } catch (err) {
      console.error(err);
      raceControlLoaded = false;
    }
    const periods = neutralisedPeriods(raceControl);

    const summaries = picked.map(num => {
      const driver = app.drivers.find(d => d.driver_number === num);
      const laps = allLaps.filter(l => l.driver_number === num);
      const pitInLaps = new Set(pits.filter(p => p.driver_number === num).map(p => p.lap_number));
      const driverStints = stints.filter(s => s.driver_number === num);
      return {
        driver,
        ...summarizeDriver(laps, pitInLaps, driverStints, periods),
        gridToFinish: describeGridToFinish(
          grid.find(g => g.driver_number === num),
          results.find(r => r.driver_number === num)),
      };
    });

    // Mock race track: the real circuit outline, traced from OpenF1 /location for ONE lap
    // (the quickest selected driver's fastest counted lap, ~300 points). If it fails,
    // the mock race falls back to a generic oval and says why.
    const racers = summaries.filter(s => s.fastest);
    const reference = racers.reduce((a, b) => (!a || b.fastest.seconds < a.fastest.seconds ? b : a), null);
    let track = null;
    let trackProblem = null;
    if (reference) {
      try {
        track = await loadTrackOutline(sessionKey, reference);
      } catch (err) {
        console.error(err);
        trackProblem = err instanceof ApiError ? `${err.code} — ${err.message}` : 'unexpected error';
      }
    }

    renderResults(summaries, missing, raceControlLoaded);
    renderMockRace(summaries, track, trackProblem);
    setBusy(false);
    setView('inuse', `Showing average lap times for the ${app.meeting.meeting_name}.`);
    scrollToPanel();
  } catch (err) {
    setBusy(false);
    showError(err, compare);
  }
}

// Bring the results into view after Compare (they can land below the fold).
function scrollToPanel() {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  els.panel.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
}

function gapText(s, best) {
  if (s.average === null) return '—';
  return s.average === best ? 'Fastest' : `+${(s.average - best).toFixed(3)}s`;
}

function cell(text, className) {
  const td = document.createElement('td');
  if (className) td.className = className;
  td.textContent = text;
  return td;
}

function renderResults(summaries, missing, raceControlLoaded) {
  const ranked = summaries.filter(s => s.average !== null).sort((a, b) => a.average - b.average);
  const noData = summaries.filter(s => s.average === null);
  const best = ranked.length ? ranked[0].average : null;
  const mostLaps = Math.max(...summaries.map(s => s.countedLaps));
  const maxGap = ranked.length ? ranked[ranked.length - 1].average - best : 0;

  // Partial state: someone has clearly fewer usable laps than the others, or none at all,
  // or one of the extra endpoints (tyres / result / grid) couldn't be loaded.
  const notes = [];
  const partial = summaries.filter(s => s.countedLaps < mostLaps);
  if (partial.length) {
    notes.push('Incomplete data: ' + partial.map(s =>
      s.countedLaps === 0
        ? `${s.driver.full_name} (no laps)`
        : `${s.driver.full_name} (${s.countedLaps} of ${mostLaps} laps)`
    ).join(', ') + '.');
  }
  if (missing.length) {
    notes.push(`Couldn't load ${missing.join(', ')}.`);
  }
  if (!raceControlLoaded) {
    notes.push("Couldn't load safety car data, so those laps are included in the averages.");
  }
  if (notes.length) {
    els.partialNote.hidden = false;
    els.partialNote.textContent = notes.join(' ');
  }

  renderCards([...ranked, ...noData], best);

  els.resultsBody.replaceChildren();
  [...ranked, ...noData].forEach((s, i) => {
    const tr = document.createElement('tr');
    tr.append(cell(s.average === null ? '—' : String(i + 1), 'rank'));

    const who = document.createElement('td');
    const name = document.createElement('span');
    name.textContent = s.driver.full_name;
    const team = document.createElement('span');
    team.className = 'team';
    team.textContent = `#${s.driver.driver_number} · ${s.driver.team_name || ''}`;
    who.append(name, team);
    tr.append(who);

    tr.append(cell(s.average === null ? 'No data' : formatLap(s.average), 'num'));
    // Gap: the number, plus a bar scaled to the largest gap in this comparison
    const gapCell = cell(gapText(s, best), 'num');
    if (s.average !== null && maxGap > 0) {
      const bar = document.createElement('span');
      bar.className = 'gap-bar';
      bar.setAttribute('aria-hidden', 'true');
      const fill = document.createElement('span');
      fill.className = 'gap-fill';
      fill.style.width = `${((s.average - best) / maxGap) * 100}%`;
      bar.append(fill);
      gapCell.append(bar);
    }
    tr.append(gapCell);
    tr.append(cell(`${s.countedLaps} of ${s.rows.length}`, 'num'));
    tr.append(cell(s.gridToFinish, 'num'));

    // Expandable lap-by-lap detail
    const detailRow = document.createElement('tr');
    detailRow.className = 'lap-detail';
    detailRow.hidden = true;
    const detailCell = document.createElement('td');
    detailCell.colSpan = 7;
    detailCell.append(buildStintList(s), buildLapGrid(s));
    detailRow.append(detailCell);

    const btnCell = document.createElement('td');
    if (s.rows.length) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'row-btn';
      btn.textContent = 'Laps ▸';
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', () => {
        detailRow.hidden = !detailRow.hidden;
        btn.setAttribute('aria-expanded', String(!detailRow.hidden));
        btn.textContent = detailRow.hidden ? 'Laps ▸' : 'Laps ▾';
      });
      btnCell.append(btn);
    }
    tr.append(btnCell);

    els.resultsBody.append(tr, detailRow);
  });

  els.results.hidden = false;
}

// ============================================================
// SIDE-BY-SIDE DRIVER CARDS (photo + key numbers), fastest first
// ============================================================
// Only accept https image links from OpenF1's headshot_url; anything else -> no photo.
function safeImageUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

// Shown when OpenF1 has no headshot for a driver, or the image fails to load.
function photoFallback(driver) {
  const box = document.createElement('div');
  box.className = 'photo photo-missing';
  box.textContent = driver.name_acronym || `#${driver.driver_number}`;
  box.title = 'No photo available from OpenF1';
  return box;
}

// OpenF1's headshot_url points at formula1.com's smallest rendition (".../1col/image.png",
// 93x93 px), which looks blurry when stretched across a card. The same image is also
// served at ".../4col/image.png" (432x432 px). This naming is formula1.com's, not part of
// the OpenF1 docs, so if the larger file fails we fall back to OpenF1's original URL.
function largerHeadshot(url) {
  return url.includes('/1col/image.png') ? url.replace('/1col/image.png', '/4col/image.png') : url;
}

function buildPhoto(driver) {
  const src = safeImageUrl(driver.headshot_url);
  if (!src) return photoFallback(driver);

  const img = document.createElement('img');
  img.className = 'photo';
  img.alt = `Photo of ${driver.full_name}`;
  img.loading = 'lazy';
  img.addEventListener('error', () => {
    if (img.src !== src) img.src = src;                // larger version failed: try OpenF1's own URL
    else img.replaceWith(photoFallback(driver));       // that failed too: show the acronym box
  });
  img.src = largerHeadshot(src);
  return img;
}

// OpenF1's team_colour is a 6-digit hex string without '#', e.g. "F47600".
// Only accept exactly that shape; anything else -> no team theming.
function safeTeamColour(raw) {
  return /^[0-9a-fA-F]{6}$/.test(raw || '') ? `#${raw}` : null;
}

function renderCards(ordered, best) {
  els.cards.replaceChildren();
  els.cards.style.setProperty('--cards', String(ordered.length));

  ordered.forEach((s, i) => {
    const card = document.createElement('li');
    card.className = 'driver-card';
    if (s.average !== null && s.average === best) card.classList.add('is-fastest');

    // Theme the card with the team colour straight from the API (not hardcoded).
    const teamColour = safeTeamColour(s.driver.team_colour);
    if (teamColour) {
      card.classList.add('has-team');
      card.style.setProperty('--team', teamColour);
    }

    const rank = document.createElement('span');
    rank.className = 'card-rank';
    rank.textContent = s.average === null ? '—' : `P${i + 1}`;

    const name = document.createElement('p');
    name.className = 'card-name';
    name.textContent = s.driver.full_name;

    const team = document.createElement('p');
    team.className = 'team';
    team.textContent = `#${s.driver.driver_number} · ${s.driver.team_name || ''}`;

    // Cards are the quick summary; gap and lap counts live in the table below (not repeated here).
    const stats = document.createElement('dl');
    const stat = (label, value) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      stats.append(dt, dd);
    };
    stat('Avg lap', s.average === null ? 'No data' : formatLap(s.average));
    stat('Grid → Finish', s.gridToFinish);
    stat('Tyres', describeStrategy(s.stintSummaries));

    card.append(rank, buildPhoto(s.driver), name, team, stats);
    els.cards.append(card);
  });
}

// One line per stint: compound, lap range, and the computed average for that stint.
function buildStintList(summary) {
  const ul = document.createElement('ul');
  ul.className = 'stint-list';
  for (const st of summary.stintSummaries) {
    const li = document.createElement('li');
    const avg = st.average === null ? 'no counted laps' : `avg ${formatLap(st.average)}`;
    const age = typeof st.tyreAgeAtStart === 'number' && st.tyreAgeAtStart > 0
      ? `, tyres ${st.tyreAgeAtStart} laps old at start` : '';
    li.textContent = `Stint ${st.number} · ${compoundName(st.compound)}${age} · ` +
      `laps ${st.lapStart}–${st.lapEnd} · ${avg} (${st.countedLaps} counted)`;
    ul.append(li);
  }
  return ul;
}

function buildLapGrid(summary) {
  const ol = document.createElement('ol');
  ol.className = 'lap-grid';
  for (const r of summary.rows) {
    const li = document.createElement('li');
    const time = typeof r.seconds === 'number' ? formatLap(r.seconds) : '—';

    const tyre = document.createElement('span');
    tyre.className = 'tyre';
    tyre.textContent = compoundShort(r.compound);
    tyre.title = compoundName(r.compound);
    li.append(tyre, ` L${r.lap} ${time}`);

    if (r.excluded) {
      li.className = 'excluded';
      const why = document.createElement('span');
      why.className = 'why';
      why.textContent = `(${r.excluded})`;
      li.append(why);
    }
    ol.append(li);
  }
  return ol;
}

// ============================================================
// MOCK RACE — a simulation, NOT a replay of what happened
// ============================================================
// Every car laps at its driver's fastest counted lap time, over and over, for RACE_LAPS
// laps, sped up RACE_SPEEDUP times. Speed ratios between cars are real; nothing else is.
const RACE_LAPS = 10;
const RACE_SPEEDUP = 15;
const SVG_NS = 'http://www.w3.org/2000/svg';
const TRACK_SIZE = 1000; // drawing units for the longest side of the track
const TRACK_PAD = 40;
const CAR_LENGTH = 28;   // drawing units; the pixel car is 16 x 7
const LANE_GAP = 5;      // sideways spacing between cars, so they don't sit exactly on top of each other

const race = { frame: null, startedAt: 0, cars: [], points: [], observer: null };

// Fetch x/y positions for one lap of one driver and turn them into track points.
// Each point gets f = how far through the lap (0 to 1) by TIME, so cars slow down
// in the corners the same way the reference driver did.
async function loadTrackOutline(sessionKey, summary) {
  const lap = summary.fastest;
  const start = Date.parse(lap.dateStart);
  if (Number.isNaN(start)) throw new ApiError('Bad data', 'that lap has no start time.');
  const end = start + lap.seconds * 1000;

  const path = `/location?session_key=${sessionKey}` +
    `&driver_number=${encodeURIComponent(summary.driver.driver_number)}` +
    `&date>=${encodeURIComponent(lap.dateStart)}` +
    `&date<=${encodeURIComponent(new Date(end).toISOString())}`;
  const rows = await getJSON(path);

  const points = rows
    .filter(p => typeof p.x === 'number' && typeof p.y === 'number' && !(p.x === 0 && p.y === 0))
    .map(p => ({ x: p.x, y: p.y, f: (Date.parse(p.date) - start) / (end - start) }))
    .filter(p => p.f >= 0 && p.f <= 1)
    .sort((a, b) => a.f - b.f);
  if (points.length < 50) {
    throw new ApiError('No track', `OpenF1 has too few position points for that lap (${points.length}).`);
  }
  return points;
}

// Fallback when the real outline can't be loaded: a plain oval, evenly paced.
function ovalOutline() {
  const n = 120;
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI;
    return { x: Math.cos(a) * 2, y: Math.sin(a), f: i / n };
  });
}

// Scale raw x/y into SVG drawing units. SVG's y axis points down, so flip it.
function fitToBox(points) {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = TRACK_SIZE / Math.max(maxX - minX, maxY - minY);
  return {
    width: (maxX - minX) * scale + TRACK_PAD * 2,
    height: (maxY - minY) * scale + TRACK_PAD * 2,
    points: points.map(p => ({
      x: (p.x - minX) * scale + TRACK_PAD,
      y: (maxY - p.y) * scale + TRACK_PAD,
      f: p.f,
    })),
  };
}

// Where is a car that is fraction f (0–1) of the way through a lap?
// Find the two track points either side of f (by time) and blend between them.
function pointAt(f) {
  const pts = race.points;
  const last = pts[pts.length - 1];
  let a, b;
  if (f < pts[0].f || f >= last.f) {
    // Between the last point and the first one again (crossing the line)
    a = last; b = { ...pts[0], f: pts[0].f + 1 };
    if (f < pts[0].f) f += 1;
  } else {
    const i = pts.findIndex(p => p.f > f);
    a = pts[i - 1]; b = pts[i];
  }
  const t = b.f === a.f ? 0 : (f - a.f) / (b.f - a.f);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

// One pixel car (the same #car drawing as the hero), body tinted with the team colour.
function buildRaceCar(teamColour) {
  const g = svgEl('g', { class: 'race-car' });
  if (teamColour) g.style.setProperty('--team', teamColour);
  const height = CAR_LENGTH * 7 / 16;
  g.append(svgEl('use', { href: '#car', x: -CAR_LENGTH / 2, y: -height / 2, width: CAR_LENGTH, height }));
  return g;
}

function placeCar(car, lapFraction) {
  const here = pointAt(lapFraction);
  const ahead = pointAt((lapFraction + 0.004) % 1);
  const angle = Math.atan2(ahead.y - here.y, ahead.x - here.x);
  // Shift sideways into this car's lane (perpendicular to the direction of travel)
  const x = here.x - Math.sin(angle) * car.lane;
  const y = here.y + Math.cos(angle) * car.lane;
  car.el.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(angle * 180 / Math.PI).toFixed(1)})`);
}

// summaries: every selected driver. track: outline from OpenF1, or null (then trackProblem says why).
function renderMockRace(summaries, track, trackProblem) {
  stopMockRace();
  const racers = summaries.filter(s => s.fastest);
  if (!racers.length) { els.mockRace.hidden = true; return; }

  const ordered = racers.slice().sort((a, b) => a.fastest.seconds - b.fastest.seconds);
  const fitted = fitToBox(track || ovalOutline());
  race.points = fitted.points;

  // Note: say exactly what this is and where the track came from.
  const circuit = app.session.circuit_short_name || app.meeting.meeting_name;
  const trackText = track
    ? ''
    : ` Couldn't load the track (${trackProblem || 'no data'}), so this is an oval.`;
  const skipped = summaries.length > racers.length
    ? ' Drivers with no laps are left out.' : '';
  els.mockRaceNote.textContent =
    `Simulation, not a replay: each car laps at its driver's fastest lap.${trackText}${skipped}`;

  // Draw: tarmac, start/finish line, cars
  const svg = els.raceSvg;
  svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${fitted.width.toFixed(0)} ${fitted.height.toFixed(0)}`);
  svg.setAttribute('aria-label',
    `Simulated ${RACE_LAPS}-lap race on ${track ? `the ${circuit} outline` : 'a generic oval'} between ` +
    ordered.map(s => s.driver.full_name).join(', ') + '.');
  const d = race.points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + ' Z';
  svg.append(svgEl('path', { d, class: 'tarmac' }));

  const p0 = pointAt(0), p1 = pointAt(0.004);
  const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180 / Math.PI;
  const line = svgEl('g', { transform: `translate(${p0.x} ${p0.y}) rotate(${angle})` });
  line.append(svgEl('line', { x1: 0, y1: -24, x2: 0, y2: 24, class: 'finish-white' }),
              svgEl('line', { x1: 0, y1: -24, x2: 0, y2: 24, class: 'finish-black' }));
  svg.append(line);

  race.cars = ordered.map((s, i) => {
    const el = buildRaceCar(safeTeamColour(s.driver.team_colour));
    return { el, lapTime: s.fastest.seconds, lane: (i - (ordered.length - 1) / 2) * LANE_GAP };
  });
  // Draw the slowest car first so the fastest sits on top when they overlap
  [...race.cars].reverse().forEach(car => { svg.append(car.el); placeCar(car, 0); });

  // Legend: fastest lap and the computed gap after RACE_LAPS laps
  els.raceLegend.replaceChildren();
  const leaderTotal = ordered[0].fastest.seconds * RACE_LAPS;
  ordered.forEach((s, i) => {
    const li = document.createElement('li');
    const icon = svgEl('svg', { class: 'car legend-car', viewBox: '0 0 16 7', 'aria-hidden': 'true' });
    const colour = safeTeamColour(s.driver.team_colour);
    if (colour) icon.style.setProperty('--team', colour);
    icon.append(svgEl('use', { href: '#car' }));
    const name = document.createElement('span');
    name.textContent = `P${i + 1} ${s.driver.full_name}`;
    const time = document.createElement('span');
    time.className = 'muted';
    const gap = s.fastest.seconds * RACE_LAPS - leaderTotal;
    time.textContent = `best lap ${formatLap(s.fastest.seconds)}` +
      (i === 0 ? '' : ` · +${gap.toFixed(3)}s`);
    li.append(icon, name, time);
    els.raceLegend.append(li);
  });

  els.raceLap.textContent = `Lap 1 / ${RACE_LAPS}`;
  els.racePlay.textContent = 'Start';
  els.mockRace.hidden = false;

  // Start on its own when scrolled into view (so it isn't over before anyone sees it),
  // unless the visitor prefers reduced motion — then it waits for the Start button.
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
    race.observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) startMockRace();
    }, { threshold: 0.5 });
    race.observer.observe(els.raceSvg);
  }
}

function startMockRace() {
  stopMockRace();
  els.racePlay.textContent = 'Replay';
  race.startedAt = performance.now();
  race.frame = requestAnimationFrame(raceFrame);
}

function stopMockRace() {
  if (race.frame) cancelAnimationFrame(race.frame);
  race.frame = null;
  if (race.observer) race.observer.disconnect();
  race.observer = null;
}

function raceFrame(now) {
  // Race seconds elapsed (real-world seconds × speed-up)
  const raceSeconds = (now - race.startedAt) / 1000 * RACE_SPEEDUP;
  let finished = 0;
  race.cars.forEach(car => {
    const laps = Math.min(raceSeconds / car.lapTime, RACE_LAPS);
    if (laps >= RACE_LAPS) finished++;
    placeCar(car, laps % 1);
  });
  const leaderLaps = raceSeconds / race.cars[0].lapTime;
  if (finished === race.cars.length) {
    els.raceLap.textContent = 'Finished';
    race.frame = null;
    return;
  }
  els.raceLap.textContent = leaderLaps >= RACE_LAPS
    ? 'Leader finished'
    : `Lap ${Math.floor(leaderLaps) + 1} / ${RACE_LAPS}`;
  race.frame = requestAnimationFrame(raceFrame);
}

// ============================================================
// RESET
// ============================================================
function resetAll() {
  els.race.value = '';
  app.meeting = null;
  app.session = null;
  app.qualifying = null;
  app.retry = null;
  clearDrivers();
  clearResults();
  els.inputMsg.textContent = '';
  if (app.meetings.length === 0) { loadMeetings(); return; }
  setView('empty', 'Select a Grand Prix to begin.');
}

// ============================================================
// EVENTS
// ============================================================
els.race.addEventListener('change', () => loadRace(els.race.value));

els.driverList.addEventListener('change', () => {
  els.inputMsg.textContent = '';
  refreshControls();
});

els.form.addEventListener('submit', event => {
  event.preventDefault();
  if (app.view === 'error' && app.retry) { app.retry(); return; }
  compare();
});

els.reset.addEventListener('click', resetAll);
els.racePlay.addEventListener('click', startMockRace);

// Clear drivers: untick every driver but keep the selected Grand Prix (no reload).
els.clearDrivers.addEventListener('click', () => {
  els.driverList.querySelectorAll('input:checked').forEach(input => { input.checked = false; });
  els.inputMsg.textContent = '';
  if (app.view === 'inuse' || app.view === 'error') {
    clearResults();
    setView('empty', `Pick ${MIN_DRIVERS}–${MAX_DRIVERS} drivers, then press Compare.`);
  } else {
    refreshControls();
  }
  // The button just disabled itself, so move focus somewhere useful.
  const first = els.driverList.querySelector('input');
  if (first) first.focus();
});
els.panel.addEventListener('animationend', e => {
  if (e.animationName === 'wipe') els.panel.classList.remove('wipe');
});

// Start
loadMeetings();
