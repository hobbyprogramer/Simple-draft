// Server part: fetches data from FPL and FPL Draft, merges it, and sends it to the website.
// You don't need to edit this file.

const DRAFT = 'https://draft.premierleague.com/api';
const FPL = 'https://fantasy.premierleague.com/api';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-GB,en;q=0.9',
};
const POS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };

async function getJSON(url, tries = 2) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (!r.ok) {
        last = new Error(`${url} returned ${r.status}`);
        last.status = r.status;
      } else {
        return await r.json();
      }
    } catch (e) {
      last = new Error(`${url} failed: ${e.message}`);
    }
    await new Promise((res) => setTimeout(res, 400));
  }
  throw last;
}

const norm = (s) =>
  (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

module.exports = async (req, res) => {
  const league = String(req.query.league || '').trim();
  if (league && !/^\d{1,9}$/.test(league)) {
    return res.status(400).json({ error: 'A league ID is a number, like 12345.' });
  }

  let draft, classic, fixtures;
  try {
    [draft, classic, fixtures] = await Promise.all([
      getJSON(`${DRAFT}/bootstrap-static`),
      getJSON(`${FPL}/bootstrap-static/`),
      getJSON(`${FPL}/fixtures/?future=1`),
    ]);
  } catch (e) {
    console.error(e);
    return res
      .status(502)
      .json({ error: 'Could not get player data from FPL right now. Try again in a few minutes.', details: e.message });
  }

  // Which league players are owned?
  let owners = null;
  let leagueSize = null;
  if (league) {
    try {
      const s = await getJSON(`${DRAFT}/league/${league}/element-status`);
      owners = new Map((s.element_status || []).map((x) => [x.element, x.owner]));
      try {
        const d = await getJSON(`${DRAFT}/league/${league}/details`);
        leagueSize = (d.league_entries || []).length || null;
      } catch (e) { /* size is optional */ }
    } catch (e) {
      return res
        .status(404)
        .json({ error: `League ${league} was not found. Check the number and try again.` });
    }
  }

  // Team short names (ARS, LIV ...)
  const teamShort = {};
  classic.teams.forEach((t) => (teamShort[t.id] = t.short_name));
  const draftTeamShort = {};
  (draft.teams || []).forEach((t) => (draftTeamShort[t.id] = t.short_name));

  // Look up classic FPL stats (xG, xA, minutes, form) by team + name
  const byFull = new Map();
  const byWeb = new Map();
  classic.elements.forEach((e) => {
    const t = teamShort[e.team];
    byFull.set(`${t}|${norm(e.first_name)} ${norm(e.second_name)}`, e);
    byWeb.set(`${t}|${norm(e.web_name)}`, e);
  });

  // Upcoming fixtures per team
  const fx = {};
  fixtures
    .filter((f) => f.event)
    .sort((a, b) => a.event - b.event)
    .forEach((f) => {
      (fx[f.team_h] = fx[f.team_h] || []).push({ opp: teamShort[f.team_a], home: true, diff: f.team_h_difficulty, gw: f.event });
      (fx[f.team_a] = fx[f.team_a] || []).push({ opp: teamShort[f.team_h], home: false, diff: f.team_a_difficulty, gw: f.event });
    });

  const gameweeksPlayed = classic.events.filter((e) => e.finished).length;
  const next = classic.events.find((e) => e.is_next);

  const players = draft.elements
    .map((d) => {
      const pos = POS[d.element_type];
      if (!pos) return null;
      const t = draftTeamShort[d.team] || teamShort[d.team];
      const c =
        byFull.get(`${t}|${norm(d.first_name)} ${norm(d.second_name)}`) ||
        byWeb.get(`${t}|${norm(d.web_name)}`);
      if (!c) return null;
      return {
        id: d.id,
        name: d.web_name,
        team: t,
        pos,
        minutes: c.minutes || 0,
        xg: parseFloat(c.expected_goals) || 0,
        xa: parseFloat(c.expected_assists) || 0,
        form: parseFloat(c.form) || 0,
        saves: c.saves || 0,
        goalsConceded: c.goals_conceded || 0,
        xgc: parseFloat(c.expected_goals_conceded) || 0,
        points: c.total_points || 0,
        status: c.status,
        chance: c.chance_of_playing_next_round,
        news: c.news || '',
        fixtures: (fx[c.team] || []).slice(0, 6),
        available: owners ? !owners.get(d.id) : null,
      };
    })
    .filter(Boolean);

  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');
  return res.status(200).json({
    gameweeksPlayed,
    nextGameweek: next ? next.id : null,
    league: league || null,
    leagueSize,
    players,
  });
};
