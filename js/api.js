import { SUPABASE_URL, SUPABASE_ANON_KEY, SEASON, VERSION } from "./config.js";
import { CAST, defaultLock } from "./cast.js";

// ---------- Supabase (plain REST, no SDK) ----------

const headers = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
};

async function rest(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  // Successful writes often come back with an empty body (200/201, not just 204).
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export function isConfigured() {
  return !SUPABASE_URL.includes("YOUR-PROJECT") && !SUPABASE_ANON_KEY.includes("YOUR-ANON");
}

const LEAGUE_COLS = "id,name,passcode,icon,icon_url,cap,roster_size,elim_bonus,winner_bonus,commish_code";

// ---------- leagues ----------

export async function getLeagueById(id) {
  const rows = await rest(`dwts_leagues?id=eq.${encodeURIComponent(id)}&select=${LEAGUE_COLS}`);
  return rows[0] || null;
}

export async function getLeague(passcode) {
  const rows = await rest(`dwts_leagues?passcode=eq.${encodeURIComponent(passcode)}&select=${LEAGUE_COLS}`);
  return rows[0] || null;
}

export async function createLeague(fields) {
  const created = await rest("dwts_leagues", {
    method: "POST",
    body: JSON.stringify(fields),
    headers: { Prefer: "return=representation" },
  });
  return created[0];
}

// Recovery: every league a given name belongs to, so a phone can rebuild its list.
export function findPlayerLeagues(name) {
  return rest(`dwts_players?name=eq.${encodeURIComponent(name)}&select=id,name,dwts_leagues(${LEAGUE_COLS})`);
}

export async function getPlayerLeague(playerId) {
  const rows = await rest(`dwts_players?id=eq.${encodeURIComponent(playerId)}&select=league_id,dwts_leagues(${LEAGUE_COLS})`);
  return rows[0]?.dwts_leagues || null;
}

// ---------- players ----------

export async function getOrCreatePlayer(name, leagueId) {
  const existing = await rest(`dwts_players?name=eq.${encodeURIComponent(name)}&league_id=eq.${encodeURIComponent(leagueId)}&select=id,name`);
  if (existing.length) return existing[0];
  const created = await rest("dwts_players", {
    method: "POST", body: JSON.stringify({ name, league_id: leagueId }), headers: { Prefer: "return=representation" },
  });
  return created[0];
}

export function touchPlayer(playerId, standalone) {
  return rest(`dwts_players?id=eq.${encodeURIComponent(playerId)}`, {
    method: "PATCH",
    body: JSON.stringify({ last_seen: new Date().toISOString(), last_via: standalone ? "home screen" : "browser", app_version: VERSION }),
  });
}

export function renamePlayer(playerId, name) {
  return rest(`dwts_players?id=eq.${encodeURIComponent(playerId)}`, { method: "PATCH", body: JSON.stringify({ name }) });
}

export function listPlayers(leagueId) {
  return rest(`dwts_players?league_id=eq.${encodeURIComponent(leagueId)}&select=id,name,app_version,last_seen,last_via&order=name`);
}

// ---------- lineups ----------

export function listAllLineups(leagueId) {
  return rest(`dwts_lineups?season=eq.${SEASON}&league_id=eq.${encodeURIComponent(leagueId)}&select=player_id,week,couple_id,price`);
}

export function addToLineup(playerId, leagueId, week, coupleId, price) {
  return rest("dwts_lineups", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      player_id: playerId, league_id: leagueId, season: SEASON, week,
      couple_id: coupleId, price, updated_at: new Date().toISOString(),
    }),
  });
}

export function removeFromLineup(playerId, week, coupleId) {
  return rest(`dwts_lineups?player_id=eq.${encodeURIComponent(playerId)}&season=eq.${SEASON}&week=eq.${week}&couple_id=eq.${encodeURIComponent(coupleId)}`, {
    method: "DELETE",
  });
}

// ---------- elimination picks ----------

export function listAllElimPicks(leagueId) {
  return rest(`dwts_elimpicks?season=eq.${SEASON}&league_id=eq.${encodeURIComponent(leagueId)}&select=player_id,week,slot,couple_id`);
}

// `slot` is part of the key, so re-picking the same slot replaces it rather
// than piling up a second pick.
export function saveElimPick(playerId, leagueId, week, slot, coupleId) {
  return rest("dwts_elimpicks", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      player_id: playerId, league_id: leagueId, season: SEASON, week, slot,
      couple_id: coupleId, updated_at: new Date().toISOString(),
    }),
  });
}

// ---------- the finale's winner call ----------
// One per player per season, so re-picking replaces rather than stacks.

export function listWinnerPicks(leagueId) {
  return rest(`dwts_winnerpicks?season=eq.${SEASON}&league_id=eq.${encodeURIComponent(leagueId)}&select=player_id,couple_id`);
}

export function saveWinnerPick(playerId, leagueId, coupleId) {
  return rest("dwts_winnerpicks", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      player_id: playerId, league_id: leagueId, season: SEASON,
      couple_id: coupleId, updated_at: new Date().toISOString(),
    }),
  });
}

// ---------- prop bets ----------
// Props belong to a league; the commissioner writes them or takes them from the
// app's starter list. Bets are one row per player per prop.

export function listProps(leagueId) {
  return rest(`dwts_props?season=eq.${SEASON}&league_id=eq.${encodeURIComponent(leagueId)}&select=id,week,text,kind,pays,auto,answer,settled_by&order=created_at`);
}

export async function addProp(leagueId, week, fields) {
  const created = await rest("dwts_props", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ league_id: leagueId, season: SEASON, week, ...fields }),
  });
  return created[0];
}

export function settleProp(propId, answer, by) {
  return rest(`dwts_props?id=eq.${encodeURIComponent(propId)}`, {
    method: "PATCH", body: JSON.stringify({ answer, settled_by: by }),
  });
}

export function removeProp(propId) {
  return rest(`dwts_props?id=eq.${encodeURIComponent(propId)}`, { method: "DELETE" });
}

export function listPropBets(leagueId) {
  return rest(`dwts_propbets?league_id=eq.${encodeURIComponent(leagueId)}&select=player_id,prop_id,answer,balls`);
}

export function savePropBet(playerId, leagueId, propId, answer, balls) {
  return rest("dwts_propbets", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      player_id: playerId, league_id: leagueId, prop_id: propId,
      answer, balls, updated_at: new Date().toISOString(),
    }),
  });
}

export function clearPropBet(playerId, propId) {
  return rest(`dwts_propbets?player_id=eq.${encodeURIComponent(playerId)}&prop_id=eq.${encodeURIComponent(propId)}`, {
    method: "DELETE",
  });
}

// ---------- judges' scores (shared by every league) ----------

export function listScores() {
  return rest(`dwts_scores?season=eq.${SEASON}&select=week,couple_id,score,eliminated,entered_by,updated_at`);
}

export function saveScores(rows) {
  if (!rows.length) return Promise.resolve(null);
  return rest("dwts_scores", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(rows.map(r => ({ ...r, season: SEASON, updated_at: new Date().toISOString() }))),
  });
}

// ---------- weekly salaries ----------

export function listPrices() {
  return rest(`dwts_prices?season=eq.${SEASON}&select=week,couple_id,price`);
}

export function savePrices(rows) {
  if (!rows.length) return Promise.resolve(null);
  return rest("dwts_prices", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(rows.map(r => ({ ...r, season: SEASON }))),
  });
}

// ---------- week settings ----------

export function listWeeks() {
  return rest(`dwts_weeks?season=eq.${SEASON}&select=week,lock_at,no_elimination,results_in,is_finale`);
}

export function saveWeek(week, fields) {
  return rest("dwts_weeks", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ season: SEASON, week, ...fields }),
  });
}

// ---------- league photo ----------

export async function uploadLeaguePic(leagueId, blob) {
  // A fresh filename every time — overwriting is blocked by storage rules,
  // and unique names mean phones never show a stale cached photo.
  const name = `dwts-${encodeURIComponent(leagueId)}-${Date.now()}.jpg`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/league-pics/${name}`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "image/jpeg" },
    body: blob,
  });
  if (!res.ok) throw new Error(`Storage ${res.status}: ${await res.text()}`);
  return `${SUPABASE_URL}/storage/v1/object/public/league-pics/${name}`;
}

export function setLeaguePic(leagueId, url) {
  return rest(`dwts_leagues?id=eq.${encodeURIComponent(leagueId)}`, {
    method: "PATCH", body: JSON.stringify({ icon_url: url }),
  });
}

// ---------- chat ----------

export function listMessages(leagueId) {
  return rest(`dwts_messages?league_id=eq.${encodeURIComponent(leagueId)}&select=body,created_at,dwts_players(name)&order=created_at.desc&limit=60`)
    .then(rows => rows.reverse());
}

export function sendMessage(playerId, leagueId, body) {
  return rest("dwts_messages", {
    method: "POST",
    body: JSON.stringify({ player_id: playerId, league_id: leagueId, body }),
  });
}

// ---------- lock time ----------

// A week locks when its show starts. The commissioner can override the time
// per week (ABC moves shows); otherwise it's the default Tuesday 8pm Eastern.
export function lockTime(week, weekRows) {
  const row = (weekRows || []).find(w => w.week === week);
  return row?.lock_at ? new Date(row.lock_at) : defaultLock(week);
}

export function isWeekLocked(week, weekRows) {
  return Date.now() >= lockTime(week, weekRows).getTime();
}

// ---------- prices ----------

// What a couple costs in a given week: the commissioner's override if there is
// one, otherwise their opening salary.
export function priceOf(coupleId, week, priceRows) {
  const row = (priceRows || []).find(p => p.week === week && p.couple_id === coupleId);
  if (row) return row.price;
  return CAST.find(c => c.id === coupleId)?.price ?? 0;
}
