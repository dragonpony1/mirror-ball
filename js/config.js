// Shares Matt's existing Supabase project with the football app; the DWTS
// tables are all prefixed dwts_ so the two apps never collide.
export const SUPABASE_URL = "https://fzyfxccwrgxysoeqohlp.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_IWCEz08f1cRC2pkxVPclGw__Qpwaqtn";

// Shown in the share card before you've joined a league.
export const LEAGUE_PASSCODE = "mball";

// Bump on every push so phones can confirm they have the latest
// (old copies linger in the GitHub Pages cache ~10 minutes).
export const VERSION = "3.5";

export const SEASON = 35;

// ---------- house rules (defaults for a new league) ----------
export const DEFAULT_CAP = 50000;   // salary cap per week
export const DEFAULT_ROSTER = 5;    // couples in a lineup
export const DEFAULT_ELIM_BONUS = 10; // points for calling who goes home
// The last episode only: call who takes the Mirrorball. Worth about half a
// week's play, so it decides a close season without erasing a big lead.
export const DEFAULT_WINNER_BONUS = 50;

// ---------- Mirror Balls ----------
// Every $1,000 of salary cap you DON'T spend becomes a Mirror Ball, which you
// stake on the week's prop bets. You only earn them from a week you actually
// fielded a full team in — otherwise picking nobody would bank you fifty.
// They never expire, so they can be hoarded for a big finale flutter.
export const DOLLARS_PER_BALL = 1000;
export const MAX_BALLS_PER_PROP = 3;
export const PAYS_YESNO = 10;   // points per ball on a yes/no prop
export const PAYS_COUPLE = 25;  // points per ball on "pick a couple" — much harder
