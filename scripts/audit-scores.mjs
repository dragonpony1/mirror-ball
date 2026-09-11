// Mirror Ball — score auditor.
//
// Reads the judges' scores off the season's Wikipedia page, compares them with
// what's in the database, and fixes anything that doesn't match. People still
// type the scores in live during the show; this is the morning-after check.
//
//   node scripts/audit-scores.mjs            # audit every aired week, write fixes
//   node scripts/audit-scores.mjs --dry      # say what it would change, change nothing
//   node scripts/audit-scores.mjs --week 3   # just one week
//   node scripts/audit-scores.mjs --page "Dancing_with_the_Stars_(American_TV_series)_season_34" --dry
//
// Exit code is 0 when everything matched or was fixed, 1 when it couldn't read
// the page at all — so a scheduled run can tell "nothing to do" from "broken".

import { readFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

// ---------- settings, read from the app's own config so there's one source ----------

const cfg = readFileSync(join(ROOT, "js", "config.js"), "utf8");
const pick = re => (cfg.match(re) || [])[1];
const SUPABASE_URL = pick(/SUPABASE_URL\s*=\s*"([^"]+)"/);
const SUPABASE_KEY = pick(/SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/);
const SEASON = Number(pick(/SEASON\s*=\s*(\d+)/));

// The cast, read from cast.js the same way — celeb and pro first names are how
// we match Wikipedia's "Jenna & Val" style couple labels.
const castSrc = readFileSync(join(ROOT, "js", "cast.js"), "utf8");
const CAST = [...castSrc.matchAll(/\{\s*id:\s*"([^"]+)",\s*celeb:\s*"([^"]+)",\s*pro:\s*"([^"]+)"/g)]
  .map(m => ({ id: m[1], celeb: m[2], pro: m[3] }));

const args = process.argv.slice(2);
const has = f => args.includes(f);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };

const DRY = has("--dry");
// Live mode runs every few minutes WHILE the show is on, so it must only ever
// add what Wikipedia has confirmed — never take anything away. Mid-show the
// Result column is still blank, so an authoritative pass would cheerfully
// un-eliminate someone a viewer had already correctly marked as going home.
// It also keeps quiet: nobody needs a chat message every twenty minutes.
const LIVE = has("--live");
const ONLY_WEEK = val("--week") ? Number(val("--week")) : null;
const PAGE = val("--page", `Dancing_with_the_Stars_(American_TV_series)_season_${SEASON}`);

if (!SUPABASE_URL || !SUPABASE_KEY || !CAST.length) {
  console.error("Couldn't read config.js / cast.js — is this running from the project folder?");
  process.exit(1);
}

// ---------- Wikipedia ----------

const strip = s => s
  .replace(/<sup[\s\S]*?<\/sup>/g, "")        // drop footnote markers
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#\d+;/g, " ")
  .replace(/\s+/g, " ").trim();

async function fetchSeasonHtml() {
  const url = `https://en.wikipedia.org/api/rest_v1/page/html/${PAGE}`;
  const res = await fetch(url, { headers: { "User-Agent": "mirror-ball-audit/1.0 (family fantasy league)" } });
  if (!res.ok) throw new Error(`Wikipedia ${res.status} for ${PAGE}`);
  return res.text();
}

// Cut the page into "Week N" chunks, then read the result tables inside each.
function parseWeeks(html) {
  const heads = [...html.matchAll(/<h[34][^>]*id="Week_(\d+)[^"]*"[^>]*>/g)]
    .map(m => ({ week: Number(m[1]), at: m.index }));
  if (!heads.length) return [];

  const out = [];
  for (let i = 0; i < heads.length; i++) {
    const start = heads[i].at;
    const end = i + 1 < heads.length ? heads[i + 1].at : html.length;
    const chunk = html.slice(start, end);
    const rows = [];

    for (const t of chunk.match(/<table[\s\S]*?<\/table>/g) || []) {
      // Only tables that actually carry judges' scores, e.g. "21 (7, 7, 7)".
      if (!/\(\s*\d+\s*(?:,\s*\d+\s*)+\)/.test(t)) continue;
      for (const r of t.match(/<tr[\s\S]*?<\/tr>/g) || []) {
        const cells = (r.match(/<t[hd][\s\S]*?<\/t[hd]>/g) || []).map(strip);
        if (cells.length < 2) continue;
        const couple = cells[0];
        // The score cell is the first one shaped like "21 (7, 7, 7)" or "21".
        const sc = cells.slice(1).find(c => /^\d+\s*(\(|$)/.test(c));
        if (!sc || !/&/.test(couple)) continue;
        const total = Number((sc.match(/^(\d+)/) || [])[1]);
        if (!Number.isFinite(total)) continue;
        const result = cells[cells.length - 1] || "";
        rows.push({ couple, total, eliminated: /eliminat/i.test(result) });
      }
    }
    if (rows.length) out.push({ week: heads[i].week, rows });
  }
  return out;
}

// "Jenna & Val" -> the couple id. BOTH first names have to match.
//
// Matching on the pro alone looks tempting and is badly wrong: the same pros
// come back season after season, so a stale or mistyped page URL will happily
// map last season's celebrities onto this season's couples and quietly rewrite
// everybody's scores. Matching the celebrity alone is no better — Ezra Frech
// and Ezra Sosa share a first name this season, as do Conner Leavitt and
// Connor Wood. The pair is unique; nothing else is. No match means skip.
const first = s => s.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, "");
function matchCouple(label) {
  const [celebPart, proPart] = label.split("&").map(s => s.trim());
  if (!celebPart || !proPart) return null;
  const c = first(celebPart), p = first(proPart);
  return CAST.find(x => first(x.celeb) === c && first(x.pro) === p)?.id || null;
}

// A couple can dance more than once in a week (team dances, relays, the finale).
// For fantasy purposes those all count, so the week's score is the sum.
function foldWeek(rows) {
  const byCouple = new Map();
  const unmatched = [];
  for (const r of rows) {
    const id = matchCouple(r.couple);
    if (!id) { unmatched.push(r.couple); continue; }
    const cur = byCouple.get(id) || { score: 0, eliminated: false };
    cur.score += r.total;
    cur.eliminated = cur.eliminated || r.eliminated;
    byCouple.set(id, cur);
  }
  return { byCouple, unmatched: [...new Set(unmatched)] };
}

// ---------- Supabase ----------

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

async function rest(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const listScores = () => rest(`dwts_scores?season=eq.${SEASON}&select=week,couple_id,score,eliminated,entered_by`);

const listLeagues = () => rest("dwts_leagues?select=id,name");

// Posted with no player_id, which is how the app knows to render it as the
// score check rather than as one of the players.
const postNotice = (leagueId, body) => rest("dwts_messages", {
  method: "POST",
  body: JSON.stringify({ league_id: leagueId, player_id: null, body: body.slice(0, 300) }),
});

const saveScores = rows => rest("dwts_scores", {
  method: "POST",
  headers: { Prefer: "resolution=merge-duplicates" },
  body: JSON.stringify(rows.map(r => ({ ...r, season: SEASON, updated_at: new Date().toISOString() }))),
});

// ---------- the audit ----------

// What a row should become, given what's in the database (`cur`, possibly
// undefined) and what the page says (`truth`).
//
// Authoritative passes take the page at its word in both directions. LIVE
// passes run every few minutes while the show is still on, when the page is
// half-written, so they only ever ADD: an elimination someone already marked
// stays marked, and a score someone already typed is never blanked just
// because Wikipedia hasn't caught up. Exported so it can be tested — this is
// the subtlest rule in the project and the easiest to break by accident.
export function reconcile(cur, truth, live) {
  if (!live) return { score: truth.score, eliminated: truth.eliminated };
  return {
    score: truth.score == null ? (cur?.score ?? null) : truth.score,
    eliminated: !!cur?.eliminated || truth.eliminated,
  };
}

const nameOf = id => CAST.find(c => c.id === id)?.celeb || id;

async function main() {
  const html = await fetchSeasonHtml();
  const weeks = parseWeeks(html);

  if (!weeks.length) {
    console.log(`No week tables on the ${PAGE} page yet — nothing has aired, or the layout changed.`);
    return { changes: [], checked: 0 };
  }

  const existing = await listScores();
  const seen = new Map(existing.map(r => [`${r.week}:${r.couple_id}`, r]));

  const changes = [];
  const writes = [];
  let checked = 0;
  const problems = [];

  for (const { week, rows } of weeks) {
    if (ONLY_WEEK && week !== ONLY_WEEK) continue;
    const { byCouple, unmatched } = foldWeek(rows);
    if (unmatched.length) problems.push(`week ${week}: couldn't match ${unmatched.join(", ")}`);
    // Rows on the page but nothing matched means we're reading the wrong season
    // (or the cast list is stale). Refuse to write anything on that basis.
    if (!byCouple.size) {
      console.error(`\nWeek ${week} had ${rows.length} rows and NONE matched this season's cast.`);
      console.error(`Reading: ${PAGE}. Not writing anything — check the page and js/cast.js.`);
      process.exit(1);
    }

    for (const [coupleId, truth] of byCouple) {
      checked++;
      const cur = seen.get(`${week}:${coupleId}`);
      const { score: nextScore, eliminated: nextElim } = reconcile(cur, truth, LIVE);

      const scoreOff = !cur || cur.score !== nextScore;
      const elimOff = !cur || !!cur.eliminated !== nextElim;
      if (!scoreOff && !elimOff) continue;

      changes.push({
        week, coupleId, name: nameOf(coupleId),
        was: cur ? { score: cur.score, eliminated: !!cur.eliminated } : null,
        now: { score: nextScore, eliminated: nextElim },
        by: cur?.entered_by || null,
      });
      writes.push({
        week, couple_id: coupleId, score: nextScore,
        eliminated: nextElim, entered_by: "Wikipedia check",
      });
    }
  }

  for (const p of problems) console.warn("!", p);

  if (!changes.length) {
    console.log(`Checked ${checked} scores across ${weeks.length} week(s) — everything matches.`);
    return { changes, checked };
  }

  console.log(`Checked ${checked} scores; ${changes.length} need${changes.length === 1 ? "s" : ""} fixing:`);
  for (const c of changes) {
    const was = c.was ? `${c.was.score}${c.was.eliminated ? " (home)" : ""}` : "missing";
    const now = `${c.now.score}${c.now.eliminated ? " (home)" : ""}`;
    console.log(`  week ${c.week}  ${c.name.padEnd(22)} ${String(was).padStart(12)} -> ${now}`);
  }

  if (DRY) { console.log("\n--dry: nothing written."); return { changes, checked }; }
  await saveScores(writes);
  console.log(`\nWrote ${writes.length} correction(s).`);

  // Tell the leagues what moved. Standings changing with no explanation is
  // how a fantasy league starts an argument — but not every twenty minutes
  // while the show is still on the air.
  const notice = summarise(changes);
  if (LIVE) {
    console.log(`(live run — fixed quietly, no chat post) ${notice}`);
    return { changes, checked, notice };
  }
  for (const lg of (await listLeagues()) || []) {
    await postNotice(lg.id, notice).catch(e => console.warn(`! couldn't post to ${lg.name}: ${e.message}`));
  }
  console.log(`Posted to league chat: ${notice}`);
  return { changes, checked, notice };
}

// One short line, whatever the size of the correction.
function summarise(changes) {
  const weeks = [...new Set(changes.map(c => c.week))].sort((a, b) => a - b);
  const bits = changes.slice(0, 4).map(c =>
    c.was == null ? `added ${c.name} ${c.now.score}`
    : c.was.score !== c.now.score ? `${c.name} ${c.was.score}→${c.now.score}`
    : `${c.name} ${c.now.eliminated ? "went home" : "is still in"}`);
  const more = changes.length > bits.length ? ` and ${changes.length - bits.length} more` : "";
  return `Checked week ${weeks.join(", ")} against the official scores — ${bits.join(", ")}${more}. Standings updated.`;
}

// When this runs in GitHub Actions, put the outcome on the run's summary page
// so it's readable without digging through logs.
function writeStepSummary(text) {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (!f) return;
  try { appendFileSync(f, text + "\n"); } catch {}
}

// Imported by the tests; only actually audit when run directly.
const RUN_DIRECTLY = process.argv[1] && process.argv[1].endsWith("audit-scores.mjs");
if (RUN_DIRECTLY) main()
  .then(({ changes = [], checked = 0, notice }) => {
    writeStepSummary(changes.length
      ? `### 🪩 Fixed ${changes.length} score(s)\n\n${notice}\n\n` +
        changes.map(c => `- Week ${c.week}: **${c.name}** ${c.was ? `${c.was.score}${c.was.eliminated ? " (home)" : ""}` : "missing"} → ${c.now.score}${c.now.eliminated ? " (home)" : ""}${c.by ? ` _(was entered by ${c.by})_` : ""}`).join("\n")
      : `### 🪩 All good\n\nChecked ${checked} score(s) — everything matches the official results.`);
  })
  .catch(e => {
    console.error("Audit failed:", e.message);
    writeStepSummary(`### ⚠️ Score check failed\n\n\`${e.message}\``);
    process.exit(1);
  });
