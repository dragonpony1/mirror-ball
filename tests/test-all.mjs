// Mirror Ball tests.  Run:  node tests/test-all.mjs
//
// Covers the rules that are easy to break silently and expensive to get wrong:
// how a live score check differs from the authoritative one, and how the team
// shrinks as the ballroom empties.

import { readFileSync } from "node:fs";
import vm from "node:vm";
import { reconcile } from "../scripts/audit-scores.mjs";
import { majority, approval } from "../js/rules.js";

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

console.log("");
console.log("every source file still parses");
// A stray newline inside a quoted string, or a bad escape, takes the whole app
// down to a blank screen with one console error. Cheap to catch here.
for (const f of ["js/app.js", "js/api.js", "js/cast.js", "js/config.js", "js/rules.js"]) {
  let ok = true, why = "";
  try { new vm.SourceTextModule(readFileSync(new URL("../" + f, import.meta.url), "utf8")); }
  catch (e) { ok = false; why = e.message; }
  is(f + (ok ? "" : " — " + why), ok, true);
}

console.log("");
console.log("salaries reprice themselves off last week");
// Mirrors priceIn(): $250 a point either side of the night average, rounded
// to $100, clamped. Nobody types a salary; this is the whole mechanism.
const reprice = (price, score, avg) => Math.max(4000, Math.min(18000,
  Math.round((price + (score - avg) * 250) / 100) * 100));

is("a couple who matches the average does not move", reprice(10000, 20, 20), 10000);
is("beat the average by 5 -> up $1,250",             reprice(10000, 25, 20), 11300);
is("below the average by 5 -> down $1,250",          reprice(10000, 15, 20), 8800);
is("a cheap couple who smashes it gets dear",        reprice(6000, 28, 19), 8300);
is("never falls below the floor",                    reprice(4200, 5, 25), 4000);
is("never rises above the ceiling",                  reprice(17800, 30, 15), 18000);

console.log("");
console.log("a week opens only when the one before it is FINISHED");
// The premiere scored 8 men on Tuesday with 8 women still to dance. That must
// NOT open week 2 — prices would come from half a week, before any elimination.
const complete = scores => scores.length > 0 && scores.every(s => s != null);
is("half the card scored is not finished", complete([21,20,17,16,null,null,null,null]), false);
is("every couple scored is finished",      complete([21,20,17,16,15,12,10,24]), true);
is("an empty card is not finished",        complete([]), false);
is("one straggler still blocks it",        complete([21,20,17,16,15,12,10,null]), false);

console.log("");
console.log("majority() -- nobody can call a prop wrong on their own");
// Matt: "allow multiple people to enter prop results and take the majority in
// case one person is off." A tie must NOT pay, or the first two voters to
// disagree would hand the win to whoever the sort happened to put first.
const v = (...answers) => answers.map((a, i) => ({ player_id: "p" + i, answer: a }));

is("nobody has voted -> nothing pays",       majority(v()).answer, null);
is("one voice is a majority of one",         majority(v("yes")).answer, "yes");
is("two disagreeing is a tie, so no result", majority(v("yes", "no")).answer, null);
is("...and the tie is flagged",              majority(v("yes", "no")).tied, true);
is("a third breaks the tie",                 majority(v("yes", "no", "no")).answer, "no");
is("the odd one out is outvoted",            majority(v("shum", "shum", "dewan")).answer, "shum");
is("a clear lead among three answers",       majority(v("a", "b", "b", "c")).answer, "b");
is("tied at the TOP blocks it, even with a trailing third",
   majority(v("a", "a", "b", "b", "c")).answer, null);
is("the tally reads biggest-first",          majority(v("a", "b", "b")).tally, [["b", 2], ["a", 1]]);
is("the count is of voters, not answers",    majority(v("a", "b", "b")).votes, 3);

console.log("");
console.log("approval() -- a prop you wrote yourself is only a proposal");
// The exploit: write a prop you already know the answer to, stake three balls,
// collect. Five of the league have to call it a fair bet before anyone can.
const A = (o) => approval({ needed: 5, playerCount: 13, from: "2026-09-16T00:00:00Z", ...o });
const ticks = n => Array.from({ length: n }, (_, i) => ({ player_id: "p" + i }));
const written = { auto: null, created_at: "2026-09-20T00:00:00Z" };

is("a fresh hand-written prop is not live",   A({ prop: written, oks: ticks(0) }).ok, false);
is("four ticks is still not enough",          A({ prop: written, oks: ticks(4) }).ok, false);
is("...and it says how many short",           A({ prop: written, oks: ticks(4) }).short, 1);
is("the fifth tick makes it a real bet",      A({ prop: written, oks: ticks(5) }).ok, true);
is("more than five is fine",                  A({ prop: written, oks: ticks(9) }).ok, true);

// Nothing to know in advance about who topped the night, so no vote needed.
is("a prop that settles itself needs nobody",
   A({ prop: { auto: "top", created_at: "2026-09-20T00:00:00Z" }, oks: ticks(0) }).ok, true);
is("...and it isn't even asked for",
   A({ prop: { auto: "top", created_at: "2026-09-20T00:00:00Z" }, oks: ticks(0) }).required, false);

// The league is mid-week with real balls staked on props written before this
// rule existed. Invalidating those would be worse than the exploit.
is("props written before the rule are grandfathered",
   A({ prop: { auto: null, created_at: "2026-09-11T18:33:12Z" }, oks: ticks(0) }).ok, true);

// A four-person league could never reach five, and the prop would hang forever.
// Only reachable if a stale api.js drops created_at from the select. Blocking
// every real bet would be a far worse night than letting one through.
is("a prop with no timestamp is let through, not blocked",
   A({ prop: { auto: null }, oks: ticks(0) }).ok, true);

is("the bar never exceeds the number of people",
   A({ prop: written, oks: ticks(4), playerCount: 4 }).ok, true);
is("an unloaded league falls back to the full bar",
   A({ prop: written, oks: ticks(4), playerCount: 0 }).ok, false);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
