// Dancing with the Stars — season 35 cast (premiered Sept 15–16, 2026).
// 16 couples, three judges (Derek Hough, Carrie Ann Inaba, Bruno Tonioli),
// so every dance is scored out of 30.
//
// `price` is the OPENING week-1 salary. Later weeks can be repriced by the
// commissioner (stored in the dwts_prices table); these are only the defaults.
// `color` is the couple's signature color on their card — keep them distinct.
// `night` is which premiere night they danced: the two-night opener split the
// cast by gender, men on Tuesday and women on Wednesday, one couple going home
// each night. It only matters for week 1.

export const CAST = [
  { id: "dewan",     celeb: "Jenna Dewan",         pro: "Val Chmerkovskiy",  known: "Actress & dancer — Step Up",        price: 14500, color: "#FF2D95", night: 2 },
  { id: "shum",      celeb: "Harry Shum Jr.",      pro: "Jenna Johnson",     known: "Actor & dancer — Glee",             price: 14000, color: "#00E5D0", night: 1 },
  { id: "stiles",    celeb: "Julia Stiles",        pro: "Ezra Sosa",         known: "Actress — Save the Last Dance",     price: 11500, color: "#B066FF", night: 2 },
  { id: "glenn",     celeb: "Amber Glenn",         pro: "Pasha Pashkov",     known: "Olympic figure skater — 2026 gold", price: 11000, color: "#4FC3F7", night: 2 },
  { id: "olson",     celeb: "Jackson Olson",       pro: "Emma Slater",       known: "Savannah Bananas second baseman",   price: 10500, color: "#FFD700", night: 1 },
  { id: "ali",       celeb: "Tatyana Ali",         pro: "Jan Ravnik",        known: "Actress & singer — Fresh Prince",   price: 10000, color: "#FF7043", night: 2 },
  { id: "frech",     celeb: "Ezra Frech",          pro: "Daniella Karagach", known: "Paralympic gold medalist",          price:  9500, color: "#66BB6A", night: 1 },
  { id: "hanson",    celeb: "Taylor Hanson",       pro: "Britt Stewart",     known: "Hanson frontman",                   price:  9500, color: "#FFA726", night: 1 },
  { id: "higgins",   celeb: "Maura Higgins",       pro: "Mark Ballas",       known: "TV personality & model",            price:  9000, color: "#EC407A", night: 2 },
  { id: "miller",    celeb: "Ciara Miller",        pro: "Brandon Armstrong", known: "Summer House",                      price:  8500, color: "#26C6DA", night: 2 },
  { id: "cameron",   celeb: "Tyler Cameron",       pro: "Sharna Burgess",    known: "The Bachelorette runner-up",        price:  8500, color: "#5C6BC0", night: 1 },
  { id: "nader",     celeb: "Sarah Jane Nader",    pro: "Hailey Bills",      known: "Love Thy Nader",                    price:  8000, color: "#AB47BC", night: 2 },
  { id: "leavitt",   celeb: "Conner Leavitt",      pro: "Adele Zaikman",     known: "Secret Lives of Mormon Wives",      price:  7500, color: "#7E57C2", night: 1 },
  { id: "wood",      celeb: "Connor Wood",         pro: "Rylee Arnold",      known: "Comedian & podcaster",              price:  7500, color: "#42A5F5", night: 1 },
  { id: "giada",     celeb: "Giada De Laurentiis", pro: "Alan Bersten",      known: "Celebrity chef",                    price:  7000, color: "#EF5350", night: 2 },
  { id: "guillermo", celeb: "Guillermo Rodriguez", pro: "Witney Carson",     known: "Jimmy Kimmel Live! sidekick",       price:  6000, color: "#FFCA28", night: 1 },
];

export const byId = id => CAST.find(c => c.id === id) || null;

// Two initials for the card medallion: first letter of each name.
export function initials(c) {
  const parts = c.celeb.split(/\s+/);
  return ((parts[0][0] || "") + (parts[1]?.[0] || "")).toUpperCase();
}

// ---------- the season's weeks ----------
// DWTS airs live Tuesdays at 8pm Eastern. Week 1 was the two-night premiere
// (Tue Sept 15 + Wed Sept 16) and counts as ONE week here — all 16 couples.
//
// Lock times are computed from the premiere and can be overridden per week in
// the commissioner screen when ABC moves a show (it happens most seasons).

export const TOTAL_WEEKS = 12;

// Tue Sept 15, 2026, 8:00pm Eastern = 00:00 UTC on Sept 16 (EDT, UTC-4).
// Every lock is 8pm on the Eastern clock, so it moves an hour in UTC when the
// clocks change: 00:00 UTC under daylight time, 01:00 UTC under standard time.
// A fixed UTC time would lock at 7pm Eastern from November on — an hour before
// the show.
//
// NOTE: Mountain and Central affiliates air network primetime an hour behind the
// live Eastern feed, so an 8pm ET lock shuts a Denver league out a full hour
// before their show starts. Week 1's lock was overridden to 7pm MT on the night
// for exactly that reason. Override the lock per week rather than moving this.

export function defaultLock(week) {
  const tue = new Date(Date.UTC(2026, 8, 15 + (week - 1) * 7));   // that week's Tuesday
  const y = tue.getUTCFullYear(), m = tue.getUTCMonth(), d = tue.getUTCDate();
  const offset = easternDaylight(y, m, d) ? 4 : 5;                // hours behind UTC
  return new Date(Date.UTC(y, m, d, 20 + offset));
}

// US daylight time: second Sunday of March to first Sunday of November. Done by
// hand rather than with Intl so every phone gets the same answer.
function easternDaylight(y, m, d) {
  const nthSunday = (month, n) => {
    const first = new Date(Date.UTC(y, month, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + (n - 1) * 7;
  };
  const day = Date.UTC(y, m, d);
  return day >= Date.UTC(y, 2, nthSunday(2, 2)) && day < Date.UTC(y, 10, nthSunday(10, 1));
}

export function weekLabel(week) {
  return week === 1 ? "Week 1 · Premiere" : `Week ${week}`;
}

// ---------- elimination picks ----------
// Normally one couple goes home a week and you make one call. The premiere sent
// one home each night, so week 1 takes two picks — one from Tuesday's men, one
// from Wednesday's women. Each is worth the bonus on its own.
//
// `night` null means "anyone still dancing". `slot` is stored on the pick row,
// so adding a slot later (a double-elimination week) needs no schema change.
export function elimSlots(week) {
  if (week === 1) return [
    { slot: 1, night: 1, label: "Tuesday — the men" },
    { slot: 2, night: 2, label: "Wednesday — the women" },
  ];
  return [{ slot: 1, night: null, label: null }];
}
