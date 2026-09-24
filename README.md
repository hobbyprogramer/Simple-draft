# Simple Draft

FPL Draft waiver rankings.

## Weekly routine
1. Open `config.json` on GitHub and click the pencil icon (Edit).
2. Change `weekly_note`, `player_adjustments` or `weights`.
3. Click "Commit changes". The website updates itself within a minute.

## player_adjustments
- `name`: the player's short name exactly as in FPL (e.g. "Saka")
- `team`: three-letter team code (e.g. "ARS")
- `boost`: adjustment (e.g. 10 or -15). Adds that many points to the waiver score (0–100)
  and changes projected points on the redraft board by that many percent.
- `comment`: short note shown under the player

Remember commas between entries, and no comma after the last one.

## Payment (later)
Set `"paywall": true` in `config.json` to show the season pass section and lock
everything after the top `free_limit` players. Payment itself is not connected yet.

## Betting odds (optional)
1. Sign up for the free plan at the-odds-api.com and copy your API key.
2. In Vercel: your project → Settings → Environment Variables.
3. Add Name `ODDS_API_KEY` and paste the key as Value. Save.
4. Go to Deployments → the three dots on the newest one → Redeploy.
Without a key the site still works and uses FPL's own fixture difficulty.

## Redraft board
- `vbd_horizon` in `config.json`: how many upcoming matches the projection covers (default 6).
- Value = projected points minus the best player left at that position once every team
  has filled 1 GK, 4 DEF, 4 MID and 2 FWD. Change these numbers in `index.html` (vbd_starters) if needed.
