// Shares Matt's existing Supabase project with the football app; the DWTS
// tables are all prefixed dwts_ so the two apps never collide.
export const SUPABASE_URL = "https://fzyfxccwrgxysoeqohlp.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_IWCEz08f1cRC2pkxVPclGw__Qpwaqtn";

// Shown in the share card before you've joined a league.
export const LEAGUE_PASSCODE = "mirrorball";

// Bump on every push so phones can confirm they have the latest
// (old copies linger in the GitHub Pages cache ~10 minutes).
export const VERSION = "1.0";

export const SEASON = 35;

// ---------- house rules (defaults for a new league) ----------
export const DEFAULT_CAP = 50000;   // salary cap per week
export const DEFAULT_ROSTER = 5;    // couples in a lineup
export const DEFAULT_ELIM_BONUS = 10; // points for calling who goes home
