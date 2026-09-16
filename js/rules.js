// Pure rules — no DOM, no network, no state. Anything in here can be imported
// straight into the test suite and checked against real inputs, which is the
// point: these are the decisions that move points around.

// Everyone gets to say what happened and the most-voted answer is the one that
// pays. A single vote is a majority of one, so the game keeps moving during the
// show — but a second person disagreeing makes it 1-1, and a tie is NOT a
// result, so the prop re-opens until someone breaks it. That is the whole
// "in case one person is off" guard: nobody can be wrong on their own.
//
// Returns { answer, tally: [[answer, n], ...], votes, tied }.
// answer is null whenever there's nothing to act on: no votes, or a tie.
export function majority(votes) {
  const counts = new Map();
  for (const v of votes) counts.set(v.answer, (counts.get(v.answer) || 0) + 1);
  const tally = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  const tied = tally.length > 1 && tally[0][1] === tally[1][1];
  return { answer: tied || !tally.length ? null : tally[0][0], tally, votes: votes.length, tied };
}

// ---------- does the league accept this as a fair bet? ----------
// Anyone can write a prop, which is the hole: write one you already know the
// answer to ("will Baker wear the green shirt"), stake three balls, collect.
// So a hand-written prop is only a proposal until enough of the league ticks
// it off. Until then nobody can bet on it — including whoever wrote it.
//
// Not required for props that settle themselves from the judges' scores: there
// is no inside knowledge to have about who topped the night.
//
// `from` grandfathers everything written before the rule existed, so the props
// the league is already betting on this week don't suddenly go invalid. A prop
// with no timestamp at all is grandfathered too: if we can't tell when it was
// written, wrongly BLOCKING a real bet is worse than wrongly allowing one.
//
// Returns { required, bar, ticks, ok, short }.
export function approval({ prop, oks = [], playerCount = 0, needed = 5, from = null }) {
  const required = !!prop && !prop.auto
    && (!from || (!!prop.created_at && new Date(prop.created_at) >= new Date(from)));
  // Never ask for more ticks than there are people, or a small league deadlocks.
  const bar = Math.max(1, Math.min(needed, playerCount || needed));
  const ticks = oks.length;
  return { required, bar, ticks, ok: !required || ticks >= bar, short: Math.max(0, bar - ticks) };
}
