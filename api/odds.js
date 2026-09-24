// Odds part: fetches Premier League odds and turns them into
// win chance, expected goals and clean sheet chance for each team.
// Needs an API key from the-odds-api.com, saved in Vercel as ODDS_API_KEY.
// You don't need to edit this file.

const FPL = 'https://fantasy.premierleague.com/api';

// Odds API team names that don't match FPL names directly
const ALIASES = {
  'manchester city': 'man city',
  'manchester united': 'man utd',
  'tottenham hotspur': 'spurs',
  'nottingham forest': "nott'm forest",
  'wolverhampton wanderers': 'wolves',
  'newcastle united': 'newcastle',
  'brighton and hove albion': 'brighton',
  'west ham united': 'west ham',
  'leeds united': 'leeds',
  'afc bournemouth': 'bournemouth',
  'leicester city': 'leicester',
  'ipswich town': 'ipswich',
  'sheffield united': 'sheffield utd',
  'west bromwich albion': 'west brom',
  'norwich city': 'norwich',
  'coventry city': 'coventry',
  'luton town': 'luton',
};

const norm = (s) =>
  (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

function poissonCdf(k, l) {
  let sum = 0;
  let term = Math.exp(-l);
  for (let i = 0; i <= k; i++) {
    sum += term;
    term *= l / (i + 1);
  }
  return sum;
}

// Total expected goals from the over/under market
function solveTotal(pUnder, line) {
  const k = Math.floor(line);
  let lo = 0.2, hi = 8;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (poissonCdf(k, mid) > pUnder) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function pmf(l, n = 10) {
  const out = [];
  let term = Math.exp(-l);
  for (let i = 0; i <= n; i++) {
    out.push(term);
    term *= l / (i + 1);
  }
  return out;
}

function resultProbs(lh, la) {
  const h = pmf(lh), a = pmf(la);
  let ph = 0, pa = 0;
  for (let i = 0; i < h.length; i++)
    for (let j = 0; j < a.length; j++) {
      if (i > j) ph += h[i] * a[j];
      else if (j > i) pa += h[i] * a[j];
    }
  return { ph, pa };
}

// Split total goals between the teams so win chances match the odds
function splitGoals(total, pHome, pAway) {
  let best = { s: 0.5, err: Infinity };
  for (let s = 0.05; s <= 0.95; s += 0.005) {
    const { ph, pa } = resultProbs(total * s, total * (1 - s));
    const err = (ph - pHome) ** 2 + (pa - pAway) ** 2;
    if (err < best.err) best = { s, err };
  }
  return [total * best.s, total * (1 - best.s)];
}

const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;

module.exports = async (req, res) => {
  const key = process.env.ODDS_API_KEY;
  // Cache for 6 hours so we stay well inside the free plan
  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=43200');
  if (!key) return res.status(200).json({ enabled: false, matches: [] });

  try {
    const [oddsRes, bootRes] = await Promise.all([
      fetch(`https://api.the-odds-api.com/v4/sports/soccer_epl/odds/?regions=uk&markets=h2h,totals&oddsFormat=decimal&apiKey=${key}`),
      fetch(`${FPL}/bootstrap-static/`, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36', Accept: 'application/json' } }),
    ]);
    if (!oddsRes.ok) throw new Error('Odds API returned ' + oddsRes.status);
    const games = await oddsRes.json();
    const boot = await bootRes.json();

    const teams = boot.teams.map((t) => ({ name: norm(t.name), short: t.short_name }));
    const toShort = (oddsName) => {
      const n = norm(oddsName);
      const target = ALIASES[n] || n;
      const t =
        teams.find((x) => x.name === target) ||
        teams.find((x) => target.startsWith(x.name) || x.name.startsWith(target));
      return t ? t.short : null;
    };

    const matches = [];
    for (const g of games) {
      const home = toShort(g.home_team);
      const away = toShort(g.away_team);
      if (!home || !away) continue;

      const hp = [], dp = [], ap = [], unders = [];
      for (const b of g.bookmakers || []) {
        const h2h = (b.markets || []).find((m) => m.key === 'h2h');
        if (h2h) {
          const o = {};
          h2h.outcomes.forEach((x) => (o[x.name] = 1 / x.price));
          const vh = o[g.home_team], va = o[g.away_team], vd = o['Draw'];
          if (vh && va && vd) {
            const sum = vh + va + vd;
            hp.push(vh / sum); ap.push(va / sum); dp.push(vd / sum);
          }
        }
        const tot = (b.markets || []).find((m) => m.key === 'totals');
        if (tot) {
          const over = tot.outcomes.find((x) => x.name === 'Over' && x.point === 2.5);
          const under = tot.outcomes.find((x) => x.name === 'Under' && x.point === 2.5);
          if (over && under) unders.push((1 / under.price) / (1 / under.price + 1 / over.price));
        }
      }
      if (!hp.length) continue;

      const pHome = avg(hp), pAway = avg(ap), pDraw = avg(dp);
      const total = unders.length ? solveTotal(avg(unders), 2.5) : 2.7;
      const [xgHome, xgAway] = splitGoals(total, pHome, pAway);
      const r = (x) => Math.round(x * 100) / 100;
      matches.push({
        home, away, kickoff: g.commence_time,
        pHome: r(pHome), pDraw: r(pDraw), pAway: r(pAway),
        xgHome: r(xgHome), xgAway: r(xgAway),
        csHome: r(Math.exp(-xgAway)), csAway: r(Math.exp(-xgHome)),
      });
    }
    return res.status(200).json({ enabled: true, updated: new Date().toISOString(), matches });
  } catch (e) {
    console.error(e);
    res.setHeader('Cache-Control', 's-maxage=600');
    return res.status(200).json({ enabled: false, matches: [], error: 'Odds unavailable right now.' });
  }
};
