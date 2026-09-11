import { LEAGUE_PASSCODE, VERSION, DEFAULT_CAP, DEFAULT_ROSTER, DEFAULT_ELIM_BONUS } from "./config.js";
import { CAST, byId, initials, TOTAL_WEEKS, weekLabel } from "./cast.js";
import * as api from "./api.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = n => "$" + Number(n).toLocaleString("en-US");

const state = {
  view: "lineup",
  week: 1,
  player: JSON.parse(localStorage.getItem("dwts-player") || "null"),
  league: JSON.parse(localStorage.getItem("dwts-league") || "null"),
  memberships: JSON.parse(localStorage.getItem("dwts-memberships") || "[]"),
  players: [], lineups: [], elimpicks: [],   // this league
  scores: [], prices: [], weeks: [],         // the show itself — shared by every league
  chat: [],
  showJoin: false,
  pendingInvite: null,
  recapPlayer: null,
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
  const [players, lineups, elims] = await Promise.all([
    api.listPlayers(state.league.id),
    api.listAllLineups(state.league.id),
    api.listAllElimPicks(state.league.id),
  ]);
  state.players = players || [];
  state.lineups = lineups || [];
  state.elimpicks = elims || [];
  render();
  refreshChat();
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

// The week the app opens on: the first one still taking lineups.
function currentWeek() {
  for (let w = 1; w <= TOTAL_WEEKS; w++) if (!locked(w)) return w;
  return TOTAL_WEEKS;
}

const cap = () => state.league?.cap ?? DEFAULT_CAP;
const rosterSize = () => state.league?.roster_size ?? DEFAULT_ROSTER;
const elimBonus = () => state.league?.elim_bonus ?? DEFAULT_ELIM_BONUS;

// ---------- scoring ----------

const lineupOf = (playerId, week) => state.lineups.filter(l => l.player_id === playerId && l.week === week);
const elimPickOf = (playerId, week) => state.elimpicks.find(e => e.player_id === playerId && e.week === week) || null;

function weekPoints(playerId, week) {
  let pts = 0;
  for (const l of lineupOf(playerId, week)) {
    const s = scoreFor(week, l.couple_id);
    if (s != null) pts += s;
  }
  const ep = elimPickOf(playerId, week);
  if (ep && !noElimination(week) && elimsIn(week).includes(ep.couple_id)) pts += elimBonus();
  return pts;
}

function seasonPoints(playerId) {
  let pts = 0;
  for (let w = 1; w <= TOTAL_WEEKS; w++) if (weekHasResults(w)) pts += weekPoints(playerId, w);
  return pts;
}

const spentIn = week => lineupOf(state.player?.id, week).reduce((t, l) => t + l.price, 0);

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
    const b = document.createElement("button");
    b.textContent = w === 1 ? "Wk 1 ✨" : `Wk ${w}`;
    if (weekHasResults(w)) b.classList.add("done");
    b.setAttribute("aria-pressed", String(w === state.week));
    b.onclick = () => { state.week = w; buildWeekStrip(); render(); };
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

  $("#range").textContent = weekLabel(state.week);
  if (state.view === "lineup") renderLineup();
  else if (state.view === "ballroom") renderBallroom();
  else if (state.view === "league") renderLeague();
  else renderRules();
  measureHeader();
}

// ---------- my lineup ----------

function renderLineup() {
  const week = state.week, isLocked = locked(week);
  const mine = lineupOf(state.player.id, week);
  const spent = mine.reduce((t, l) => t + l.price, 0);
  const left = cap() - spent;
  const full = mine.length >= rosterSize();
  const ep = elimPickOf(state.player.id, week);

  const when = lockAt(week).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  let html = "";

  if (isLocked) {
    html += `<p class="hint"><span class="pill locked">Locked</span> Lineups closed ${esc(when)}.</p>`;
    html += lockedLineupHtml(week);
  } else {
    // What's still affordable, and whether the team can even be finished —
    // it's easy to spend big early and strand yourself with slots you can't fill.
    const slotsLeft = rosterSize() - mine.length;
    const available = activeCast(week).filter(c => !mine.some(l => l.couple_id === c.id))
      .map(c => priceIn(c.id, week)).sort((a, b) => a - b);
    const cheapestFill = available.slice(0, slotsLeft).reduce((t, p) => t + p, 0);
    const stuck = slotsLeft > 0 && (available.length < slotsLeft || cheapestFill > left);

    html += `<div class="capwrap ${spent > cap() ? "over" : full ? "full" : ""}">
      <div class="capline">
        <b>${money(left)}</b>
        <span class="right">left to spend<br>${mine.length} of ${rosterSize()} couples</span>
      </div>
      <div class="capbar"><span style="width:${Math.min(100, (spent / cap()) * 100).toFixed(1)}%"></span></div>
      ${slotsLeft > 0 ? `<p class="hint" style="margin:7px 0 0">${
        stuck ? `<b style="color:var(--bad)">You can't fill the rest of your team at these prices — drop someone.</b>`
              : `Up to ${money(Math.floor(left / slotsLeft))} a slot if you spread it evenly.`}</p>` : ""}
    </div>`;

    html += `<p class="hint">Pick ${rosterSize()} couples for ${money(cap())} or less. You keep their judges' scores — a perfect 30 is 30 points. Locks ${esc(when)}.</p>`;

    // the slots
    html += `<div class="slots">`;
    for (let i = 0; i < rosterSize(); i++) {
      const l = mine[i];
      if (!l) { html += `<div class="slot">Empty slot — pick a couple below</div>`; continue; }
      const c = byId(l.couple_id);
      html += `<div class="slot filled">
        ${medallionHtml(c)}
        <span class="cnames"><span class="celeb">${esc(c.celeb)}</span><span class="pro">with ${esc(c.pro)}</span></span>
        <span class="price">${money(l.price)}</span>
        <button class="xbtn" data-drop="${esc(c.id)}" aria-label="Drop ${esc(c.celeb)}">✕</button>
      </div>`;
    }
    html += `</div>`;

    // who goes home
    if (!noElimination(week)) {
      html += `<h2>🏠 Who goes home?</h2>
        <p class="hint">Call the elimination and take ${elimBonus()} bonus points. One pick, and it doesn't cost a cent.</p>
        <div class="slots" id="elimlist">`;
      for (const c of activeCast(week)) {
        const on = ep?.couple_id === c.id;
        html += `<button class="couple ${on ? "picked" : ""}" data-elim="${esc(c.id)}">
          ${medallionHtml(c)}
          <span class="cnames"><span class="celeb">${esc(c.celeb)}</span><span class="pro">with ${esc(c.pro)}</span></span>
          <span class="price">${on ? "🏠" : ""}</span>
        </button>`;
      }
      html += `</div>`;
    }

    // the cast
    html += `<h2>The ballroom — week ${week}</h2>`;
    const roster = activeCast(week).slice().sort((a, b) => priceIn(b.id, week) - priceIn(a.id, week));
    html += `<div class="slots">`;
    for (const c of roster) {
      const price = priceIn(c.id, week);
      const on = mine.some(l => l.couple_id === c.id);
      const tooPricey = !on && price > left;
      const blocked = !on && (full || tooPricey);
      html += `<button class="couple ${on ? "picked" : ""} ${tooPricey ? "toopricey" : ""}" data-add="${esc(c.id)}" ${blocked ? "disabled" : ""}>
        ${medallionHtml(c)}
        <span class="cnames">
          <span class="celeb">${esc(c.celeb)}</span>
          <span class="pro">with ${esc(c.pro)}</span>
          <span class="known">${esc(c.known)}</span>
        </span>
        <span class="price">${money(price)}<small>${on ? "on your team" : tooPricey ? "over budget" : full ? "team full" : "tap to add"}</small></span>
      </button>`;
    }
    html += `</div>`;
  }

  $("#content").innerHTML = html;

  $("#content").querySelectorAll("[data-add]").forEach(b => b.onclick = () => addCouple(b.dataset.add));
  $("#content").querySelectorAll("[data-drop]").forEach(b => b.onclick = () => dropCouple(b.dataset.drop));
  $("#content").querySelectorAll("[data-elim]").forEach(b => b.onclick = () => pickElim(b.dataset.elim));
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
  if (locked(week)) return;
  const mine = lineupOf(state.player.id, week);
  if (mine.some(l => l.couple_id === id)) return;
  if (mine.length >= rosterSize()) { $("#banner").textContent = `Your team is full — drop someone first.`; return; }
  const price = priceIn(id, week);
  const spent = mine.reduce((t, l) => t + l.price, 0);
  if (spent + price > cap()) { $("#banner").textContent = `That puts you ${money(spent + price - cap())} over the cap.`; return; }

  // Optimistic: the card lights up straight away, then the write goes out.
  state.lineups.push({ player_id: state.player.id, week, couple_id: id, price });
  render();
  try {
    await api.addToLineup(state.player.id, state.league.id, week, id, price);
    if (lineupOf(state.player.id, week).length === rosterSize()) { confetti(); $("#banner").textContent = "Team's set. Good luck. 🪩"; }
  } catch (e) {
    state.lineups = state.lineups.filter(l => !(l.player_id === state.player.id && l.week === week && l.couple_id === id));
    render(); showError(e);
  }
}

async function dropCouple(id) {
  const week = state.week;
  if (locked(week)) return;
  const removed = state.lineups.find(l => l.player_id === state.player.id && l.week === week && l.couple_id === id);
  state.lineups = state.lineups.filter(l => !(l.player_id === state.player.id && l.week === week && l.couple_id === id));
  render();
  try { await api.removeFromLineup(state.player.id, week, id); }
  catch (e) { if (removed) state.lineups.push(removed); render(); showError(e); }
}

async function pickElim(id) {
  const week = state.week;
  if (locked(week)) return;
  const prev = elimPickOf(state.player.id, week);
  state.elimpicks = state.elimpicks.filter(e => !(e.player_id === state.player.id && e.week === week));
  state.elimpicks.push({ player_id: state.player.id, week, couple_id: id });
  render();
  try { await api.saveElimPick(state.player.id, state.league.id, week, id); }
  catch (e) {
    state.elimpicks = state.elimpicks.filter(e2 => !(e2.player_id === state.player.id && e2.week === week));
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
  const ep = elimPickOf(playerId, week);
  const gotElim = ep && !noElimination(week) && elimsIn(week).includes(ep.couple_id);

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
  if (ep) {
    const c = byId(ep.couple_id);
    html += `<p class="hint">🏠 Called ${esc(c.celeb)} to go home — ${
      noElimination(week) ? "no elimination this week, so no bonus for anyone."
      : gotElim ? `<b style="color:var(--good)">right, +${elimBonus()}</b>.`
      : weekHasResults(week) ? `<span style="color:var(--bad)">not this time</span>.` : "still to come."}</p>`;
  }
  return html;
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
    <p class="hint">${state.players.length} ${state.players.length === 1 ? "player" : "players"} · ${money(cap())} cap · ${rosterSize()} couples a week</p>
    <label class="linkbtn" style="display:inline-block;cursor:pointer">Change league photo<input type="file" accept="image/*" id="pic" hidden></label>
  </div>`;

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

  const ep = elimPickOf(pid, week);
  return `<div class="recap"><b>${esc(p?.name)} — ${weekLabel(week)}</b><ul>
    ${mine.map(l => {
      const c = byId(l.couple_id), s = scoreFor(week, l.couple_id);
      return `<li>${s == null ? "·" : s === 30 ? "🏆" : "✓"} ${esc(c.celeb)} — ${s == null ? "yet to dance" : `${s} pts`}</li>`;
    }).join("")}
    ${ep ? `<li>🏠 ${esc(byId(ep.couple_id).celeb)} — ${
      noElimination(week) ? "no elimination" :
      elimsIn(week).includes(ep.couple_id) ? `right, +${elimBonus()}` :
      weekHasResults(week) ? "missed" : "pending"}</li>` : ""}
  </ul><b>${weekPoints(pid, week)} points</b></div>`;
}

// ---------- rules ----------

function renderRules() {
  $("#content").innerHTML = `
  <h2>How it works</h2>
  <div class="join">
    <p class="hint" style="font-size:.9rem">
      <b>Build a team of ${rosterSize()} couples</b> every week for ${money(cap())} or less. The good dancers cost more.
    </p>
    <p class="hint" style="font-size:.9rem">
      <b>You score what the judges score.</b> Each couple is marked out of 30 by the three judges. Add up your ${rosterSize()} couples — that's your week.
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
      <b>Season winner</b> is whoever has the most points after the finale.
    </p>
  </div>
  <h2>Who types in the scores?</h2>
  <p class="hint">Anyone in the league. After the show, go to <b>Ballroom → Enter scores</b> and type each couple's total out of 30 and tick whoever went home. Your name gets stamped on it, and anyone can fix a typo.</p>`;
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
    <p class="hint">Type each couple's judges' total out of 30. Leave a box empty if they haven't danced. Tick whoever went home.</p>
    ${needCode ? `<label>Commissioner code<input id="ccode" autocomplete="off" placeholder="required for this league"></label>` : ""}
    <label class="elim" style="display:flex;gap:6px;align-items:center;margin:12px 0">
      <input type="checkbox" id="noelim" ${wk.no_elimination ? "checked" : ""} style="width:auto">
      <span style="font-weight:600;color:var(--ink)">No elimination this week</span>
    </label>
    <div id="scorerows">
      ${roster.map(c => {
        const r = state.scores.find(s => s.week === week && s.couple_id === c.id) || {};
        return `<div class="scorerow">
          ${medallionHtml(c)}
          <span class="cnames" style="flex:1"><span class="celeb">${esc(c.celeb)}</span><span class="pro">${esc(c.pro)}</span></span>
          <input type="number" min="0" max="30" step="1" data-score="${esc(c.id)}" value="${r.score ?? ""}" placeholder="—" inputmode="numeric">
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
    if (score != null && (!Number.isFinite(score) || score < 0 || score > 30)) score = null;
    if (raw === "" && !elim) return; // nothing to say about this couple yet
    rows.push({ week, couple_id: id, score, eliminated: elim, entered_by: state.player.name });
  });

  $("#commishmsg").textContent = "Saving…";
  try {
    await api.saveScores(rows);
    await api.saveWeek(week, { no_elimination: $("#noelim").checked, results_in: rows.some(r => r.score != null) });
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
    elim_bonus: league.elim_bonus ?? DEFAULT_ELIM_BONUS, commish_code: league.commish_code || null,
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
  log.innerHTML = state.chat.map(m => `<div class="msg"><b>${esc(m.dwts_players?.name || "?")}</b> ${esc(m.body)}
    <span class="at">${new Date(m.created_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span></div>`).join("")
    || `<p class="hint">Nothing yet. Start the trash talk.</p>`;
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
  $("#tickertext").textContent = `💬 ${last.dwts_players?.name || "?"}: ${last.body}`;
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
  for (let i = 0; i < 44; i++) {
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
