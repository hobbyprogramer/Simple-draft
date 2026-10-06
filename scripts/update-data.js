// Runs on GitHub every few hours: fetches FPL data and saves it to data/players.json.
// You don't need to edit this file.
const fs = require('fs');

const DRAFT = 'https://draft.premierleague.com/api';
const FPL = 'https://fantasy.premierleague.com/api';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
};
const POS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
const norm = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

async function getJSON(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (r.ok) return await r.json();
      console.log(`${url} returned ${r.status}, retrying`);
    } catch (e) {
      console.log(`${url} failed: ${e.message}, retrying`);
    }
    await new Promise((res) => setTimeout(res, 5000 * (i + 1)));
  }
  throw new Error('Could not fetch ' + url);
}

// Minimal CSV parser that handles quoted fields
function parseCSV(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift() || [];
  return rows.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

// Last season's totals per player (matched by FPL's permanent player code),
// used as a starting point early in the season when there is little data.
async function lastSeasonPriors(currentSeasonStartYear) {
  const y = currentSeasonStartYear - 1;
  const season = `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
  const url = `https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data/${season}/players_raw.csv`;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('status ' + r.status);
    const rows = parseCSV(await r.text());
    const out = new Map();
    rows.forEach((p) => {
      const min = Number(p.minutes) || 0;
      if (min < 1) return;
      const n90 = min / 90;
      out.set(Number(p.code), {
        min,
        pos: { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' }[Number(p.element_type)],
        xg: +((Number(p.expected_goals) || 0) / n90).toFixed(3),
        xa: +((Number(p.expected_assists) || 0) / n90).toFixed(3),
        sv: +((Number(p.saves) || 0) / n90).toFixed(3),
        xgc: +((Number(p.expected_goals_conceded) || 0) / n90).toFixed(3),
        bon: +((Number(p.bonus) || 0) / n90).toFixed(3),
        share: +Math.min(1, min / (90 * 38)).toFixed(3),
      });
    });
    console.log(`Loaded last-season data for ${out.size} players (${season})`);
    return out;
  } catch (e) {
    console.log('Could not load last-season data: ' + e.message);
    return new Map();
  }
}

(async () => {
  const draft = await getJSON(`${DRAFT}/bootstrap-static`);
  const classic = await getJSON(`${FPL}/bootstrap-static/`);
  const fixtures = await getJSON(`${FPL}/fixtures/?future=1`);

  const teamShort = {};
  classic.teams.forEach((t) => (teamShort[t.id] = t.short_name));
  const draftTeamShort = {};
  (draft.teams || []).forEach((t) => (draftTeamShort[t.id] = t.short_name));

  const byFull = new Map(), byWeb = new Map();
  classic.elements.forEach((e) => {
    const t = teamShort[e.team];
    byFull.set(`${t}|${norm(e.first_name)} ${norm(e.second_name)}`, e);
    byWeb.set(`${t}|${norm(e.web_name)}`, e);
  });

  const fx = {};
  fixtures.filter((f) => f.event).sort((a, b) => a.event - b.event).forEach((f) => {
    (fx[f.team_h] = fx[f.team_h] || []).push({ opp: teamShort[f.team_a], home: true, diff: f.team_h_difficulty, gw: f.event });
    (fx[f.team_a] = fx[f.team_a] || []).push({ opp: teamShort[f.team_h], home: false, diff: f.team_a_difficulty, gw: f.event });
  });

  // Season start year, e.g. 2026 for 2026/27
  const firstKick = (classic.events[0] && classic.events[0].deadline_time) || new Date().toISOString();
  const seasonYear = new Date(firstKick).getUTCFullYear();
  const priors = await lastSeasonPriors(seasonYear);

  // Minutes in each of the last 4 finished gameweeks
  const finished = classic.events.filter((e) => e.finished).map((e) => e.id).slice(-4);
  const recent = new Map();
  for (const gw of finished) {
    try {
      const live = await getJSON(`${FPL}/event/${gw}/live/`);
      (live.elements || []).forEach((el) => {
        const arr = recent.get(el.id) || [];
        arr.push((el.stats && el.stats.minutes) || 0);
        recent.set(el.id, arr);
      });
    } catch (e) { console.log(`No live data for gameweek ${gw}`); }
  }

  const players = draft.elements.map((d) => {
    const pos = POS[d.element_type];
    if (!pos) return null;
    const t = draftTeamShort[d.team] || teamShort[d.team];
    const c = byFull.get(`${t}|${norm(d.first_name)} ${norm(d.second_name)}`) || byWeb.get(`${t}|${norm(d.web_name)}`);
    if (!c) return null;
    return {
      id: d.id, name: d.web_name, team: t, pos,
      minutes: c.minutes || 0,
      xg: parseFloat(c.expected_goals) || 0,
      xa: parseFloat(c.expected_assists) || 0,
      form: parseFloat(c.form) || 0,
      saves: c.saves || 0,
      defcon90: parseFloat(c.defensive_contribution_per_90) || (c.minutes ? ((c.defensive_contribution || 0) / c.minutes) * 90 : 0),
      goalsConceded: c.goals_conceded || 0,
      xgc: parseFloat(c.expected_goals_conceded) || 0,
      points: c.total_points || 0,
      status: c.status, chance: c.chance_of_playing_next_round, news: c.news || '',
      fixtures: (fx[c.team] || []).slice(0, 6),
      bonus: c.bonus || 0,
      recentShare: recent.has(c.id) && finished.length ? +(recent.get(c.id).reduce((x, y) => x + y, 0) / (90 * finished.length)).toFixed(3) : null,
      prior: priors.get(c.code) || null,
    };
  }).filter(Boolean);

  const next = classic.events.find((e) => e.is_next);
  const out = {
    updated: new Date().toISOString(),
    gameweeksPlayed: classic.events.filter((e) => e.finished).length,
    nextGameweek: next ? next.id : null,
    players,
  };
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync('data/players.json', JSON.stringify(out));
  console.log(`Saved ${players.length} players for gameweek ${out.nextGameweek}`);
})().catch((e) => { console.error(e); process.exit(1); });
