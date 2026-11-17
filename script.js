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
  driverList: document.getElementById('driver-list'),
  driverPlaceholder: document.getElementById('driver-placeholder'),
  driverCount: document.getElementById('driver-count'),
  driverCountText: document.getElementById('driver-count-text'),
  inputMsg: document.getElementById('input-msg'),
  panel: document.getElementById('panel'),
  caption: document.getElementById('caption'),
  results: document.getElementById('results'),
  resultsBody: document.getElementById('results-body'),
  partialNote: document.getElementById('partial-note'),
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
function summarizeDriver(laps, pitInLaps) {
  const rows = laps
    .slice()
    .sort((a, b) => a.lap_number - b.lap_number)
    .map(lap => {
      let excluded = null;
      if (typeof lap.lap_duration !== 'number') excluded = 'no time';
      else if (lap.is_pit_out_lap) excluded = 'pit-out';
      else if (pitInLaps.has(lap.lap_number)) excluded = 'pit-in';
      return { lap: lap.lap_number, seconds: lap.lap_duration, excluded };
    });

  const counted = rows.filter(r => !r.excluded);
  const total = counted.reduce((sum, r) => sum + r.seconds, 0);
  const average = counted.length ? total / counted.length : null;

  return { rows, countedLaps: counted.length, average };
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
    els.compareLabel.textContent = 'Compare';
  }

  els.reset.disabled = app.busy || (!app.meeting && !isError);

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
  els.results.hidden = true;
  els.resultsBody.replaceChildren();
  els.partialNote.hidden = true;
}

function clearDrivers() {
  app.drivers = [];
  els.driverList.replaceChildren();
  els.driverPlaceholder.hidden = false;
  els.driverPlaceholder.textContent = 'Select a Grand Prix to see its drivers.';
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
  clearDrivers();
  clearResults();
  els.inputMsg.textContent = '';
  if (!app.meeting) { setView('empty', 'Select a Grand Prix to begin.'); return; }

  setBusy(true);
  setView('loading', `Loading drivers for the ${app.meeting.meeting_name}…`);
  try {
    const sessions = await getJSON(`/sessions?meeting_key=${encodeURIComponent(meetingKey)}&session_name=Race`);
    if (sessions.length === 0) {
      throw new ApiError('No race', `OpenF1 has no Race session for the ${app.meeting.meeting_name}.`);
    }
    const session = sessions[0];

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
  els.driverPlaceholder.hidden = true;
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

    const summaries = picked.map(num => {
      const driver = app.drivers.find(d => d.driver_number === num);
      const laps = allLaps.filter(l => l.driver_number === num);
      const pitInLaps = new Set(pits.filter(p => p.driver_number === num).map(p => p.lap_number));
      return { driver, ...summarizeDriver(laps, pitInLaps) };
    });

    renderResults(summaries);
    setBusy(false);
    setView('inuse', `Showing average lap times for the ${app.meeting.meeting_name}.`);
  } catch (err) {
    setBusy(false);
    showError(err, compare);
  }
}

function cell(text, className) {
  const td = document.createElement('td');
  if (className) td.className = className;
  td.textContent = text;
  return td;
}

function renderResults(summaries) {
  const ranked = summaries.filter(s => s.average !== null).sort((a, b) => a.average - b.average);
  const noData = summaries.filter(s => s.average === null);
  const best = ranked.length ? ranked[0].average : null;
  const mostLaps = Math.max(...summaries.map(s => s.countedLaps));

  // Partial state: someone has clearly fewer usable laps than the others, or none at all.
  const partial = summaries.filter(s => s.countedLaps < mostLaps);
  if (partial.length) {
    els.partialNote.hidden = false;
    els.partialNote.textContent = 'Incomplete data: ' + partial.map(s =>
      s.countedLaps === 0
        ? `${s.driver.full_name} has no usable laps in OpenF1 for this race`
        : `${s.driver.full_name} has ${s.countedLaps} counted laps vs ${mostLaps}`
    ).join('; ') + '. Fewer laps means the average covers a different part of the race.';
  }

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
    tr.append(cell(
      s.average === null ? '—' : (s.average === best ? 'Fastest' : `+${(s.average - best).toFixed(3)}s`),
      'num'));
    tr.append(cell(`${s.countedLaps} of ${s.rows.length}`, 'num'));

    // Expandable lap-by-lap detail
    const detailRow = document.createElement('tr');
    detailRow.className = 'lap-detail';
    detailRow.hidden = true;
    const detailCell = document.createElement('td');
    detailCell.colSpan = 6;
    detailCell.append(buildLapGrid(s));
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

function buildLapGrid(summary) {
  const ol = document.createElement('ol');
  ol.className = 'lap-grid';
  for (const r of summary.rows) {
    const li = document.createElement('li');
    const time = typeof r.seconds === 'number' ? formatLap(r.seconds) : '—';
    if (r.excluded) {
      li.className = 'excluded';
      li.textContent = `L${r.lap} ${time}`;
      const why = document.createElement('span');
      why.className = 'why';
      why.textContent = `(${r.excluded})`;
      li.append(why);
    } else {
      li.textContent = `L${r.lap} ${time}`;
    }
    ol.append(li);
  }
  return ol;
}

// ============================================================
// RESET
// ============================================================
function resetAll() {
  els.race.value = '';
  app.meeting = null;
  app.session = null;
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
els.panel.addEventListener('animationend', e => {
  if (e.animationName === 'wipe') els.panel.classList.remove('wipe');
});

// Start
loadMeetings();
