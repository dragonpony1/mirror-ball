# Mirror Ball — project guide

Fantasy Dancing with the Stars, salary-cap style. The app is named "Mirror Ball";
the local folder is `dwts-pickem` and the GitHub repo is `mirror-ball`.

Static site (GitHub Pages) + Supabase. The owner is a non-programmer: keep changes small,
explain them in plain language, no build tools, no frameworks.

## Layout
- `index.html` — page shell: header, My lineup / Ballroom / League / Rules tabs, week strip.
- `js/config.js` — Supabase keys, VERSION, season, and the default house rules. The only settings file.
- `js/cast.js` — the 16 season-35 couples, their opening salaries and colors, plus the week/lock math.
- `js/api.js` — all data access. Plain `fetch` against Supabase REST, no SDK.
- `js/app.js` — state and rendering for the four views, plus the commissioner screen.
- `js/rules.js` — pure rules with no DOM or network, so the tests can call the real
  thing instead of a copy of it. `majority()` (who called a prop right) lives here.
- `css/style.css` — the ballroom look. Velvet purple, gold trim, hot pink and teal.
- `supabase/schema.sql` — every table, all prefixed `dwts_`.

## The rules (don't change without asking)
- Build a team of `roster_size` couples (default 5) under `cap` (default $50,000) each week.
- You score the couple's judges' total, out of 30. Add up your team — that's your week.
- Calling the elimination is worth `elim_bonus` (default 10) and costs nothing.
- Everything locks when the show starts: Tuesdays 8pm Eastern, overridable per week.
- A couple eliminated in an earlier week is off the board for good.
- The price you PAY is frozen on the lineup row, so repricing a later week can never
  push an already-saved lineup over the cap.

## The premiere catch-up (v4.9)

Week 1 was a two-night premiere and it locked before night two danced, so
someone joining on Wednesday missed a night that can't be re-run. Rather than
lock them out of week 1 or hand them the whole board after the men's scores were
posted, they play the half that's still to come:

- two of Wednesday's **women**, with **$25,000** — Tuesday's men are off their board
- Wednesday's elimination call only, not both
- **+40 points** for Tuesday, computed in `weekPoints()` and never stored

The numbers are the league's own: the thirteen who played Tuesday carried 2.15
women each and spent an average of $22,700 on them, and banked an average of
45.1 from the men. Nothing about the thirteen changes — no recalculation, no
score rows, no standings shuffle.

"Late joiner" is DERIVED from `dwts_players.created_at` against the dated window
in `config.js` (`CATCHUP_OPENS`/`CATCHUP_CLOSES`), the same way the Mirror Balls
balance is derived — so it can't be granted by hand and a week-eight joiner can
never fall into 40 free points. The window is one evening and then it's history;
`isCatchUpWeek()` stays true forever so their week-1 card still renders right,
while `catchUpOpen()` is what actually lets them pick.

If season 36 opens over two nights again, move the two dates and the season's
own numbers — don't reuse 2026's.

## A prop you write yourself needs the league's OK

Anyone can write a prop — that's the fun — but you could write one you already
know the answer to, stake three balls and collect. So a hand-written prop is a
proposal until `PROP_OKS_NEEDED` (5) people tick it as a fair bet. Until then
NOBODY can bet on it, the author included, and it can never pay. The author's
own tick goes on automatically when they write it, so they need four more.

Props that settle themselves from the scores are exempt — there's no inside
knowledge to have about who topped the night. Anything written before
`PROP_OKS_FROM` is grandfathered; the league had real balls staked on six props
when the rule landed and invalidating those would have been worse than the hole.

A prop the league never backed is INERT, not lost: it can't pay, so it doesn't
cost either. `ballsStaked()` skips stakes on unbacked props deliberately.

## Prop results are voted on, not declared

Anyone can say what happened; the answer with the most votes pays. One vote is a
majority of one so the show keeps moving, but a second person disagreeing makes
it a tie, and a tie pays NOBODY until someone breaks it. That's the guard Matt
asked for: nobody can be wrong on their own.

Votes live in `dwts_propvotes`. The app checks for the table at load and hides
voting entirely if it 404s, falling back to the old `dwts_props.answer` field —
so props settled before voting existed stay settled. If voting ever silently
disappears, that's the fallback firing, not a bug in the UI: check the table.

## Things that will bite you
- **Judges' scores are global**, shared by every league — they're facts about the show.
  A league can set `commish_code` to gate who may type them in; without one, anyone can
  (and every row is stamped with `entered_by`).
- **New tables need a PostgREST cache reload** — `notify pgrst, 'reload schema';` in the
  SQL editor, or the app gets PGRST205 "table not found" even though the table exists.
- **Supabase's SQL editor drops newlines when typed into.** Set the Monaco model directly
  instead: `monaco.editor.getModels()[0].setValue(sql)` in the browser console.
- **GitHub Pages caches ~10 minutes.** Bump `VERSION` in `js/config.js` on every push —
  it shows in the topline and drives the in-app "tap to refresh" nudge.
- `data-elim` (the player's elimination pick) and `data-elimbox` (the commissioner's
  checkbox) are deliberately different attributes. They used to collide.
- Every flex container needs `[hidden]` to still win — there's a global
  `[hidden]{display:none!important}` for exactly that reason.
- Supabase REST writes return EMPTY 200/201 bodies — never call `res.json()` unconditionally.

## Explain the rule, never the strategy

Matt's call, and it's the point of the game: the app says what the rules ARE and
players work out what to do with them. "A week can't earn more than 14" is a rule.
"So you may as well fill your team" is strategy, and writing it down robs the league
of the thing they're here for. Numbers are fine — "up to 14 this week", "you can
spend another $5,600 before that drops" are facts about the rule at this moment.
The tell is a clause starting "so you..." or a comparative judgement (worth it,
better, pointless). He likes the strategies that emerge; don't pre-empt them.

## Conventions
- ES modules, no bundler. Test with `python -m http.server` from this folder
  (there's a `mirrorball` entry in `.claude/launch.json`, port 8765).
- Sentence case, plain words, no jargon in any UI text.
- Times display in the viewer's local zone; only the lock is anchored to Eastern.

## Tests

`node --experimental-vm-modules tests/test-all.mjs` — run before every push (the flag is
needed for the parse check; without it that one test fails and the rest still run). Covers the live-vs-authoritative
score reconcile rule and the shrinking-roster ladder. The workflow runs it too, so a
broken rule fails the scheduled check instead of quietly writing bad scores.

## The update banner always lags one version

Whatever the "a newer version is ready" bar looks like, it is drawn by the code
the phone is ALREADY running — never by the version it is advertising. So a
change to that banner is invisible on the release that introduces it and only
shows up on the NEXT one. Don't chase it as a bug; Matt hit exactly this when
v3.0's glitter didn't appear on the v2.2 -> v3.0 notice.

## Before every push

Bump BOTH `VERSION` in `js/config.js` AND the `?v=` on the stylesheet link in
`index.html` — they must match. The version drives the in-app refresh nudge; the
`?v=` is what actually gets a CSS change past a phone cache.
