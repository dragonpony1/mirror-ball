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
