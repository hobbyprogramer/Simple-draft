// Looks up which players are owned in one FPL Draft league.
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
module.exports = async (req, res) => {
  const league = String(req.query.league || '').trim();
  if (!/^\d{1,9}$/.test(league)) return res.status(400).json({ error: 'A league ID is a number, like 12345.' });
  try {
    const s = await getJSON(`${DRAFT}/league/${league}/element-status`);
    let leagueSize = null;
    try { leagueSize = ((await getJSON(`${DRAFT}/league/${league}/details`)).league_entries || []).length || null; } catch (e) {}
    const taken = (s.element_status || []).filter((x) => x.owner).map((x) => x.element);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ league, leagueSize, taken });
  } catch (e) {
    if (e && e.status === 404) return res.status(404).json({ error: `League ${league} was not found. Check the number and try again.` });
    return res.status(502).json({ error: 'FPL Draft is not responding right now, so we could not check your league. Try again in a few minutes.', details: String(e && e.message) });
  }
};
