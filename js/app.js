import { LEAGUE_PASSCODE, VERSION, DEFAULT_CAP, DEFAULT_ROSTER, DEFAULT_ELIM_BONUS, DEFAULT_WINNER_BONUS,
         DOLLARS_PER_BALL, MAX_BALLS_PER_PROP, PAYS_YESNO, PAYS_COUPLE } from "./config.js";
import { CAST, byId, initials, TOTAL_WEEKS, weekLabel, elimSlots } from "./cast.js";
import * as api from "./api.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Minus sign goes outside the dollar sign — "$-19,000" reads like a typo.
const money = n => (n < 0 ? "-$" : "$") + Math.abs(Number(n)).toLocaleString("en-US");

const state = {
  view: "lineup",
  week: 1,
  player: JSON.parse(localStorage.getItem("dwts-player") || "null"),
  league: JSON.parse(localStorage.getItem("dwts-league") || "null"),
  memberships: JSON.parse(localStorage.getItem("dwts-memberships") || "[]"),
  players: [], lineups: [], elimpicks: [],   // this league
  scores: [], prices: [], weeks: [],         // the show itself — shared by every league
  winnerpicks: [],                           // the finale's "who takes the Mirrorball" call
  props: [], propbets: [],                   // prop bets and what people staked on them
  chat: [],
  showJoin: false,
  pendingInvite: null,
  recapPlayer: null,
  showCoach: false,        // a veteran tapped "How this works" to reopen it
  carriedFrom: null,       // week this week's team was inherited from, if any
  commishWeek: null,
  invite: new URLSearchParams(location.search).get("join"),
};

// ---------- boot ----------

(async function boot() {
  makeGlitter();
  $("#tz").textContent = `v${VERSION} · ` + Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, " ");
  bindNav();

  const whenAwake = fn => () => { if (!document.hidden) fn(); };
  checkForUpdate(); setInterval(whenAwake(checkForUpdate), 5 * 60_000);
  setInterval(whenAwake(refreshChat), 30_000);
  setInterval(whenAwake(liveTick), 90_000);
  setInterval(whenAwake(updateTicker), 45_000);
  setTimeout(maybeInstallTip, 2000);
  document.addEventListener("visibilitychange", () => {
    // Stop every animation the moment the app leaves the screen.
    document.body.classList.toggle("asleep", document.hidden);
    if (document.hidden) return;
    liveTick(); updateTicker(); checkForUpdate();
  });

  if (api.isConfigured()) {
    try { await loadShow(); } catch (e) { showError(e); }
    state.week = currentWeek();
    buildWeekStrip();

    // Phones that joined before a league was saved locally.
    if (state.player && !state.league) {
      try {
        const lg = await api.getPlayerLeague(state.player.id);
        if (lg) rememberLeague(lg);
        else { localStorage.removeItem("dwts-player"); state.player = null; }
      } catch (e) { showError(e); }
    }
    if (state.player && state.league && !state.memberships.some(m => m.league.id === state.league.id)) {
      state.memberships.push({ league: state.league, player: state.player });
      saveMemberships();
    }
    if (state.player) {
      const standalone = matchMedia("(display-mode: standalone)").matches || !!navigator.standalone;
      api.touchPlayer(state.player.id, standalone).catch(() => {});
    }
    if (state.invite) await handleInvite();
    if (state.league) {
      const fresh = await api.getLeagueById(state.league.id).catch(() => state.league);
      if (!fresh) dropDeadLeague(state.league.id);
      else { rememberLeague(fresh); await loadLeague().catch(showError); }
    }
  }
  buildWeekStrip();
  render();
})();

// The show's own data: judges' scores, salaries, and week settings.
async function loadShow() {
  const [scores, prices, weeks] = await Promise.all([api.listScores(), api.listPrices(), api.listWeeks()]);
  state.scores = scores || [];
  state.prices = prices || [];
  state.weeks = weeks || [];
}

async function loadLeague() {
  if (!state.league) return;
  const [players, lineups, elims, winners, props, bets] = await Promise.all([
    api.listPlayers(state.league.id),
    api.listAllLineups(state.league.id),
    api.listAllElimPicks(state.league.id),
    api.listWinnerPicks(state.league.id),
    api.listProps(state.league.id),
    api.listPropBets(state.league.id),
  ]);
  state.players = players || [];
  state.lineups = lineups || [];
  state.elimpicks = elims || [];
  state.winnerpicks = winners || [];
  state.props = props || [];
  state.propbets = bets || [];
  render();
  refreshChat();
  maybeCarryForward();
}

async function liveTick() {
  if (!state.league) return;
  try { await loadShow(); await loadLeague(); buildWeekStrip(); } catch {}
}

function showError(e) {
  console.error(e);
  $("#banner").textContent = "Couldn't reach the league just now — check your signal and try again.";
}

// ---------- the show: scores, eliminations, prices ----------

const scoreFor = (week, coupleId) => {
  const r = state.scores.find(s => s.week === week && s.couple_id === coupleId);
  return r && r.score != null ? r.score : null;
};
const elimsIn = week => state.scores.filter(s => s.week === week && s.eliminated).map(s => s.couple_id);
// Out of the competition by the start of `week` — eliminated in any earlier week.
const isOut = (coupleId, week) => state.scores.some(s => s.couple_id === coupleId && s.eliminated && s.week < week);
const activeCast = week => CAST.filter(c => !isOut(c.id, week));
const weekHasResults = week => state.scores.some(s => s.week === week && s.score != null);
const noElimination = week => !!state.weeks.find(w => w.week === week)?.no_elimination;

const priceIn = (coupleId, week) => api.priceOf(coupleId, week, state.prices);
const locked = week => api.isWeekLocked(week, state.weeks);
const lockAt = week => api.lockTime(week, state.weeks);

// The week the app opens on: the first one still taking lineups. Once the
// ballroom is down to the champion there's nothing to pick, so fall through to
// the trophy week, and failing that the last week that actually happened.
function currentWeek() {
  for (let w = 1; w <= TOTAL_WEEKS; w++) if (!locked(w) && weekPlayable(w)) return w;
  const over = trophyWeek();
  if (over) return over;
  for (let w = TOTAL_WEEKS; w >= 1; w--) if (weekHasResults(w)) return w;
  return 1;
}

// The week just past the finale — nobody left to pick, results in the week
// before. Null until the season is actually over.
function trophyWeek() {
  for (let w = 2; w <= TOTAL_WEEKS; w++) {
    if (!weekPlayable(w) && weekHasResults(w - 1)) return w;
  }
  return null;
}

const baseCap = () => state.league?.cap ?? DEFAULT_CAP;
const baseRoster = () => state.league?.roster_size ?? DEFAULT_ROSTER;
const elimBonus = () => state.league?.elim_bonus ?? DEFAULT_ELIM_BONUS;
const winnerBonus = () => state.league?.winner_bonus ?? DEFAULT_WINNER_BONUS;

// The app can't know which week is the last episode in advance — it only works
// that out afterwards from who's left — so the commissioner ticks it.
const isFinale = week => !!state.weeks.find(w => w.week === week)?.is_finale;

// ---------- the shrinking ballroom ----------
//
// A fixed team of 5 stops being a game once the field gets small: with 5
// couples left everyone is forced into the identical team, and with 4 you
// can't field a legal one at all. So the team shrinks with the ballroom —
// you always leave at least two couples unpicked, down to a floor of two.
const BENCH = 2;

function rosterFor(week) {
  const alive = activeCast(week).length;
  if (!alive) return baseRoster();                 // nothing has aired yet
  return Math.max(2, Math.min(baseRoster(), alive - BENCH));
}

// Below two couples there is no team to pick and no game to play — that's the
// week after the finale, when only the champion is left standing. The week
// strip hides those, and the lineup screen shows the trophy instead of a board
// nobody could ever fill.
const weekPlayable = week => activeCast(week).length >= 2;

// A week only takes picks once it's the week actually in play. Running ahead
// used to be allowed and was a genuine exploit: the price you pay is frozen
// onto your pick, so buying next week's couples BEFORE the show reprices them
// bought them at the old, cheaper rate — with no real downside, since an
// eliminated pick could just be dropped and the money spent again.
const pickable = week => !locked(week) && weekPlayable(week) && week === currentWeek();
const stillStanding = () => CAST.filter(c => !state.scores.some(s => s.couple_id === c.id && s.eliminated));

// The cap shrinks with the team, or it stops biting — $50,000 buys the three
// best dancers outright. Never let it fall below what the cheapest legal team
// costs, so a week can't become impossible after a round of repricing.
function capFor(week) {
  const roster = rosterFor(week);
  const perSlot = baseCap() / baseRoster();
  const scaled = roster === baseRoster() ? baseCap() : Math.round(perSlot * roster / 500) * 500;
  const cheapest = activeCast(week).map(c => priceIn(c.id, week)).sort((a, b) => a - b)
    .slice(0, roster).reduce((t, p) => t + p, 0);
  return Math.max(scaled, cheapest);
}

// ---------- Mirror Balls ----------
//
// Every $1,000 of cap you don't spend becomes a ball, but only from a week you
// actually fielded a FULL team in — otherwise picking nobody would bank fifty a
// week. The balance is derived, never stored, so it can't drift out of step
// with the lineups and bets it's calculated from.

const propsIn = week => state.props.filter(p => p.week === week);
const betOn = (playerId, propId) => state.propbets.find(b => b.player_id === playerId && b.prop_id === propId) || null;

// The most anyone could bank in a week: what's left after the cheapest legal
// team. This is what stops "pick nobody and bank fifty" WITHOUT demanding a
// full team — which matters, because requiring one meant dropping a couple to
// swap them blew up your balance mid-edit.
function maxBallsFor(week) {
  const cheapest = activeCast(week).map(c => priceIn(c.id, week)).sort((a, b) => a - b)
    .slice(0, rosterFor(week)).reduce((t, p) => t + p, 0);
  return Math.floor(Math.max(0, capFor(week) - cheapest) / DOLLARS_PER_BALL);
}

function ballsFromWeek(playerId, week) {
  const mine = lineupOf(playerId, week);
  if (!mine.length) return 0;                  // sit a week out entirely, bank nothing
  const spent = mine.reduce((t, l) => t + l.price, 0);
  return Math.min(Math.floor(Math.max(0, capFor(week) - spent) / DOLLARS_PER_BALL), maxBallsFor(week));
}

function ballsEarned(playerId) {
  let n = 0;
  for (let w = 1; w <= TOTAL_WEEKS; w++) n += ballsFromWeek(playerId, w);
  return n;
}

const ballsStaked = playerId =>
  state.propbets.filter(b => b.player_id === playerId).reduce((t, b) => t + (b.balls || 1), 0);

const ballsLeft = playerId => ballsEarned(playerId) - ballsStaked(playerId);

// What the balance WOULD be if this week's team looked different. Balls are
// earned from cap you didn't spend, so upgrading your team after betting can
// strand balls you've already staked — and without this you could bet fourteen,
// then spend the lot, and keep the bets for free.
function ballsLeftIf(playerId, week, spentThen, countThen) {
  let earned = 0;
  for (let w = 1; w <= TOTAL_WEEKS; w++) {
    if (w !== week) { earned += ballsFromWeek(playerId, w); continue; }
    if (!countThen) continue;
    earned += Math.min(Math.floor(Math.max(0, capFor(w) - spentThen) / DOLLARS_PER_BALL), maxBallsFor(w));
  }
  return earned - ballsStaked(playerId);
}

const propPays = prop => prop.pays ?? (prop.kind === "couple" ? PAYS_COUPLE : PAYS_YESNO);

// Some props settle themselves from the judges' scores we already hold, so
// nobody has to rule on them and nobody can argue. Returns the set of answers
// that win — a set, because a tie on "who scored highest" should pay everyone
// who named any of the couples that tied.
function autoWinners(prop) {
  const wk = prop.week;
  if (!weekHasResults(wk)) return null;
  const scored = activeCastPlusEliminated(wk)
    .map(c => ({ id: c.id, s: scoreFor(wk, c.id) })).filter(x => x.s != null);
  if (!scored.length) return null;
  const gone = elimsIn(wk);

  if (prop.auto === "perfect30") return new Set([scored.some(x => x.s === 30) ? "yes" : "no"]);
  if (prop.auto === "top") {
    const best = Math.max(...scored.map(x => x.s));
    return new Set(scored.filter(x => x.s === best).map(x => x.id));
  }
  // Premiere-only: the men danced Tuesday and the women Wednesday, so which
  // night scored better is a real question. Stays unsettled until BOTH nights
  // are in, because a half-scored week would answer it wrongly.
  if (prop.auto === "womenwin") {
    const avg = n => {
      const xs = scored.filter(x => byId(x.id)?.night === n);
      return xs.length ? xs.reduce((t, x) => t + x.s, 0) / xs.length : null;
    };
    const women = avg(2), men = avg(1);
    if (women == null || men == null) return null;
    return new Set([women > men ? "yes" : "no"]);
  }
  if (prop.auto === "lowgoes") {
    const worst = Math.min(...scored.map(x => x.s));
    const lowest = scored.filter(x => x.s === worst).map(x => x.id);
    return new Set([lowest.some(id => gone.includes(id)) ? "yes" : "no"]);
  }
  return null;
}

// null means "not settled yet".
const winningAnswers = prop =>
  prop.auto ? autoWinners(prop) : (prop.answer ? new Set([prop.answer]) : null);

const propSettled = prop => !!winningAnswers(prop);

function propPoints(playerId, prop) {
  const win = winningAnswers(prop);
  if (!win) return 0;
  const bet = betOn(playerId, prop.id);
  if (!bet || !win.has(bet.answer)) return 0;
  return propPays(prop) * (bet.balls || 1);
}

// What the app offers when the commissioner adds a prop. The first three need
// nobody to rule on them at all.
const STARTER_PROPS = [
  { text: "Will anyone score a perfect 30?",            kind: "yesno",  auto: "perfect30" },
  { text: "Will the women out-score the men?",          kind: "yesno",  auto: "womenwin" },
  { text: "Who scores highest tonight?",                kind: "couple", auto: "top" },
  { text: "Will the lowest scorer go home?",            kind: "yesno",  auto: "lowgoes" },
  { text: "Will Carrie Ann mention a lift?",            kind: "yesno",  auto: null },
  { text: "Will the judges give a standing ovation?",   kind: "yesno",  auto: null },
  { text: "Will a celebrity cry?",                      kind: "yesno",  auto: null },
  { text: "Will Bruno get out of his chair?",           kind: "yesno",  auto: null },
  { text: "Will anyone dance shirtless?",               kind: "yesno",  auto: null },
  { text: "Will Julia Stiles wear sequins?",            kind: "yesno",  auto: null },
  { text: "Will Derek mention his own seasons?",        kind: "yesno",  auto: null },
  { text: "Will anyone score below 15?",                kind: "yesno",  auto: null },
  { text: "Whose costume gets talked about most?",      kind: "couple", auto: null },
];

// ---------- scoring ----------

const lineupOf = (playerId, week) => state.lineups.filter(l => l.player_id === playerId && l.week === week);
// A week can take more than one elimination call — the premiere took two, one
// per night — so this is always a list, ordered by slot.
const elimPicksOf = (playerId, week) => state.elimpicks
  .filter(e => e.player_id === playerId && e.week === week)
  .sort((a, b) => (a.slot || 1) - (b.slot || 1));
const elimPickAt = (playerId, week, slot) =>
  state.elimpicks.find(e => e.player_id === playerId && e.week === week && (e.slot || 1) === slot) || null;
const winnerPickOf = playerId => state.winnerpicks.find(w => w.player_id === playerId) || null;

// Who actually took the Mirrorball: the one couple never eliminated. Null until
// the finale's results are in and everyone else has been marked out.
function champion() {
  const left = stillStanding();
  return left.length === 1 ? left[0] : null;
}

function weekPoints(playerId, week) {
  let pts = 0;
  for (const l of lineupOf(playerId, week)) {
    const s = scoreFor(week, l.couple_id);
    if (s != null) pts += s;
  }
  // Prop bets settled for this week.
  for (const prop of propsIn(week)) pts += propPoints(playerId, prop);

  // The last episode's winner call, paid on the finale week.
  if (isFinale(week)) {
    const champ = champion(), pick = winnerPickOf(playerId);
    if (champ && pick && pick.couple_id === champ.id) pts += winnerBonus();
  }
  // Each correct call pays the bonus on its own.
  if (!noElimination(week)) {
    const gone = elimsIn(week);
    for (const ep of elimPicksOf(playerId, week)) {
      if (gone.includes(ep.couple_id)) pts += elimBonus();
    }
  }
  return pts;
}

function seasonPoints(playerId) {
  let pts = 0;
  for (let w = 1; w <= TOTAL_WEEKS; w++) if (weekHasResults(w)) pts += weekPoints(playerId, w);
  return pts;
}

const spentIn = week => lineupOf(state.player?.id, week).reduce((t, l) => t + l.price, 0);

// ---------- carrying a team forward ----------
//
// A lineup doesn't roll over on its own, and a missed week scores zero — which
// in a game where a normal week is worth 100+ points ends someone's season over
// a forgotten Tuesday. So when the new week opens with no team saved, last
// week's is brought across as a starting point: anyone eliminated is dropped,
// this week's prices apply, and anything that no longer fits the cap or the
// roster is left out for you to replace. It is always editable until lock.

// The most recent earlier week this player actually fielded a team in.
function lastPlayedWeek(playerId, before) {
  for (let w = before - 1; w >= 1; w--) if (lineupOf(playerId, w).length) return w;
  return null;
}

function carryList(playerId, fromWeek, toWeek) {
  const roster = rosterFor(toWeek), weekCap = capFor(toWeek);
  const keep = [];
  let spent = 0;
  for (const l of lineupOf(playerId, fromWeek)) {
    if (keep.length >= roster) break;
    if (isOut(l.couple_id, toWeek)) continue;          // they went home
    const price = priceIn(l.couple_id, toWeek);        // this week's salary
    if (spent + price > weekCap) continue;             // priced out since last week
    keep.push({ couple_id: l.couple_id, price });
    spent += price;
  }
  return keep;
}

// Only ever fills the week that's actually open — tapping ahead to week 9 in
// week 3 must not quietly commit a team at week 3's prices.
async function maybeCarryForward() {
  if (!state.player || !state.league) return;
  const week = currentWeek();
  if (!pickable(week)) return;
  if (lineupOf(state.player.id, week).length) return;
  const from = lastPlayedWeek(state.player.id, week);
  if (from == null) return;
  const keep = carryList(state.player.id, from, week);
  if (!keep.length) return;

  try {
    for (const k of keep) {
      await api.addToLineup(state.player.id, state.league.id, week, k.couple_id, k.price);
      state.lineups.push({ player_id: state.player.id, week, couple_id: k.couple_id, price: k.price });
    }
    state.carriedFrom = from;
    state.week = week;
    buildWeekStrip();
    render();
  } catch (e) { console.error("carry-forward failed", e); }
}

// "in 3 days" / "in 2 hours" / "in 14 minutes" — the bit people actually read
// off a deadline. Null once it's passed.
function untilText(date) {
  const ms = date.getTime() - Date.now();
  if (ms <= 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins} minute${mins === 1 ? "" : "s"}`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `in ${hrs} hour${hrs === 1 ? "" : "s"}`;
  const days = Math.round(hrs / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

// Everything this week still wants from you, as short noun phrases that read
// in a list. Empty means you're done.
function stillToDo(week) {
  const me = state.player.id, todo = [];
  if (lineupOf(me, week).length < rosterFor(week)) todo.push("your team");
  if (isFinale(week)) {
    if (!winnerPickOf(me)) todo.push("your winner call");
  } else if (!noElimination(week)) {
    const slots = elimSlots(week);
    const missing = slots.filter(s => !elimPickAt(me, week, s.slot));
    if (missing.length && missing.length === slots.length && slots.length > 1) {
      todo.push("both elimination calls");
    } else {
      for (const s of missing) {
        // "Tuesday — the men" -> "Tuesday's elimination"
        todo.push(s.label ? `${s.label.split(" — ")[0]}'s elimination` : "who goes home");
      }
    }
  }
  return todo;
}

// "a", "a and b", "a, b and c"
function listOut(items) {
  if (items.length <= 1) return items[0] || "";
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

// How many weeks this player has actually put a full team in. Used to decide
// whether they still need the explainer — experience, not the calendar.
function weeksPlayed() {
  if (!state.player) return 0;
  let n = 0;
  for (let w = 1; w <= TOTAL_WEEKS; w++) {
    if (lineupOf(state.player.id, w).length >= rosterFor(w)) n++;
  }
  return n;
}

// What a couple has actually scored so far. This is the most useful thing we
// can put on a card — it turns an abstract price into "is that worth it?",
// and it teaches the scoring without anyone reading the rules.
function formOf(coupleId, week) {
  const past = [];
  for (let w = 1; w < week; w++) {
    const s = scoreFor(w, coupleId);
    if (s != null) past.push(s);
  }
  if (!past.length) return null;
  return {
    last: past[past.length - 1],
    avg: Math.round(past.reduce((a, b) => a + b, 0) / past.length),
  };
}

// The line under a couple's names: their form once they've danced, otherwise
// what they're known for.
function formLine(c, week) {
  const f = formOf(c.id, week);
  return f
    ? `<span class="form">Last time <b>${f.last}</b> · average <b>${f.avg}</b></span>`
    : `<span class="known">${esc(c.known)}</span>`;
}

// ---------- nav ----------

function bindNav() {
  document.querySelectorAll("[data-view]").forEach(b => b.onclick = () => setView(b.dataset.view));
  $("#share").onclick = openShare;
  $("#closemodal").onclick = () => { $("#sharemodal").hidden = true; };
  $("#closecommish").onclick = () => { $("#commishmodal").hidden = true; };
  $("#sendinvite").onclick = shareInvite;
  $("#a2hs").onclick = addToHomeScreen;
  $("#signout").onclick = () => {
    if (!confirm("Sign out of Mirror Ball on this phone?")) return;
    localStorage.removeItem("dwts-player"); localStorage.removeItem("dwts-league");
    state.player = null; state.league = null; render();
  };
  $("#who").onclick = () => { state.showJoin = true; setView("lineup"); };
  $("#ticker").onclick = () => setView("league");
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredPrompt = e; });
  window.addEventListener("resize", measureHeader);
}

// The cap meter sticks just below the header, so the header's real height has
// to be a CSS variable — it changes with the league name and the week strip.
function measureHeader() {
  const h = document.querySelector("header")?.getBoundingClientRect().height;
  if (h) document.documentElement.style.setProperty("--headerH", `${Math.round(h)}px`);
}

function setView(v) {
  state.view = v;
  state.recapPlayer = null;
  $("#banner").textContent = "";
  document.querySelectorAll("[data-view]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === v)));
  render();
}

function buildWeekStrip() {
  const box = $("#weeks");
  box.innerHTML = "";
  for (let w = 1; w <= TOTAL_WEEKS; w++) {
    // Weeks past the finale have nobody left to pick; don't offer them at all
    // unless they somehow carry results.
    if (!weekPlayable(w) && !weekHasResults(w)) continue;
    const b = document.createElement("button");
    b.textContent = w === 1 ? "Wk 1 ✨" : `Wk ${w}`;
    if (weekHasResults(w)) b.classList.add("done");
    b.setAttribute("aria-pressed", String(w === state.week));
    b.onclick = () => { state.week = w; buildWeekStrip(); render(); };
    box.appendChild(b);
  }
  // One last chip for the trophy, so the season has an ending you can tap.
  const over = trophyWeek();
  if (over) {
    const b = document.createElement("button");
    b.textContent = "🏆 Final";
    b.classList.add("done");
    b.setAttribute("aria-pressed", String(over === state.week));
    b.onclick = () => { state.week = over; buildWeekStrip(); render(); };
    box.appendChild(b);
  }
}

// ---------- render ----------

function render() {
  const signedIn = state.player && state.league;
  $("#who").hidden = !signedIn;
  $("#signout").hidden = !signedIn;
  if (signedIn) $("#who").textContent = `${state.league.icon || "🪩"} ${state.league.name} · ${state.player.name} ▾`;

  if (!api.isConfigured()) {
    $("#content").innerHTML = `<p class="empty">The app isn't connected to its database yet.</p>`;
    return;
  }
  if (!signedIn || state.showJoin) return renderJoin();

  // "Week 12" means nothing on the trophy screen — there was no week 12.
  $("#range").textContent = state.week === trophyWeek() ? "🏆 Final" : weekLabel(state.week);
  if (state.view === "lineup") renderLineup();
  else if (state.view === "props") renderProps();
  else if (state.view === "ballroom") renderBallroom();
  else if (state.view === "league") renderLeague();
  else renderRules();
  measureHeader();
}

// ---------- my lineup ----------

function renderLineup() {
  const week = state.week, isLocked = locked(week);
  const mine = lineupOf(state.player.id, week);
  const roster = rosterFor(week), weekCap = capFor(week);
  const spent = mine.reduce((t, l) => t + l.price, 0);
  const left = weekCap - spent;
  const full = mine.length >= roster;

  // Eliminations happen after you've already built next week's team, so a saved
  // lineup can wake up holding couples who went home, or be bigger than the
  // week now allows. Say so plainly rather than quietly dropping anyone.
  const dead = mine.filter(l => isOut(l.couple_id, week));
  const overSize = Math.max(0, mine.length - roster);

  const when = lockAt(week).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  let html = "";

  // Season over: no board, just the champion and where everyone finished.
  if (!weekPlayable(week)) {
    const champs = stillStanding();
    const table = state.players.map(p => ({ p, pts: seasonPoints(p.id) }))
      .sort((a, b) => b.pts - a.pts);
    $("#content").innerHTML = `<div class="join" style="text-align:center">
      <div style="font-size:3rem">🏆</div>
      <h2 style="margin:6px 0">${champs.length === 1
        ? `${esc(champs[0].celeb)} and ${esc(champs[0].pro)} win the Mirrorball`
        : "That's the season"}</h2>
      <p class="hint">Nothing left to pick — the ballroom's empty. Here's how it finished.</p>
      ${(() => {
        const champ = champion();
        if (!champ) return "";
        const called = state.players.filter(p => winnerPickOf(p.id)?.couple_id === champ.id);
        if (!state.winnerpicks.length) return "";
        return `<p class="hint">🏆 ${called.length
          ? `Called it: <b>${called.map(p => esc(p.name)).join(", ")}</b> — ${winnerBonus()} points each.`
          : "Nobody called the winner."}</p>`;
      })()}
      ${table.length ? `<table class="standings" style="text-align:left;margin-top:12px">
        ${table.map((r, i) => `<tr class="${r.p.id === state.player.id ? "me" : ""}">
          <td class="pos">${i === 0 ? "🥇" : i + 1}</td>
          <td>${esc(r.p.name)}${r.p.id === state.player.id ? " (you)" : ""}</td>
          <td class="pts">${r.pts}</td></tr>`).join("")}
      </table>` : ""}
      <p class="hint" style="margin-top:14px">Tap back through the weeks to see how it played out.</p>
    </div>`;
    measureHeader();
    return;
  }

  // Not locked, but not this week's business either. Show the board so people
  // can plan, but nothing is buyable — see `pickable` for why.
  if (!isLocked && !pickable(week)) {
    const open = currentWeek();
    html += `<div class="notopen">
      <b>Week ${week} isn't open yet</b>
      <span>It opens once week ${week - 1}'s show is done. Prices move after every show — a couple who dances well gets dearer — so these are only a guess at what they'll cost.</span>
      <span style="margin-top:6px">Week ${open} is the one to pick right now. <button type="button" class="linkbtn" id="gonow">Take me there</button></span>
    </div>`;
    html += `<h2>Who's still dancing</h2><div class="slots">`;
    for (const c of activeCast(week).slice().sort((a, b) => priceIn(b.id, week) - priceIn(a.id, week))) {
      html += `<div class="slot filled" style="opacity:.72">
        ${medallionHtml(c)}
        <span class="cnames"><span class="celeb">${esc(c.celeb)}</span><span class="pro">with ${esc(c.pro)}</span>
          ${formLine(c, week)}</span>
        <span class="price">${money(priceIn(c.id, week))}<small>for now</small></span>
      </div>`;
    }
    html += `</div>`;
    $("#content").innerHTML = html;
    if ($("#gonow")) $("#gonow").onclick = () => { state.week = open; buildWeekStrip(); render(); };
    measureHeader();
    return;
  }

  if (isLocked) {
    html += `<p class="hint"><span class="pill locked">Locked</span> Lineups closed ${esc(when)}.</p>`;
    html += lockedLineupHtml(week);
  } else {
    // What's still affordable, and whether the team can even be finished —
    // it's easy to spend big early and strand yourself with slots you can't fill.
    const slotsLeft = roster - mine.length;
    const available = activeCast(week).filter(c => !mine.some(l => l.couple_id === c.id))
      .map(c => priceIn(c.id, week)).sort((a, b) => a - b);
    const cheapestFill = available.slice(0, slotsLeft).reduce((t, p) => t + p, 0);
    const stuck = slotsLeft > 0 && (available.length < slotsLeft || cheapestFill > left);

    html += `<div class="capwrap ${spent > weekCap ? "over" : full && !overSize ? "full" : ""}">
      <div class="capline">
        <b>${money(left)}</b>
        <span class="right">left to spend<br>${mine.length} of ${roster} couple${roster === 1 ? "" : "s"}</span>
      </div>
      <div class="capbar"><span style="width:${Math.min(100, (spent / weekCap) * 100).toFixed(1)}%"></span></div>
      ${dead.length ? `<p class="hint" style="margin:7px 0 0"><b style="color:var(--bad)">${
        dead.map(l => esc(byId(l.couple_id).celeb)).join(" and ")} went home — drop ${dead.length === 1 ? "them" : "both"} and pick again.</b></p>` : ""}
      ${overSize ? `<p class="hint" style="margin:7px 0 0"><b style="color:var(--bad)">Only ${roster} couples this week — drop ${overSize} more.</b></p>` : ""}
      ${!dead.length && !overSize && slotsLeft > 0 ? `<p class="hint" style="margin:7px 0 0">${
        stuck ? `<b style="color:var(--bad)">You can't fill the rest of your team at these prices — drop someone.</b>`
              : `Up to ${money(Math.floor(left / slotsLeft))} a slot if you spread it evenly.`}</p>` : ""}
    </div>`;

    // The "you're done" moment. Picking five couples and getting no
    // acknowledgement leaves people wondering whether it saved at all, and the
    // lock time is the one thing they'll want to check again later.
    if (full && !overSize && !dead.length) {
      const todo = stillToDo(week);
      const until = untilText(lockAt(week));
      html += `<div class="teamin ${todo.length ? "partial" : ""}">
        <b>${todo.length ? `Team in — still need ${listOut(todo)}` : `✓ You're all set for ${weekLabel(week)}`}</b>
        <span>${mine.length} couple${mine.length === 1 ? "" : "s"} · ${money(spent)} spent${
          left > 0 ? ` · ${money(left)} unspent` : ""}</span>
        <span class="lockline">🔒 Locks ${esc(when)}${until ? ` — ${until}` : ""}. Change it as often as you like until then.</span>
      </div>`;
    }

    // Once the ballroom empties the rules quietly change, so say it out loud.
    if (roster < baseRoster()) {
      html += `<p class="hint">Only ${activeCast(week).length} couples are left, so teams are down to <b>${roster}</b> this week and the cap is <b>${money(weekCap)}</b>. You always leave at least two on the bench.</p>`;
    }

    // An empty team is exactly when someone needs telling what this is. It
    // disappears the moment they pick anyone, and comes back if they clear out.
    //
    // It also steps aside once YOU have built a couple of full teams — not on a
    // date. Someone joining in week 6 needs it as much as anyone did in week 1,
    // and a veteran who keeps seeing it learns to scroll past banners, which is
    // how the warnings that matter get missed. The link stays forever.
    if (!mine.length && weeksPlayed() >= 2 && !state.showCoach) {
      html += `<p class="hint"><button type="button" class="linkbtn" id="showcoach">How this works</button></p>`;
    } else if (!mine.length) {
      html += `<div class="coach">
        <b>How this works</b>
        <ol>
          <li>Pick <b>${roster} couples</b> below. Better dancers cost more, and ${money(weekCap)} isn't enough for ${roster} of the best — that's the game.</li>
          <li>The judges score each couple <b>out of 30</b>. You get whatever they get. Your ${roster} added together is your week.</li>
          <li>Then call <b>who goes home</b>${elimSlots(week).length > 1
            ? ` — <b>two calls</b> premiere week, one for Tuesday's men and one for Wednesday's women. ${elimBonus()} points each`
            : ` for ${elimBonus()} bonus points`}. It's free and doesn't use your budget.</li>
        </ol>
        <span class="hint">A cheap couple who dances well is worth more to you than an expensive one who's safe.</span>
      </div>`;
    }
    // Say loudly that this team was inherited, or someone will assume they
    // already made their choices and never look at it.
    if (state.carriedFrom != null && state.carriedFrom < week && mine.length) {
      const short = roster - mine.length;
      html += `<div class="carried">
        <b>This is your week ${state.carriedFrom} team, carried over.</b>
        ${short > 0 ? `${short} slot${short === 1 ? "" : "s"} to fill — someone went home or priced out of your budget. ` : ""}Change anything you like before it locks.
      </div>`;
    }
    if (!full || overSize || dead.length) {
      html += `<p class="hint">🔒 Locks ${esc(when)} — change your team as many times as you like until then.</p>`;
    }

    // The slots. Always draw every couple actually on the team, even if that's
    // more than this week allows — an over-size lineup you can't see is one you
    // can't fix.
    html += `<div class="slots">`;
    for (let i = 0; i < Math.max(roster, mine.length); i++) {
      const l = mine[i];
      if (!l) { html += `<div class="slot">Empty slot — pick a couple below</div>`; continue; }
      const c = byId(l.couple_id);
      const gone = isOut(c.id, week);
      html += `<div class="slot filled ${gone || i >= roster ? "bad" : ""}">
        ${medallionHtml(c)}
        <span class="cnames"><span class="celeb">${esc(c.celeb)}</span><span class="pro">with ${esc(c.pro)}</span>
          ${gone ? `<span class="gonehome">went home</span>` : i >= roster ? `<span class="gonehome">over the limit</span>` : ""}</span>
        <span class="price">${money(l.price)}</span>
        <button class="xbtn" data-drop="${esc(c.id)}" aria-label="Drop ${esc(c.celeb)}">✕</button>
      </div>`;
    }
    html += `</div>`;

    // The last episode swaps the elimination call for the big one: everybody
    // but the champion goes home, so "who goes home" is meaningless and "who
    // wins" is the only question left.
    if (isFinale(week)) {
      const pick = winnerPickOf(state.player.id);
      html += `<h2>🏆 Who takes the Mirrorball?</h2>
        <p class="hint">Last episode. Call the winner for <b>${winnerBonus()} points</b> — free, doesn't touch your budget, and it's the last call of the season.${
          pick ? "" : " Nobody's picked yet."}</p>
        <div class="slots">`;
      for (const c of activeCast(week)) {
        const on = pick?.couple_id === c.id;
        html += `<button class="couple ${on ? "picked" : ""}" data-winner="${esc(c.id)}">
          ${medallionHtml(c)}
          <span class="cnames"><span class="celeb">${esc(c.celeb)}</span><span class="pro">with ${esc(c.pro)}</span>
            ${formLine(c, week)}</span>
          <span class="price">${on ? `🏆<small>your call</small>` : ""}</span>
        </button>`;
      }
      html += `</div>`;
    } else if (!noElimination(week)) {
      const slots = elimSlots(week);
      html += `<h2>🏠 Who goes home?</h2>`;
      html += slots.length > 1
        ? `<p class="hint">Two couples go home premiere week — <b>one Tuesday, one Wednesday</b>. Make both calls. Each is worth ${elimBonus()} points on its own, and neither costs a cent of your budget.</p>`
        : `<p class="hint">Call the elimination and take ${elimBonus()} bonus points. One pick, and it doesn't cost a cent.</p>`;

      for (const s of slots) {
        const picked = elimPickAt(state.player.id, week, s.slot);
        const pool = activeCast(week).filter(c => s.night == null || c.night === s.night);
        if (!pool.length) continue;

        if (s.label) {
          html += `<h3 class="elimhead">${esc(s.label)}
            <span class="${picked ? "ok" : "todo"}">${picked
              ? `✓ you picked ${esc(byId(picked.couple_id).celeb)}`
              : "pick one"}</span></h3>`;
        }
        html += `<div class="slots">`;
        for (const c of pool) {
          const on = picked?.couple_id === c.id;
          html += `<button class="couple ${on ? "picked" : ""}" data-elim="${esc(c.id)}" data-slot="${s.slot}">
            ${medallionHtml(c)}
            <span class="cnames"><span class="celeb">${esc(c.celeb)}</span><span class="pro">with ${esc(c.pro)}</span>
              ${formLine(c, week)}</span>
            <span class="price">${on ? `🏠<small>your pick</small>` : ""}</span>
          </button>`;
        }
        html += `</div>`;
      }
    }

    // the cast
    html += `<h2>The ballroom — week ${week}</h2>`;
    // Named `board`, not `roster` — a second `const roster` in this block would
    // shadow the team size declared above and put every earlier use of it in a
    // temporal dead zone, which is exactly the bug this replaced.
    const board = activeCast(week).slice().sort((a, b) => priceIn(b.id, week) - priceIn(a.id, week));
    html += `<div class="slots">`;
    for (const c of board) {
      const price = priceIn(c.id, week);
      const on = mine.some(l => l.couple_id === c.id);
      const tooPricey = !on && price > left;
      const blocked = !on && (full || tooPricey);
      html += `<button class="couple ${on ? "picked" : ""} ${tooPricey ? "toopricey" : ""}" data-add="${esc(c.id)}" ${blocked ? "disabled" : ""}>
        ${medallionHtml(c)}
        <span class="cnames">
          <span class="celeb">${esc(c.celeb)}</span>
          <span class="pro">with ${esc(c.pro)}</span>
          ${formLine(c, week)}
        </span>
        <span class="price">${money(price)}<small>${on ? "on your team" : tooPricey ? "over budget" : full ? "team full" : "tap to add"}</small></span>
      </button>`;
    }
    html += `</div>`;
  }

  $("#content").innerHTML = html;

  if ($("#showcoach")) $("#showcoach").onclick = () => { state.showCoach = true; render(); };
  $("#content").querySelectorAll("[data-add]").forEach(b => b.onclick = () => addCouple(b.dataset.add));
  $("#content").querySelectorAll("[data-drop]").forEach(b => b.onclick = () => dropCouple(b.dataset.drop));
  $("#content").querySelectorAll("[data-elim]").forEach(b =>
    b.onclick = () => pickElim(b.dataset.elim, Number(b.dataset.slot) || 1));
  $("#content").querySelectorAll("[data-winner]").forEach(b =>
    b.onclick = () => pickWinner(b.dataset.winner));
}

function medallionHtml(c) {
  return `<span class="medallion" style="background:linear-gradient(145deg,${c.color},${shade(c.color, -35)})">${esc(initials(c))}</span>`;
}

// darken/lighten a #rrggbb by an amount, for the medallion's gradient
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const p = i => Math.max(0, Math.min(255, ((n >> i) & 255) + amt));
  return `#${((1 << 24) + (p(16) << 16) + (p(8) << 8) + p(0)).toString(16).slice(1)}`;
}

async function addCouple(id) {
  const week = state.week;
  if (!pickable(week)) return;
  const mine = lineupOf(state.player.id, week);
  if (mine.some(l => l.couple_id === id)) return;
  if (mine.length >= rosterFor(week)) { $("#banner").textContent = `Your team is full — drop someone first.`; return; }
  const price = priceIn(id, week);
  const spent = mine.reduce((t, l) => t + l.price, 0);
  if (spent + price > capFor(week)) { $("#banner").textContent = `That puts you ${money(spent + price - capFor(week))} over the cap.`; return; }
  const shortAfter = ballsLeftIf(state.player.id, week, spent + price, mine.length + 1);
  if (shortAfter < 0) {
    $("#banner").textContent = `Spending that much would leave you ${-shortAfter} Mirror Ball${shortAfter === -1 ? "" : "s"} short of what you've already staked. Take a prop bet back first, or pick someone cheaper.`;
    return;
  }

  // Optimistic: the card lights up straight away, then the write goes out.
  state.lineups.push({ player_id: state.player.id, week, couple_id: id, price });
  render();
  try {
    await api.addToLineup(state.player.id, state.league.id, week, id, price);
    if (lineupOf(state.player.id, week).length === rosterFor(week)) { confetti(); $("#banner").textContent = "Team's set. Good luck. 🪩"; }
  } catch (e) {
    state.lineups = state.lineups.filter(l => !(l.player_id === state.player.id && l.week === week && l.couple_id === id));
    render(); showError(e);
  }
}

async function dropCouple(id) {
  const week = state.week;
  if (!pickable(week)) return;
  const removed = state.lineups.find(l => l.player_id === state.player.id && l.week === week && l.couple_id === id);
  state.lineups = state.lineups.filter(l => !(l.player_id === state.player.id && l.week === week && l.couple_id === id));
  render();
  try { await api.removeFromLineup(state.player.id, week, id); }
  catch (e) { if (removed) state.lineups.push(removed); render(); showError(e); }
}

async function pickWinner(id) {
  const week = state.week;
  if (!pickable(week)) return;
  const prev = winnerPickOf(state.player.id);
  state.winnerpicks = state.winnerpicks.filter(w => w.player_id !== state.player.id);
  state.winnerpicks.push({ player_id: state.player.id, couple_id: id });
  render();
  try { await api.saveWinnerPick(state.player.id, state.league.id, id); }
  catch (e) {
    state.winnerpicks = state.winnerpicks.filter(w => w.player_id !== state.player.id);
    if (prev) state.winnerpicks.push(prev);
    render(); showError(e);
  }
}

async function pickElim(id, slot = 1) {
  const week = state.week;
  if (!pickable(week)) return;
  const prev = elimPickAt(state.player.id, week, slot);
  const mineAt = e => e.player_id === state.player.id && e.week === week && (e.slot || 1) === slot;
  state.elimpicks = state.elimpicks.filter(e => !mineAt(e));
  state.elimpicks.push({ player_id: state.player.id, week, slot, couple_id: id });
  render();
  try { await api.saveElimPick(state.player.id, state.league.id, week, slot, id); }
  catch (e) {
    state.elimpicks = state.elimpicks.filter(e2 => !mineAt(e2));
    if (prev) state.elimpicks.push(prev);
    render(); showError(e);
  }
}

// After lock: your team with live scores, then everyone else's.
function lockedLineupHtml(week) {
  const me = state.player.id;
  let html = teamCardHtml(me, week, true);
  const others = state.players.filter(p => p.id !== me && lineupOf(p.id, week).length);
  if (others.length) {
    html += `<h2>Everyone else</h2>`;
    for (const p of others.sort((a, b) => weekPoints(b.id, week) - weekPoints(a.id, week))) {
      html += teamCardHtml(p.id, week, false);
    }
  }
  return html;
}

function teamCardHtml(playerId, week, isMe) {
  const p = state.players.find(x => x.id === playerId);
  const mine = lineupOf(playerId, week);
  if (!mine.length) return isMe ? `<p class="empty">You didn't get a lineup in for ${weekLabel(week)}.</p>` : "";
  const eps = elimPicksOf(playerId, week);

  let html = `<h2>${isMe ? "Your team" : esc(p?.name || "Player")} · ${weekPoints(playerId, week)} pts</h2><div class="slots">`;
  for (const l of mine) {
    const c = byId(l.couple_id);
    const s = scoreFor(week, l.couple_id);
    const gone = elimsIn(week).includes(l.couple_id);
    html += `<div class="slot filled">
      ${medallionHtml(c)}
      <span class="cnames"><span class="celeb">${esc(c.celeb)}</span><span class="pro">with ${esc(c.pro)}</span>
        ${gone ? `<span class="gonehome">went home</span>` : ""}</span>
      ${s == null
        ? `<span class="price"><small>hasn't danced</small></span>`
        : `<span class="scorepill ${s === 30 ? "perfect" : ""}">${s}<small>out of 30</small></span>`}
    </div>`;
  }
  html += `</div>`;
  if (isFinale(week)) {
    const pick = winnerPickOf(playerId), champ = champion();
    if (pick) {
      const c = byId(pick.couple_id);
      html += `<p class="hint">🏆 Called ${esc(c.celeb)} for the Mirrorball — ${
        !champ ? "still to be decided."
        : pick.couple_id === champ.id ? `<b style="color:var(--good)">right, +${winnerBonus()}</b>.`
        : `<span style="color:var(--bad)">it went to ${esc(champ.celeb)}</span>.`}</p>`;
    }
  }
  for (const ep of eps) {
    const c = byId(ep.couple_id);
    const right = elimsIn(week).includes(ep.couple_id);
    html += `<p class="hint">🏠 Called ${esc(c.celeb)} to go home — ${
      noElimination(week) ? "no elimination this week, so no bonus for anyone."
      : right ? `<b style="color:var(--good)">right, +${elimBonus()}</b>.`
      : weekHasResults(week) ? `<span style="color:var(--bad)">not this time</span>.` : "still to come."}</p>`;
  }
  return html;
}

// ---------- props ----------

function renderProps() {
  const week = state.week, me = state.player.id;
  const list = propsIn(week);
  const left = ballsLeft(me), earned = ballsEarned(me);
  const open = pickable(week);

  let html = `<div class="balls">
    <b>🪩 ${left}</b>
    <span>Mirror Ball${left === 1 ? "" : "s"} to spend${earned !== left ? ` · ${earned} earned all season` : ""}</span>
    <span class="hint" style="margin:5px 0 0">Every ${money(DOLLARS_PER_BALL)} of cap you don't spend becomes one, as long as you fielded a full team that week. They never expire.</span>
  </div>`;

  if (!list.length) {
    html += `<p class="empty">No prop bets for ${weekLabel(week)} yet.<br>Anyone can add them — they're the side game.</p>`;
  }

  for (const prop of list) {
    const bet = betOn(me, prop.id);
    const win = winningAnswers(prop);
    const pays = propPays(prop);
    const won = win && bet && win.has(bet.answer);
    const options = prop.kind === "couple"
      ? activeCastPlusEliminated(week).map(c => ({ v: c.id, label: c.celeb }))
      : [{ v: "yes", label: "Yes" }, { v: "no", label: "No" }];

    html += `<div class="prop ${win ? (bet ? (won ? "won" : "lost") : "done") : ""}">
      <div class="proptop">
        <b>${esc(prop.text)}</b>
        <span class="pays">${pays}<small>a ball</small></span>
      </div>
      ${prop.auto ? `<span class="tag auto">settles itself from the scores</span>` : ""}
      <div class="propopts">
        ${options.map(o => `<button type="button" class="opt ${bet?.answer === o.v ? "on" : ""} ${win && win.has(o.v) ? "right" : ""}"
          data-prop="${esc(prop.id)}" data-answer="${esc(o.v)}" ${win || !open ? "disabled" : ""}>${esc(o.label)}</button>`).join("")}
      </div>
      ${bet && !win && open ? `<div class="stake">
        <span>Balls on it:</span>
        ${[1, 2, 3].slice(0, MAX_BALLS_PER_PROP).map(n => `<button type="button" class="stakeball ${bet.balls === n ? "on" : ""}"
          data-stake="${esc(prop.id)}" data-balls="${n}" ${n > bet.balls + left ? "disabled" : ""}>${n}</button>`).join("")}
        <span class="worth">${pays * bet.balls} if right</span>
        <button type="button" class="linkbtn" data-pull="${esc(prop.id)}">take it back</button>
      </div>` : ""}
      ${win ? `<p class="hint" style="margin:6px 0 0">${
          bet ? (won ? `<b style="color:var(--good)">You had ${esc(labelFor(prop, bet.answer))} for ${bet.balls} — <b>+${pays * bet.balls}</b></b>`
                     : `<span style="color:var(--bad)">You had ${esc(labelFor(prop, bet.answer))}. It was ${esc([...win].map(a => labelFor(prop, a)).join(" / "))}.</span>`)
               : `Answer: <b>${esc([...win].map(a => labelFor(prop, a)).join(" / "))}</b>. You sat this one out.`}
        ${prop.settled_by ? ` <span class="at">— called by ${esc(prop.settled_by)}</span>` : ""}</p>` : ""}
      ${!win && !bet && open ? `<p class="hint" style="margin:6px 0 0">Costs 1 🪩 to enter. Raise your stake after.</p>` : ""}
      ${!win && !open ? `<p class="hint" style="margin:6px 0 0">${locked(week) ? "Locked — waiting on the show." : "Opens when the week does."}</p>` : ""}
    </div>`;
  }

  html += `<div class="row" style="margin-top:16px">
    <button class="ghost" id="addprop">＋ Add a prop bet</button>
    ${list.some(p => !p.auto && !p.answer) && locked(week) ? `<button class="ghost" id="settleprops">Call the results</button>` : ""}
  </div>`;

  $("#content").innerHTML = html;
  $("#content").querySelectorAll("[data-prop]").forEach(b =>
    b.onclick = () => placeBet(b.dataset.prop, b.dataset.answer));
  $("#content").querySelectorAll("[data-stake]").forEach(b =>
    b.onclick = () => restake(b.dataset.stake, Number(b.dataset.balls)));
  $("#content").querySelectorAll("[data-pull]").forEach(b =>
    b.onclick = () => pullBet(b.dataset.pull));
  if ($("#addprop")) $("#addprop").onclick = openPropEditor;
  if ($("#settleprops")) $("#settleprops").onclick = openSettle;
}

const labelFor = (prop, answer) =>
  prop.kind === "couple" ? (byId(answer)?.celeb || answer) : (answer === "yes" ? "Yes" : "No");

async function placeBet(propId, answer) {
  const me = state.player.id;
  const existing = betOn(me, propId);
  if (!existing && ballsLeft(me) < 1) {
    $("#banner").textContent = "No Mirror Balls left — you earn them by not spending your whole cap.";
    return;
  }
  const balls = existing?.balls || 1;
  const prev = existing ? { ...existing } : null;
  state.propbets = state.propbets.filter(b => !(b.player_id === me && b.prop_id === propId));
  state.propbets.push({ player_id: me, prop_id: propId, answer, balls });
  render();
  try { await api.savePropBet(me, state.league.id, propId, answer, balls); }
  catch (e) {
    state.propbets = state.propbets.filter(b => !(b.player_id === me && b.prop_id === propId));
    if (prev) state.propbets.push(prev);
    render(); showError(e);
  }
}

async function restake(propId, balls) {
  const me = state.player.id;
  const bet = betOn(me, propId);
  if (!bet) return;
  if (balls > bet.balls + ballsLeft(me)) { $("#banner").textContent = "Not enough Mirror Balls for that."; return; }
  const prev = { ...bet };
  bet.balls = balls;
  render();
  try { await api.savePropBet(me, state.league.id, propId, bet.answer, balls); }
  catch (e) { Object.assign(bet, prev); render(); showError(e); }
}

async function pullBet(propId) {
  const me = state.player.id;
  const prev = betOn(me, propId);
  state.propbets = state.propbets.filter(b => !(b.player_id === me && b.prop_id === propId));
  render();
  try { await api.clearPropBet(me, propId); }
  catch (e) { if (prev) state.propbets.push(prev); render(); showError(e); }
}

// ---------- ballroom (the show's results) ----------

function renderBallroom() {
  const week = state.week;
  const scored = activeCastPlusEliminated(week).map(c => ({ c, s: scoreFor(week, c.id) }));
  const any = scored.some(x => x.s != null);

  let html = `<div class="row" style="justify-content:space-between">
    <h2 style="margin:4px 0">${weekLabel(week)} scores</h2>
    <button class="ghost" id="openCommish">📝 Enter scores</button>
  </div>`;

  if (!any) {
    html += `<p class="empty">No scores in for ${weekLabel(week)} yet.<br>They go in right after the show — anyone in the league can add them.</p>`;
  } else {
    const ranked = scored.slice().sort((a, b) => (b.s ?? -1) - (a.s ?? -1));
    html += `<div class="slots">`;
    for (const { c, s } of ranked) {
      const gone = elimsIn(week).includes(c.id);
      const owners = state.players.filter(p => lineupOf(p.id, week).some(l => l.couple_id === c.id));
      html += `<div class="slot filled">
        ${medallionHtml(c)}
        <span class="cnames"><span class="celeb">${esc(c.celeb)}</span><span class="pro">with ${esc(c.pro)}</span>
          ${gone ? `<span class="gonehome">went home</span>` : ""}
          ${owners.length ? `<span class="known">on ${owners.map(o => esc(o.name)).join(", ")}'s team</span>` : `<span class="known">nobody had them</span>`}</span>
        ${s == null ? `<span class="price"><small>no score</small></span>`
          : s === 30 ? `<span class="paddles"><span class="paddle ten">10</span><span class="paddle ten">10</span><span class="paddle ten">10</span></span>`
          : `<span class="scorepill">${s}<small>out of 30</small></span>`}
      </div>`;
    }
    html += `</div>`;
    const stamp = state.scores.find(s => s.week === week && s.entered_by);
    if (stamp) html += `<p class="hint">Scores entered by ${esc(stamp.entered_by)} · ${new Date(stamp.updated_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. Anyone can fix a typo.</p>`;
  }

  // who's already out
  const out = CAST.filter(c => isOut(c.id, week));
  if (out.length) {
    html += `<h2>Out of the running</h2><p class="hint">${out.map(c => esc(c.celeb)).join(" · ")}</p>`;
  }

  $("#content").innerHTML = html;
  $("#openCommish").onclick = () => openCommish(week);
}

// Everyone who danced in that week: still in, plus whoever was eliminated that night.
function activeCastPlusEliminated(week) {
  return CAST.filter(c => !isOut(c.id, week));
}

// ---------- league: standings + chat ----------

function renderLeague() {
  const lg = state.league;
  let html = `<div class="join" style="text-align:center">
    ${lg.icon_url ? `<img src="${esc(lg.icon_url)}" alt="" style="width:92px;height:92px;object-fit:cover;border-radius:50%;border:2px solid var(--gold)">`
      : `<div style="font-size:3rem">${esc(lg.icon || "🪩")}</div>`}
    <h2 style="margin:8px 0 2px">${esc(lg.name)}</h2>
    <p class="hint">${state.players.length} ${state.players.length === 1 ? "player" : "players"} · ${money(baseCap())} cap · ${baseRoster()} couples a week</p>
    <label class="linkbtn" style="display:inline-block;cursor:pointer">Change league photo<input type="file" accept="image/*" id="pic" hidden></label>
  </div>`;

  // Who's behind. Only shown when it matters — chasing people to refresh is a
  // real job when eight of you need the same rules on a Tuesday night.
  const behind = state.players.filter(p => (p.app_version || "") !== VERSION);
  if (behind.length) {
    html += `<div class="notopen" style="margin-top:14px">
      <b>${behind.length} ${behind.length === 1 ? "person is" : "people are"} on an old version</b>
      <span>${behind.map(p => `${esc(p.name)} <i>(${p.app_version ? "v" + esc(p.app_version) : "not opened yet"})</i>`).join(" · ")}</span>
      <span style="margin-top:6px">They'll get a glittery “tap to refresh” bar next time they open it. Everyone else is on v${esc(VERSION)}.</span>
    </div>`;
  }

  html += `<h2>Standings</h2>${standingsHtml()}`;
  if (state.recapPlayer) html += recapHtml(state.recapPlayer);

  html += `<h2>League chat</h2>
    <div class="chat">
      <div class="chatlog" id="chatlog"></div>
      <form class="chatform" id="chatform">
        <input name="body" maxlength="300" placeholder="Say something…" autocomplete="off">
        <button type="submit">Send</button>
      </form>
    </div>`;

  $("#content").innerHTML = html;
  $("#pic").onchange = uploadLeaguePhoto;
  $("#chatform").onsubmit = onChat;
  $("#content").querySelectorAll("[data-player]").forEach(tr => tr.onclick = () => {
    state.recapPlayer = state.recapPlayer === tr.dataset.player ? null : tr.dataset.player;
    render();
  });
  drawChat();
}

function standingsHtml() {
  if (!state.players.length) return `<p class="empty">Nobody's joined yet.</p>`;
  const rows = state.players.map(p => ({
    p, season: seasonPoints(p.id), thisWeek: weekPoints(p.id, state.week),
  })).sort((a, b) => b.season - a.season || b.thisWeek - a.thisWeek || a.p.name.localeCompare(b.p.name));

  return `<table class="standings">
    <tr><th></th><th>Player</th><th style="text-align:right">Wk ${state.week}</th><th style="text-align:right">Season</th></tr>
    ${rows.map((r, i) => `<tr data-player="${esc(r.p.id)}" class="${r.p.id === state.player.id ? "me" : ""}">
      <td class="pos">${i + 1}</td>
      <td>${esc(r.p.name)}${r.p.id === state.player.id ? " (you)" : ""}</td>
      <td style="text-align:right">${r.thisWeek || "—"}</td>
      <td class="pts">${r.season}</td>
    </tr>`).join("")}
  </table>
  <p class="hint">Tap a name to see their week.</p>`;
}

function recapHtml(pid) {
  const p = state.players.find(x => x.id === pid);
  const week = state.week;
  const mine = lineupOf(pid, week);
  if (!mine.length) return `<div class="recap">${esc(p?.name)} didn't enter a lineup for ${weekLabel(week)}.</div>`;
  if (!locked(week) && pid !== state.player.id) return `<div class="recap">${esc(p?.name)}'s lineup is hidden until ${weekLabel(week)} locks.</div>`;

  return `<div class="recap"><b>${esc(p?.name)} — ${weekLabel(week)}</b><ul>
    ${mine.map(l => {
      const c = byId(l.couple_id), s = scoreFor(week, l.couple_id);
      return `<li>${s == null ? "·" : s === 30 ? "🏆" : "✓"} ${esc(c.celeb)} — ${s == null ? "yet to dance" : `${s} pts`}</li>`;
    }).join("")}
    ${isFinale(week) && winnerPickOf(pid) ? (() => {
      const pick = winnerPickOf(pid), champ = champion();
      return `<li>🏆 ${esc(byId(pick.couple_id).celeb)} for the win — ${
        !champ ? "pending" : pick.couple_id === champ.id ? `right, +${winnerBonus()}` : "missed"}</li>`;
    })() : ""}
    ${elimPicksOf(pid, week).map(ep => `<li>🏠 ${esc(byId(ep.couple_id).celeb)} — ${
      noElimination(week) ? "no elimination" :
      elimsIn(week).includes(ep.couple_id) ? `right, +${elimBonus()}` :
      weekHasResults(week) ? "missed" : "pending"}</li>`).join("")}
  </ul><b>${weekPoints(pid, week)} points</b></div>`;
}

// ---------- rules ----------

function renderRules() {
  $("#content").innerHTML = `
  <h2>How it works</h2>
  <div class="join">
    <p class="hint" style="font-size:.9rem">
      <b>Build a team of ${baseRoster()} couples</b> every week for ${money(baseCap())} or less. The good dancers cost more.
    </p>
    <p class="hint" style="font-size:.9rem">
      <b>You score what the judges score.</b> Each couple is marked out of 30 by the three judges. Add up your ${baseRoster()} couples — that's your week.
    </p>
    <p class="hint" style="font-size:.9rem">
      <b>Call the elimination for ${elimBonus()} bonus points.</b> One free pick a week: who's going home. It costs nothing and it's worth about a whole dance.
    </p>
    <p class="hint" style="font-size:.9rem">
      <b>Everything locks when the show starts</b> — Tuesdays at 8pm Eastern. After that you can see everyone's team.
    </p>
    <p class="hint" style="font-size:.9rem">
      <b>A new team every week.</b> Nobody is stuck with a bad draft. Prices move as the season goes, so this week's bargain won't stay cheap.
    </p>
    <p class="hint" style="font-size:.9rem">
      <b>Once a couple is eliminated</b> they're off the board — you can't pick them again.
    </p>
    <p class="hint" style="font-size:.9rem">
      <b>Teams shrink as the ballroom empties.</b> You always leave at least two couples
      unpicked, so there's always a real choice. With 7 or more still dancing that's a team
      of ${baseRoster()}; at 6 it's 4, at 5 it's 3, and from 4 down it's 2. The cap comes
      down with it, about ${money(Math.round(baseCap() / baseRoster()))} a slot.
    </p>
    <p class="hint" style="font-size:.9rem">
      <b>Your team carries over.</b> When a new week opens, last week's team is already there —
      minus anyone who went home, and minus anyone you can no longer afford. Change it as much
      as you like before it locks. You're never caught out with an empty team.
    </p>
    <p class="hint" style="font-size:.9rem">
      <b>Money you don't spend isn't wasted.</b> Every ${money(DOLLARS_PER_BALL)} of cap left over
      becomes a 🪩 <b>Mirror Ball</b> — as long as you fielded a full team that week. They never
      expire, so you can hoard them.
    </p>
    <p class="hint" style="font-size:.9rem">
      <b>Spend Mirror Balls on prop bets.</b> Side bets on the night: <i>will anyone score a 30,
      will Carrie Ann mention a lift, who tops the leaderboard.</i> Stake 1 to ${MAX_BALLS_PER_PROP}
      balls on any one. A yes/no pays <b>${PAYS_YESNO} a ball</b>; naming a couple is much harder
      and pays <b>${PAYS_COUPLE} a ball</b>. Wrong and you lose the balls, not points.
    </p>
    <p class="hint" style="font-size:.9rem">
      <b>Anyone can add a prop</b>, and some settle themselves straight off the judges' scores.
      The rest someone taps yes or no after the show, same as the scores.
    </p>
    <p class="hint" style="font-size:.9rem">
      <b>You can't buy next week's couples early.</b> A week only opens for picking once the
      previous show is done — otherwise you'd be buying people before their price moved.
    </p>
    <p class="hint" style="font-size:.9rem">
      <b>The last episode is different.</b> Instead of calling who goes home, you call
      <b>who takes the Mirrorball</b> — worth ${winnerBonus()} points, free, on top of your
      normal team that night. Everyone's watching anyway, and it's the last call of the season.
    </p>
    <p class="hint" style="font-size:.9rem">
      <b>Points add up all season.</b> Every week's score goes on your total; nothing resets.
      <b>The winner</b> is whoever has the most when the finale is done.
    </p>
  </div>
  <h2>An example week</h2>
  <div class="join">
    <p class="hint" style="font-size:.9rem">Two people, same ${money(baseCap())}, very different teams. Say the judges score the night like this:</p>
    <table class="standings" style="margin-bottom:10px">
      <tr><th>You picked</th><th style="text-align:right">Cost</th><th style="text-align:right">Judges</th></tr>
      <tr><td>Jenna Dewan</td><td style="text-align:right">$14,500</td><td class="pts">26</td></tr>
      <tr><td>Harry Shum Jr.</td><td style="text-align:right">$14,000</td><td class="pts">25</td></tr>
      <tr><td>Sarah Jane Nader</td><td style="text-align:right">$8,000</td><td class="pts">17</td></tr>
      <tr><td>Conner Leavitt</td><td style="text-align:right">$7,500</td><td class="pts">16</td></tr>
      <tr><td>Guillermo Rodriguez</td><td style="text-align:right">$6,000</td><td class="pts">18</td></tr>
      <tr><td><b>Total</b></td><td style="text-align:right"><b>$50,000</b></td><td class="pts"><b>102</b></td></tr>
    </table>
    <p class="hint" style="font-size:.9rem">Your brother spread his money around instead — Julia Stiles, Amber Glenn, Jackson Olson, Connor Wood, Giada — and they scored 21, 22, 20, 15, 14. <b>That's 92.</b></p>
    <p class="hint" style="font-size:.9rem">You win the week by 10 — because Guillermo scored 18 for only $6,000, and those savings bought you Jenna Dewan.</p>
    <p class="hint" style="font-size:.9rem">Unless your brother called the elimination and you didn't. Then it's 102 to 102.</p>
  </div>

  <h2>Who types in the scores?</h2>
  <p class="hint">Anyone in the league. After the show, go to <b>Ballroom → Enter scores</b> and type each couple's total out of 30 and tick whoever went home. Your name gets stamped on it, and anyone can fix a typo. A check runs the next morning against the official scores and quietly fixes any slips.</p>`;
}

// ---------- writing and settling props ----------

function openPropEditor() {
  const week = state.week;
  const used = new Set(propsIn(week).map(p => p.text));
  $("#commish").innerHTML = `
    <h2>Add a prop bet — ${weekLabel(week)}</h2>
    <p class="hint">Anyone can add one. The first three settle themselves from the judges' scores, so nobody has to rule on them.</p>
    <div id="starters">
      ${STARTER_PROPS.filter(p => !used.has(p.text)).map((p, i) => `<button type="button" class="leaguebtn" data-starter="${i}">
        ${esc(p.text)}
        <small>${p.auto ? "⚡ settles itself" : "someone taps yes/no after the show"} · pays ${p.kind === "couple" ? PAYS_COUPLE : PAYS_YESNO} a ball</small>
      </button>`).join("") || `<p class="hint">All the ready-made ones are already up this week.</p>`}
    </div>
    <hr>
    <h2>Or write your own</h2>
    <label>The bet<input id="ptext" maxlength="90" autocomplete="off" placeholder="Will anyone trip?"></label>
    <label>Answered with<select id="pkind">
      <option value="yesno">Yes or no — pays ${PAYS_YESNO} a ball</option>
      <option value="couple">Naming a couple — pays ${PAYS_COUPLE} a ball</option>
    </select></label>
    <button class="big" id="savemyprop">Add it</button>
    <p class="hint" id="propmsg"></p>`;
  $("#commishmodal").hidden = false;

  $("#commish").querySelectorAll("[data-starter]").forEach(b => b.onclick = () => {
    const pick = STARTER_PROPS.filter(p => !used.has(p.text))[Number(b.dataset.starter)];
    createProp(pick.text, pick.kind, pick.auto);
  });
  $("#savemyprop").onclick = () => {
    const text = $("#ptext").value.trim();
    if (!text) { $("#propmsg").textContent = "Give it some words first."; return; }
    createProp(text, $("#pkind").value, null);
  };
}

async function createProp(text, kind, auto) {
  try {
    const row = await api.addProp(state.league.id, state.week, {
      text, kind, auto, pays: kind === "couple" ? PAYS_COUPLE : PAYS_YESNO,
    });
    state.props.push(row);
    $("#commishmodal").hidden = true;
    render();
    $("#banner").textContent = `"${text}" is up for ${weekLabel(state.week)}.`;
  } catch (e) { $("#propmsg").textContent = "Couldn't add that one."; console.error(e); }
}

// Only the props a person has to rule on; the automatic ones never appear here.
function openSettle() {
  const week = state.week;
  const manual = propsIn(week).filter(p => !p.auto);
  $("#commish").innerHTML = `
    <h2>Call the results — ${weekLabel(week)}</h2>
    <p class="hint">Anyone can settle these. Your name goes on it, and it can be changed if you get it wrong.</p>
    ${manual.map(p => {
      const opts = p.kind === "couple"
        ? activeCastPlusEliminated(week).map(c => ({ v: c.id, label: c.celeb }))
        : [{ v: "yes", label: "Yes" }, { v: "no", label: "No" }];
      return `<div class="prop" style="margin-bottom:10px">
        <b>${esc(p.text)}</b>
        <div class="propopts" style="margin-top:7px">
          ${opts.map(o => `<button type="button" class="opt ${p.answer === o.v ? "on" : ""}"
            data-settle="${esc(p.id)}" data-ans="${esc(o.v)}">${esc(o.label)}</button>`).join("")}
        </div>
        <p class="hint" style="margin:6px 0 0"><button type="button" class="linkbtn" data-killprop="${esc(p.id)}">remove this prop</button></p>
      </div>`;
    }).join("") || `<p class="hint">Nothing here needs a human — they all settle themselves.</p>`}
    <button class="linkbtn" id="doneSettle" style="margin-top:10px">Done</button>`;
  $("#commishmodal").hidden = false;

  $("#commish").querySelectorAll("[data-settle]").forEach(b => b.onclick = async () => {
    const prop = state.props.find(p => p.id === b.dataset.settle);
    const prev = prop.answer;
    prop.answer = b.dataset.ans; prop.settled_by = state.player.name;
    openSettle();
    try { await api.settleProp(prop.id, prop.answer, state.player.name); render(); }
    catch (e) { prop.answer = prev; openSettle(); showError(e); }
  });
  $("#commish").querySelectorAll("[data-killprop]").forEach(b => b.onclick = async () => {
    if (!confirm("Remove this prop and everyone's bets on it?")) return;
    const id = b.dataset.killprop;
    try {
      await api.removeProp(id);
      state.props = state.props.filter(p => p.id !== id);
      state.propbets = state.propbets.filter(x => x.prop_id !== id);
      openSettle(); render();
    } catch (e) { showError(e); }
  });
  $("#doneSettle").onclick = () => { $("#commishmodal").hidden = true; render(); };
}

// ---------- commissioner: scores + salaries ----------

function openCommish(week) {
  state.commishWeek = week;
  drawCommish();
  $("#commishmodal").hidden = false;
}

function drawCommish() {
  const week = state.commishWeek;
  const roster = activeCastPlusEliminated(week);
  const wk = state.weeks.find(w => w.week === week) || {};
  const needCode = !!state.league?.commish_code;

  $("#commish").innerHTML = `
    <h2>${weekLabel(week)} scores</h2>
    <p class="hint">Type each couple's judges' total out of 30 — or out of 40 on a guest-judge week. Leave a box empty if they haven't danced. Tick whoever went home.</p>
    ${needCode ? `<label>Commissioner code<input id="ccode" autocomplete="off" placeholder="required for this league"></label>` : ""}
    <label class="elim" style="display:flex;gap:6px;align-items:center;margin:12px 0 6px">
      <input type="checkbox" id="noelim" ${wk.no_elimination ? "checked" : ""} style="width:auto">
      <span style="font-weight:600;color:var(--ink)">No elimination this week</span>
    </label>
    <label class="elim" style="display:flex;gap:6px;align-items:center;margin:0 0 12px">
      <input type="checkbox" id="isfinale" ${wk.is_finale ? "checked" : ""} style="width:auto">
      <span style="font-weight:600;color:var(--ink)">This is the last episode &mdash; swap the elimination call for &ldquo;who wins the Mirrorball&rdquo;</span>
    </label>
    <div id="scorerows">
      ${roster.map(c => {
        const r = state.scores.find(s => s.week === week && s.couple_id === c.id) || {};
        return `<div class="scorerow">
          ${medallionHtml(c)}
          <span class="cnames" style="flex:1"><span class="celeb">${esc(c.celeb)}</span><span class="pro">${esc(c.pro)}</span></span>
          <input type="number" min="0" max="40" step="1" data-score="${esc(c.id)}" value="${r.score ?? ""}" placeholder="—" inputmode="numeric">
          <label class="elim"><input type="checkbox" data-elimbox="${esc(c.id)}" ${r.eliminated ? "checked" : ""}> home</label>
        </div>`;
      }).join("")}
    </div>
    <button class="big" id="savescores">Save the scores</button>
    <p class="hint" id="commishmsg"></p>
    <hr>
    <h2>Salaries for week ${week + 1}</h2>
    <p class="hint">Optional. Raise the ones who killed it, drop the ones who didn't — it keeps the cap interesting.</p>
    <div class="row"><button class="ghost" id="suggest">✨ Suggest from week ${week}</button>
      <button class="ghost" id="saveprices">Save salaries</button></div>
    <div id="pricerows" style="margin-top:10px">
      ${activeCastPlusEliminated(week + 1).map(c => `<div class="scorerow">
        ${medallionHtml(c)}
        <span class="cnames" style="flex:1"><span class="celeb">${esc(c.celeb)}</span></span>
        <input type="number" min="1000" max="30000" step="100" data-price="${esc(c.id)}" value="${priceIn(c.id, week + 1)}" inputmode="numeric">
      </div>`).join("")}
    </div>`;

  $("#savescores").onclick = saveScores;
  $("#suggest").onclick = suggestPrices;
  $("#saveprices").onclick = savePrices;
}

function commishOk() {
  const need = state.league?.commish_code;
  if (!need) return true;
  const got = ($("#ccode")?.value || "").trim().toLowerCase();
  if (got === String(need).trim().toLowerCase()) return true;
  $("#commishmsg").textContent = "That commissioner code doesn't match.";
  return false;
}

async function saveScores() {
  if (!commishOk()) return;
  const week = state.commishWeek;
  const box = $("#commish");   // everything below is scoped to the modal
  const rows = [];
  box.querySelectorAll("[data-score]").forEach(inp => {
    const id = inp.dataset.score;
    const raw = inp.value.trim();
    const elim = box.querySelector(`[data-elimbox="${CSS.escape(id)}"]`)?.checked || false;
    let score = raw === "" ? null : Math.round(Number(raw));
    if (score != null && (!Number.isFinite(score) || score < 0 || score > 40)) score = null;
    if (raw === "" && !elim) return; // nothing to say about this couple yet
    rows.push({ week, couple_id: id, score, eliminated: elim, entered_by: state.player.name });
  });

  $("#commishmsg").textContent = "Saving…";
  try {
    await api.saveScores(rows);
    await api.saveWeek(week, {
      no_elimination: $("#noelim").checked,
      is_finale: $("#isfinale").checked,
      results_in: rows.some(r => r.score != null),
    });
    await loadShow();
    buildWeekStrip();
    $("#commishmodal").hidden = true;
    render();
    if (rows.some(r => r.score === 30)) confetti();
    $("#banner").textContent = `${weekLabel(week)} scores are in — standings updated.`;
  } catch (e) { $("#commishmsg").textContent = "Couldn't save — check your signal."; console.error(e); }
}

// A couple who beat the room gets more expensive next week; a couple who
// flopped gets cheaper. $250 a point either side of the night's average.
function suggestPrices() {
  const week = state.commishWeek;
  const scored = activeCastPlusEliminated(week).map(c => ({ c, s: scoreFor(week, c.id) })).filter(x => x.s != null);
  if (!scored.length) { $("#commishmsg").textContent = "Enter this week's scores first."; return; }
  const avg = scored.reduce((t, x) => t + x.s, 0) / scored.length;
  for (const { c, s } of scored) {
    const inp = $("#commish").querySelector(`[data-price="${CSS.escape(c.id)}"]`);
    if (!inp) continue;
    const next = priceIn(c.id, week) + (s - avg) * 250;
    inp.value = Math.max(4000, Math.min(18000, Math.round(next / 100) * 100));
  }
  $("#commishmsg").textContent = "Suggested — tweak anything, then Save salaries.";
}

async function savePrices() {
  if (!commishOk()) return;
  const week = state.commishWeek + 1;
  const rows = [];
  $("#commish").querySelectorAll("[data-price]").forEach(inp => {
    const price = Math.round(Number(inp.value));
    if (Number.isFinite(price) && price > 0) rows.push({ week, couple_id: inp.dataset.price, price });
  });
  $("#commishmsg").textContent = "Saving…";
  try {
    await api.savePrices(rows);
    await loadShow();
    render();
    $("#commishmsg").textContent = `Week ${week} salaries saved.`;
  } catch (e) { $("#commishmsg").textContent = "Couldn't save the salaries."; console.error(e); }
}

// ---------- join / leagues ----------

function renderJoin() {
  const mine = state.memberships.filter(m => !state.league || m.league.id !== state.league.id);

  if (state.pendingInvite) {
    const lg = state.pendingInvite;
    $("#content").innerHTML = `<form class="join" id="invite">
      <h2>${esc(lg.icon || "🪩")} ${esc(lg.name)}</h2>
      <p class="hint">You've been invited to a Dancing with the Stars fantasy league. Add your name and you're in.</p>
      <label>Your name<input name="name" required autocomplete="off" placeholder="Matt"></label>
      <button type="submit">Join ${esc(lg.name)}</button>
      <p class="hint"><button type="button" class="linkbtn" id="notthis">Not this league?</button></p>
    </form>`;
    $("#notthis").onclick = () => { state.pendingInvite = null; render(); };
    $("#invite").onsubmit = async e => {
      e.preventDefault();
      const name = new FormData(e.target).get("name").trim();
      if (!name) return;
      try { state.pendingInvite = null; await joinLeague(lg, name); }
      catch (err) { state.pendingInvite = lg; showError(err); }
    };
    return;
  }

  $("#content").innerHTML = `
  ${state.player && state.league ? `<p class="hint"><button type="button" class="linkbtn" id="back">← Back to ${esc(state.league.name)}</button> &nbsp;·&nbsp; <button type="button" class="linkbtn" id="renameme">Change my name</button></p>` : `
  <div class="join" style="text-align:center">
    <div style="font-size:2.6rem">🪩</div>
    <h2 style="margin:6px 0">Fantasy Dancing with the Stars</h2>
    <p class="hint">Build a team of ${DEFAULT_ROSTER} couples under a salary cap. You score whatever the judges score. New team every week.</p>
  </div>`}
  ${mine.length ? `<div class="join"><h2>Your leagues</h2>
    ${mine.map(m => `<button type="button" class="leaguebtn" data-league="${esc(m.league.id)}">${esc(m.league.icon || "🪩")} ${esc(m.league.name)}<small>as ${esc(m.player.name)} — tap to switch</small></button>`).join("")}
  </div>` : ""}
  <form class="join" id="join">
    <h2>Join a league</h2>
    <label>Your name<input name="name" required autocomplete="off" placeholder="Matt"></label>
    <label>League passcode<input name="code" required autocomplete="off"></label>
    <button type="submit">Join</button>
    <p class="hint">Use the same name every week so your points stay together.</p>
    <p class="hint">Don't have one? <button type="button" class="linkbtn" id="showcreate">Start a new league</button></p>
    <p class="hint">Been here before? <button type="button" class="linkbtn" id="showfind">Find my leagues</button></p>
  </form>
  <form class="join" id="findme" hidden>
    <h2>Find my leagues</h2>
    <label>The name you play under<input name="name" required autocomplete="off"></label>
    <label>Any passcode you have<input name="code" required autocomplete="off"></label>
    <button type="submit">Find them</button>
  </form>
  <form class="join" id="create" hidden>
    <h2>Start a new league</h2>
    <label>League name<input name="lname" required autocomplete="off" placeholder="The Brimhalls"></label>
    <label>Your name<input name="yourname" required autocomplete="off" placeholder="Matt"></label>
    <label>Passcode everyone will type<input name="code" required autocomplete="off" placeholder="mirrorball"></label>
    <label>League emoji<input name="icon" maxlength="12" autocomplete="off" placeholder="🪩"></label>
    <label>Salary cap<select name="cap">
      <option value="50000">$50,000 — you can't afford all the ringers</option>
      <option value="60000">$60,000 — roomier</option>
      <option value="42000">$42,000 — tight, forces bargains</option>
    </select></label>
    <label>Couples per team<select name="roster">
      <option value="5">5 couples</option>
      <option value="4">4 couples</option>
      <option value="6">6 couples</option>
    </select></label>
    <label>Bonus for calling the elimination<select name="bonus">
      <option value="10">10 points</option>
      <option value="15">15 points</option>
      <option value="0">No bonus</option>
    </select></label>
    <label>Last episode — bonus for calling the winner<select name="winbonus">
      <option value="50">50 points — enough to decide a close season</option>
      <option value="100">100 points — a whole week's worth, big swing</option>
      <option value="25">25 points — a nice touch, won't change much</option>
      <option value="0">No winner bonus</option>
    </select></label>
    <label>Commissioner code (optional)<input name="commish" autocomplete="off" placeholder="leave blank so anyone can enter scores"></label>
    <button type="submit">Start it</button>
  </form>`;

  if ($("#back")) $("#back").onclick = () => { state.showJoin = false; render(); };
  if ($("#renameme")) $("#renameme").onclick = renameMe;
  $("#showcreate").onclick = () => { $("#create").hidden = false; $("#join").hidden = true; $("#findme").hidden = true; };
  $("#showfind").onclick = () => { $("#findme").hidden = false; $("#join").hidden = true; };
  $("#content").querySelectorAll("[data-league]").forEach(b => b.onclick = () => {
    const m = state.memberships.find(x => x.league.id === b.dataset.league);
    if (m) switchLeague(m);
  });

  $("#join").onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const name = f.get("name").trim(), code = normCode(f.get("code"));
    if (!name || !code) return;
    try {
      const lg = await api.getLeague(code);
      if (!lg) { $("#banner").textContent = "No league with that passcode."; return; }
      await joinLeague(lg, name);
    } catch (err) { showError(err); }
  };

  $("#findme").onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const name = f.get("name").trim();
    try {
      const rows = await api.findPlayerLeagues(name);
      if (!rows.length) { $("#banner").textContent = "Couldn't find that name in any league."; return; }
      state.memberships = rows.filter(r => r.dwts_leagues).map(r => ({ league: r.dwts_leagues, player: { id: r.id, name: r.name } }));
      saveMemberships();
      const first = state.memberships[0];
      if (first) await switchLeague(first);
      $("#banner").textContent = `Found ${state.memberships.length} league${state.memberships.length === 1 ? "" : "s"}.`;
    } catch (err) { showError(err); }
  };

  $("#create").onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const code = normCode(f.get("code"));
    const you = (f.get("yourname") || "").trim();
    if (!code || !you) return;
    try {
      if (await api.getLeague(code)) { $("#banner").textContent = "That passcode is taken — pick another."; return; }
      const lg = await api.createLeague({
        name: f.get("lname").trim(), passcode: code,
        icon: iconTrim(f.get("icon")) || "🪩",
        cap: +f.get("cap"), roster_size: +f.get("roster"), elim_bonus: +f.get("bonus"),
        winner_bonus: +f.get("winbonus"),
        commish_code: (f.get("commish") || "").trim() || null,
      });
      await joinLeague(lg, you);
      confetti();
    } catch (err) { showError(err); }
  };
}

function iconTrim(s) {
  const t = String(s || "").trim();
  return t ? [...t][0] : "";
}

async function renameMe() {
  const name = prompt("What should the league call you?", state.player.name);
  if (!name || !name.trim()) return;
  try {
    await api.renamePlayer(state.player.id, name.trim());
    state.player.name = name.trim();
    localStorage.setItem("dwts-player", JSON.stringify(state.player));
    state.memberships = state.memberships.map(m => m.player.id === state.player.id ? { ...m, player: state.player } : m);
    saveMemberships();
    await loadLeague();
  } catch (e) { showError(e); }
}

async function joinLeague(league, name) {
  const player = await api.getOrCreatePlayer(name, league.id);
  state.player = player;
  // Stamp them straight away. Without this, someone who joins and picks a team
  // in one sitting shows as "never opened" until their second visit.
  const standalone = matchMedia("(display-mode: standalone)").matches || !!navigator.standalone;
  api.touchPlayer(player.id, standalone).catch(() => {});
  localStorage.setItem("dwts-player", JSON.stringify(state.player));
  state.memberships = state.memberships.filter(m => m.league.id !== league.id);
  state.memberships.push({ league, player });
  rememberLeague(league);
  state.showJoin = false;
  await loadLeague();
  $("#banner").textContent = `You're in ${league.name}. Build your team for ${weekLabel(state.week)}.`;
}

async function handleInvite() {
  const code = normCode(state.invite);
  state.invite = null;
  history.replaceState(null, "", location.pathname);
  const known = state.memberships.find(m => normCode(m.league.passcode) === code);
  if (known) { await switchLeague(known); return; }
  try {
    const lg = await api.getLeague(code);
    if (!lg) { $("#banner").textContent = "That invite link didn't match a league."; return; }
    state.pendingInvite = lg;
    state.showJoin = true;
  } catch (e) { showError(e); }
}

async function switchLeague(m) {
  const fresh = await api.getLeagueById(m.league.id).catch(() => m.league);
  if (!fresh) return dropDeadLeague(m.league.id);
  state.player = m.player;
  localStorage.setItem("dwts-player", JSON.stringify(state.player));
  rememberLeague(fresh);
  state.players = []; state.lineups = []; state.elimpicks = []; state.chat = [];
  state.showJoin = false;
  $("#banner").textContent = "";
  render();
  await loadLeague().catch(showError);
}

function rememberLeague(league) {
  state.league = {
    id: league.id, name: league.name, passcode: league.passcode,
    icon: league.icon || "🪩", icon_url: league.icon_url || null,
    cap: league.cap ?? DEFAULT_CAP, roster_size: league.roster_size ?? DEFAULT_ROSTER,
    elim_bonus: league.elim_bonus ?? DEFAULT_ELIM_BONUS,
    winner_bonus: league.winner_bonus ?? DEFAULT_WINNER_BONUS,
    commish_code: league.commish_code || null,
  };
  localStorage.setItem("dwts-league", JSON.stringify(state.league));
  state.memberships = state.memberships.map(m => m.league.id === league.id ? { ...m, league: state.league } : m);
  saveMemberships();
}

function dropDeadLeague(leagueId) {
  state.memberships = state.memberships.filter(m => m.league.id !== leagueId);
  saveMemberships();
  if (state.league?.id === leagueId) {
    state.players = []; state.lineups = []; state.elimpicks = [];
    const next = state.memberships[0];
    if (next) { $("#banner").textContent = `That league is gone — you're in ${next.league.name} now.`; return switchLeague(next); }
    localStorage.removeItem("dwts-player"); localStorage.removeItem("dwts-league");
    state.player = null; state.league = null;
  }
  $("#banner").textContent = "That league no longer exists.";
  render();
}

const saveMemberships = () => localStorage.setItem("dwts-memberships", JSON.stringify(state.memberships));
const normCode = s => String(s).trim().toLowerCase();

// ---------- league photo ----------

async function uploadLeaguePhoto(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  $("#banner").textContent = "Uploading…";
  try {
    const blob = await shrinkImage(file, 512);
    const url = await api.uploadLeaguePic(state.league.id, blob);
    await api.setLeaguePic(state.league.id, url);
    state.league.icon_url = url;
    localStorage.setItem("dwts-league", JSON.stringify(state.league));
    $("#banner").textContent = "";
    render();
  } catch (err) { showError(err); }
}

function shrinkImage(file, max) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      cv.toBlob(b => b ? res(b) : rej(new Error("resize failed")), "image/jpeg", 0.85);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}

// ---------- chat ----------

async function refreshChat() {
  if (!state.league) return;
  try {
    state.chat = await api.listMessages(state.league.id) || [];
    if (state.view === "league") drawChat();
    updateTicker();
  } catch {}
}

function drawChat() {
  const log = $("#chatlog");
  if (!log) return;
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  // A message with no player is from the score checker, not a person.
  log.innerHTML = state.chat.map(m => {
    const who = m.dwts_players?.name;
    return `<div class="msg ${who ? "" : "system"}"><b>${who ? esc(who) : "🪩 Score check"}</b> ${esc(m.body)}
      <span class="at">${new Date(m.created_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span></div>`;
  }).join("") || `<p class="hint">Nothing yet. Start the trash talk.</p>`;
  if (atBottom) log.scrollTop = log.scrollHeight;
}

async function onChat(e) {
  e.preventDefault();
  const inp = e.target.body;
  const body = inp.value.trim();
  if (!body) return;
  inp.value = "";
  try { await api.sendMessage(state.player.id, state.league.id, body); await refreshChat(); }
  catch (err) { inp.value = body; showError(err); }
}

function updateTicker() {
  const last = state.chat[state.chat.length - 1];
  const t = $("#ticker");
  if (!last || state.view === "league") { t.hidden = true; return; }
  $("#tickertext").textContent = `💬 ${last.dwts_players?.name || "🪩 Score check"}: ${last.body}`;
  t.hidden = false;
}

// ---------- share / install / updates ----------

function openShare() {
  const code = state.league?.passcode || LEAGUE_PASSCODE;
  $("#modalcode").textContent = code;
  $("#modaltitle").textContent = state.league ? `Invite to ${state.league.name}` : "Invite the family";
  // qr.gif is baked for the main league's passcode — don't show a QR that would
  // drop someone into the wrong league.
  $("#modalqr").hidden = normCode(code) !== normCode(LEAGUE_PASSCODE);
  $("#sharemodal").hidden = false;
}

// Everything goes in `text` — a share target is free to keep `url` and drop the
// rest, and a link that arrives without the passcode is a locked door.
async function shareInvite() {
  const code = state.league?.passcode || LEAGUE_PASSCODE;
  const lname = state.league?.name || "our league";
  const link = location.origin + location.pathname;
  const text = `Join our Dancing with the Stars fantasy league — ${lname}! 🪩\n${link}?join=${encodeURIComponent(code)}\nPasscode: ${code}\n\nThen tap Share → Add to Home Screen so it opens like an app.`;
  try { await navigator.share({ text }); }
  catch (e) {
    if (e.name === "AbortError") return;
    $("#sharemodal").hidden = true;
    try {
      await navigator.clipboard.writeText(text);
      $("#banner").textContent = "Invite copied — paste it into a text.";
    } catch { $("#banner").textContent = `Send this: ${link}?join=${code}`; }
  }
}

let deferredPrompt = null;

async function addToHomeScreen() {
  if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; localStorage.setItem("dwts-a2hs", "1"); return; }
  const steps = $("#a2hssteps");
  steps.hidden = false;
  steps.innerHTML = /iphone|ipad|ipod/i.test(navigator.userAgent)
    ? "Tap the <b>Share</b> button at the bottom of Safari, then <b>Add to Home Screen</b>."
    : "Open your browser's menu (⋮) and choose <b>Install app</b> or <b>Add to Home screen</b>.";
  localStorage.setItem("dwts-a2hs", "1");
}

function maybeInstallTip() {
  if (localStorage.getItem("dwts-a2hs")) return;
  if (matchMedia("(display-mode: standalone)").matches || navigator.standalone) return;
  if (!state.player) return;
  $("#banner").innerHTML = `📲 <button id="tipinstall">Put Mirror Ball on your home screen</button> — it opens like a real app.`;
  const b = $("#tipinstall");
  if (b) b.onclick = () => { $("#sharemodal").hidden = false; addToHomeScreen(); };
}

async function checkForUpdate() {
  try {
    const res = await fetch("js/config.js", { cache: "no-store" });
    if (!res.ok) return;
    const txt = await res.text();
    const m = txt.match(/VERSION\s*=\s*"([^"]+)"/);
    if (m && m[1] !== VERSION) {
      $("#updatebar").innerHTML = `A newer version (v${esc(m[1])}) is ready. <button id="doupdate">Tap to refresh</button>`;
      $("#doupdate").onclick = () => location.reload(true);
    }
  } catch {}
}

// ---------- sparkle + confetti ----------

function makeGlitter() {
  const box = $("#glitter");
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 34; i++) {
    const s = document.createElement("i");
    s.style.left = Math.random() * 100 + "%";
    s.style.top = Math.random() * 100 + "%";
    s.style.animationDelay = (Math.random() * 4).toFixed(2) + "s";
    s.style.animationDuration = (2.6 + Math.random() * 3).toFixed(2) + "s";
    frag.appendChild(s);
  }
  box.appendChild(frag);
}

function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const cv = $("#confetti"), ctx = cv.getContext("2d");
  cv.width = innerWidth; cv.height = innerHeight; cv.style.display = "block";
  const colors = ["#FFD24A", "#FF2D95", "#00E5D0", "#B066FF", "#FFFFFF"];
  const bits = Array.from({ length: 110 }, () => ({
    x: innerWidth / 2 + (Math.random() - .5) * innerWidth * .5,
    y: innerHeight * .35 + (Math.random() - .5) * 80,
    vx: (Math.random() - .5) * 9,
    vy: -7 - Math.random() * 9,
    w: 5 + Math.random() * 6, h: 8 + Math.random() * 8,
    rot: Math.random() * Math.PI, vr: (Math.random() - .5) * .35,
    c: colors[(Math.random() * colors.length) | 0],
  }));
  let frames = 0;
  (function step() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const b of bits) {
      b.vy += .32; b.x += b.vx; b.y += b.vy; b.rot += b.vr; b.vx *= .995;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot);
      ctx.fillStyle = b.c; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.restore();
    }
    if (++frames < 150) requestAnimationFrame(step);
    else { ctx.clearRect(0, 0, cv.width, cv.height); cv.style.display = "none"; }
  })();
}
