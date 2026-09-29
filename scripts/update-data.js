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
