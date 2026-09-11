// Mirror Ball tests.  Run:  node tests/test-all.mjs
//
// Covers the rules that are easy to break silently and expensive to get wrong:
// how a live score check differs from the authoritative one, and how the team
// shrinks as the ballroom empties.

import { reconcile } from "../scripts/audit-scores.mjs";

let pass = 0, fail = 0;
const is = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${name}`);
  if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
};

console.log("\nreconcile() — live passes only ever ADD");
// Mid-show the page's Result column is still blank. An authoritative pass would
// read that as "not eliminated" and undo a viewer's correct call.
is("live keeps an elimination the page hasn't caught up on",
   reconcile({ score: 24, eliminated: true }, { score: 24, eliminated: false }, true),
   { score: 24, eliminated: true });
is("live keeps a typed score the page hasn't got yet",
   reconcile({ score: 24, eliminated: false }, { score: null, eliminated: false }, true),
   { score: 24, eliminated: false });
is("live still applies a genuine correction",
   reconcile({ score: 19, eliminated: false }, { score: 21, eliminated: false }, true),
   { score: 21, eliminated: false });
is("live still adds an elimination the page confirms",
   reconcile({ score: 24, eliminated: false }, { score: 24, eliminated: true }, true),
   { score: 24, eliminated: true });
is("live fills a row nobody entered",
   reconcile(undefined, { score: 22, eliminated: false }, true),
   { score: 22, eliminated: false });

console.log("\nreconcile() — the morning pass is authoritative both ways");
is("morning pass clears an elimination that didn't happen",
   reconcile({ score: 24, eliminated: true }, { score: 24, eliminated: false }, false),
   { score: 24, eliminated: false });
is("morning pass corrects a mistyped score",
   reconcile({ score: 19, eliminated: false }, { score: 21, eliminated: false }, false),
   { score: 21, eliminated: false });

// The roster rule lives in app.js, which needs a DOM. It's short enough to
// restate here; if you change BENCH or the floor in app.js, change it here too
// and this will tell you what it does to every rung of the ladder.
console.log("\nteam size as the ballroom empties (leave two on the bench)");
const BENCH = 2, BASE = 5;
const rosterFor = alive => alive ? Math.max(2, Math.min(BASE, alive - BENCH)) : BASE;
const playable = alive => alive >= 2;
for (const [alive, want] of [[16, 5], [8, 5], [7, 5], [6, 4], [5, 3], [4, 2], [3, 2], [2, 2]]) {
  is(`${alive} couples left -> pick ${want}`, rosterFor(alive), want);
}
is("1 couple left is not a playable week", playable(1), false);
is("2 couples left is still playable", playable(2), true);

// Mirror Ball economy. It lives in app.js behind a DOM, so the rules are
// restated here — change DOLLARS_PER_BALL or a payout in app.js and you must
// change it here too, and this will tell you what it did to the numbers.
console.log("\nMirror Balls — capped so sitting out cannot out-earn playing");
const DOLLARS_PER_BALL = 1000, PAYS_YESNO = 10, PAYS_COUPLE = 25;
// The most you can bank in a week is whatever is left after the CHEAPEST legal
// team. That is what stops "pick nobody, bank fifty" WITHOUT demanding a full
// team — and requiring a full team was worse, because dropping a couple to swap
// them blew up your balance mid-edit.
const maxBalls = (cap, cheapestTeam) => Math.floor(Math.max(0, cap - cheapestTeam) / DOLLARS_PER_BALL);
const ballsFor = (cap, spent, picked, cheapestTeam) =>
  picked === 0 ? 0 : Math.min(Math.floor(Math.max(0, cap - spent) / DOLLARS_PER_BALL), maxBalls(cap, cheapestTeam));

is("cheapest legal team banks the max, 14",       ballsFor(50000, 36000, 5, 36000), 14);
is("spent the lot, banks nothing",                ballsFor(50000, 50000, 5, 36000), 0);
is("picked nobody banks nothing at all",          ballsFor(50000, 0, 0, 36000), 0);
is("picking ONE cheap couple cannot beat the cap", ballsFor(50000, 6000, 1, 36000), 14);
is("mid-price team banks the difference",         ballsFor(50000, 44000, 5, 36000), 6);
is("a shrunken late-season week scales too",      ballsFor(20000, 14000, 2, 12000), 6);
is("dropping a couple raises the balance, never lowers it",
   ballsFor(50000, 30000, 4, 36000) >= ballsFor(50000, 36000, 5, 36000), true);

console.log("\nprop payouts");
const propPoints = (pays, balls, betAnswer, winners) =>
  (winners && winners.includes(betAnswer) ? pays * balls : 0);
is("one ball on a yes/no",           propPoints(PAYS_YESNO, 1, "yes", ["yes"]), 10);
is("three balls on a yes/no",        propPoints(PAYS_YESNO, 3, "yes", ["yes"]), 30);
is("three balls on a couple pick",   propPoints(PAYS_COUPLE, 3, "dewan", ["dewan"]), 75);
is("a wrong call pays nothing",      propPoints(PAYS_YESNO, 3, "no", ["yes"]), 0);
is("an unsettled prop pays nothing", propPoints(PAYS_YESNO, 3, "yes", null), 0);
is("a tie on top scorer pays anyone who named a tied couple",
   propPoints(PAYS_COUPLE, 1, "shum", ["dewan", "shum"]), 25);

// Props should swing a week, never replace playing properly.
is("a good props week is a swing, not a replacement",
   4 * PAYS_YESNO < (5 * 24) / 2, true);

console.log("\npremiere: did the women out-score the men?");
// Mirrors autoWinners('womenwin'). Must stay unsettled until BOTH nights are in.
const womenWin = (rows) => {
  const avg = n => { const xs = rows.filter(r => r.night === n && r.s != null);
    return xs.length ? xs.reduce((t, r) => t + r.s, 0) / xs.length : null; };
  const w = avg(2), m = avg(1);
  return (w == null || m == null) ? null : (w > m ? "yes" : "no");
};
is("women ahead -> yes", womenWin([{night:1,s:18},{night:2,s:22}]), "yes");
is("men ahead -> no",    womenWin([{night:1,s:24},{night:2,s:20}]), "no");
is("dead level -> no",   womenWin([{night:1,s:20},{night:2,s:20}]), "no");
is("only Tuesday scored: NOT settled yet", womenWin([{night:1,s:18}]), null);
is("only Wednesday scored: NOT settled yet", womenWin([{night:2,s:18}]), null);

console.log("\nyou cannot bet Mirror Balls and then spend the money too");
const balance = (cap, spent, picked, cheapestTeam, staked) =>
  ballsFor(cap, spent, picked, cheapestTeam) - staked;

is("bank 14, stake 4, still 10 spare",             balance(50000, 36000, 5, 36000, 4), 10);
is("stake 4 then upgrade to a $48k team -> short", balance(50000, 48000, 5, 36000, 4) < 0, true);
is("...and short by exactly 2",                    balance(50000, 48000, 5, 36000, 4), -2);
is("spending right up to what you staked is fine", balance(50000, 46000, 5, 36000, 4), 0);
is("dropping someone never puts you short",        balance(50000, 30000, 4, 36000, 4) >= 0, true);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
