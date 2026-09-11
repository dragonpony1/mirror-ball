// Dancing with the Stars — season 35 cast (premiered Sept 15–16, 2026).
// 16 couples, three judges (Derek Hough, Carrie Ann Inaba, Bruno Tonioli),
// so every dance is scored out of 30.
//
// `price` is the OPENING week-1 salary. Later weeks can be repriced by the
// commissioner (stored in the dwts_prices table); these are only the defaults.
// `color` is the couple's signature color on their card — keep them distinct.

export const CAST = [
  { id: "dewan",     celeb: "Jenna Dewan",         pro: "Val Chmerkovskiy",  known: "Actress & dancer — Step Up",        price: 14500, color: "#FF2D95" },
  { id: "shum",      celeb: "Harry Shum Jr.",      pro: "Jenna Johnson",     known: "Actor & dancer — Glee",             price: 14000, color: "#00E5D0" },
  { id: "stiles",    celeb: "Julia Stiles",        pro: "Ezra Sosa",         known: "Actress — Save the Last Dance",     price: 11500, color: "#B066FF" },
  { id: "glenn",     celeb: "Amber Glenn",         pro: "Pasha Pashkov",     known: "Olympic figure skater — 2026 gold", price: 11000, color: "#4FC3F7" },
  { id: "olson",     celeb: "Jackson Olson",       pro: "Emma Slater",       known: "Savannah Bananas second baseman",   price: 10500, color: "#FFD700" },
  { id: "ali",       celeb: "Tatyana Ali",         pro: "Jan Ravnik",        known: "Actress & singer — Fresh Prince",   price: 10000, color: "#FF7043" },
  { id: "frech",     celeb: "Ezra Frech",          pro: "Daniella Karagach", known: "Paralympic gold medalist",          price:  9500, color: "#66BB6A" },
  { id: "hanson",    celeb: "Taylor Hanson",       pro: "Britt Stewart",     known: "Hanson frontman",                   price:  9500, color: "#FFA726" },
  { id: "higgins",   celeb: "Maura Higgins",       pro: "Mark Ballas",       known: "TV personality & model",            price:  9000, color: "#EC407A" },
  { id: "miller",    celeb: "Ciara Miller",        pro: "Brandon Armstrong", known: "Summer House",                      price:  8500, color: "#26C6DA" },
  { id: "cameron",   celeb: "Tyler Cameron",       pro: "Sharna Burgess",    known: "The Bachelorette runner-up",        price:  8500, color: "#5C6BC0" },
  { id: "nader",     celeb: "Sarah Jane Nader",    pro: "Hailey Bills",      known: "Love Thy Nader",                    price:  8000, color: "#AB47BC" },
  { id: "leavitt",   celeb: "Conner Leavitt",      pro: "Adele Zaikman",     known: "Secret Lives of Mormon Wives",      price:  7500, color: "#7E57C2" },
  { id: "wood",      celeb: "Connor Wood",         pro: "Rylee Arnold",      known: "Comedian & podcaster",              price:  7500, color: "#42A5F5" },
  { id: "giada",     celeb: "Giada De Laurentiis", pro: "Alan Bersten",      known: "Celebrity chef",                    price:  7000, color: "#EF5350" },
  { id: "guillermo", celeb: "Guillermo Rodriguez", pro: "Witney Carson",     known: "Jimmy Kimmel Live! sidekick",       price:  6000, color: "#FFCA28" },
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
const PREMIERE_UTC = Date.UTC(2026, 8, 16, 0, 0, 0);

export function defaultLock(week) {
  return new Date(PREMIERE_UTC + (week - 1) * 7 * 24 * 60 * 60 * 1000);
}

export function weekLabel(week) {
  return week === 1 ? "Week 1 · Premiere" : `Week ${week}`;
}
