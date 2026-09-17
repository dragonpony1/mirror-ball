// Shares Matt's existing Supabase project with the football app; the DWTS
// tables are all prefixed dwts_ so the two apps never collide.
export const SUPABASE_URL = "https://fzyfxccwrgxysoeqohlp.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_IWCEz08f1cRC2pkxVPclGw__Qpwaqtn";

// Shown in the share card before you've joined a league.
export const LEAGUE_PASSCODE = "mball";

// Bump on every push so phones can confirm they have the latest
// (old copies linger in the GitHub Pages cache ~10 minutes).
export const VERSION = "5.2";

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
// stake on the week's prop bets. One couple is enough to earn — a full team is
// NOT required — but a week's earnings are capped at what's left after the
// cheapest legal team, which is what stops "pick nobody and bank fifty".
// They never expire, so they can be hoarded for a big finale flutter.
export const DOLLARS_PER_BALL = 1000;
export const MAX_BALLS_PER_PROP = 3;
export const PAYS_YESNO = 10;   // points per ball on a yes/no prop
export const PAYS_COUPLE = 25;  // points per ball on "pick a couple" — much harder

// ---------- a prop you wrote yourself needs the league's OK ----------
// Anyone can write a prop, and that was exploitable: write one you already know
// the answer to, stake three balls, collect. A hand-written prop is now only a
// proposal until this many people tick it off as a fair bet — nobody can bet on
// it until then, the author included. Props that settle themselves from the
// judges' scores are exempt; there's nothing to know in advance.
export const PROP_OKS_NEEDED = 5;

// Everything written before this moment is grandfathered. The league already had
// real balls staked on six props for week 1; invalidating those mid-week would
// have been worse than the exploit.
export const PROP_OKS_FROM = "2026-09-16T03:14:00Z";

// ---------- the premiere catch-up ----------
// Week 1 was a two-night premiere and it locked before night two had danced, so
// anyone joining on Wednesday missed a night that can never be given back. They
// get the half of week 1 that hasn't happened yet, and only that half: two of
// Wednesday's women, half the cap, and the call on which of them goes home.
// Tuesday's men are off the board — their scores are already posted, and
// picking a known result isn't a pick.
//
// The numbers are the league's own, not a favour. The thirteen who played
// Tuesday carried 2.15 women each and spent an average of $22,700 on them, so
// two couples at $25,000 is par. They banked an average of 45.1 from the men,
// so 40 is a shade under it.
//
// The window is dated on purpose: it opens at week 1's lock and shuts an hour
// into Wednesday's show — the same grace the rest of the league got on Tuesday.
// A week-eight joiner can never fall into 40 free points.
export const CATCHUP_WEEK = 1;
export const CATCHUP_NIGHT = 2;
export const CATCHUP_ROSTER = 2;
export const CATCHUP_CAP = 25000;
export const CATCHUP_POINTS = 40;
export const CATCHUP_OPENS = Date.UTC(2026, 8, 16, 1, 0, 0);   // 7pm MT Tue — week 1's lock
export const CATCHUP_CLOSES = Date.UTC(2026, 8, 17, 1, 0, 0);  // 7pm MT Wed — an hour into night two
