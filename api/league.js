// Looks up which players are owned in a FPL Draft league.
// Accepts a Team ID (the number in the address on the Points page) or a league ID.
// You don't need to edit this file.
const DRAFT = 'https://draft.premierleague.com/api';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
};

async function getJSON(url) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (r.ok) return await r.json();
      last = new Error(`${url} returned ${r.status}`);
      last.status = r.status;
      if (r.status === 404) break;
    } catch (e) { last = e; }
    await new Promise((res) => setTimeout(res, 700 * (i + 1)));
  }
  throw last;
}

async function leagueFromTeam(teamId) {
  const e = await getJSON(`${DRAFT}/entry/${teamId}/public`);
  const entry = e.entry || e;
  const set = entry.league_set || entry.leagues || [];
  const ids = set.map((x) => (typeof x === 'object' ? x.id : x)).filter(Boolean);
  return ids.length ? ids[0] : null;
}

async function owned(leagueId) {
  const s = await getJSON(`${DRAFT}/league/${leagueId}/element-status`);
  let leagueSize = null, name = null;
  try {
    const d = await getJSON(`${DRAFT}/league/${leagueId}/details`);
    leagueSize = (d.league_entries || []).length || null;
    name = d.league && d.league.name;
  } catch (e) { /* optional */ }
  const taken = (s.element_status || []).filter((x) => x.owner).map((x) => x.element);
  return { league: String(leagueId), name, leagueSize, taken };
}

module.exports = async (req, res) => {
  const id = String(req.query.league || req.query.team || '').trim();
  if (!/^\d{1,9}$/.test(id)) return res.status(400).json({ error: 'Enter your Team ID. It is a number, like 123456.' });
  try {
    // First treat the number as a Team ID, then as a league ID.
    let result = null;
    try {
      const leagueId = await leagueFromTeam(id);
      if (leagueId) result = await owned(leagueId);
    } catch (e) {
      if (!(e && e.status === 404)) throw e;
    }
    if (!result) {
      try { result = await owned(id); } catch (e) { if (!(e && e.status === 404)) throw e; }
    }
    if (!result) return res.status(404).json({ error: `Could not find a team or league with the number ${id}. Check the number and try again.` });
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(result);
  } catch (e) {
    return res.status(502).json({ error: 'FPL Draft is not responding right now, so we could not check your league. Try again in a few minutes.', details: String(e && e.message) });
  }
};
