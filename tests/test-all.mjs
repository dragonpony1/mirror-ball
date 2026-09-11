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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
