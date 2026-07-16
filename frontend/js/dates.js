// Datohjelpere. Alle 'YYYY-MM-DD'-strenger tolkes som lokale kalenderdager.

export const WEEKDAYS = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];
export const MONTHS = [
  "januar", "februar", "mars", "april", "mai", "juni",
  "juli", "august", "september", "oktober", "november", "desember",
];

export function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseYmd(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// ISO 8601 ukenummer (uke starter mandag; uke 1 inneholder 4. januar).
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // mandag=0
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // torsdag i denne uka
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((d - firstThursday) / (7 * 24 * 3600 * 1000));
}

// Bygger et månedsrutenett som uker (mandag–søndag). Returnerer en liste av uker,
// hver med { weekNo, days: [{date, inMonth}] }.
export function monthGrid(year, month /* 0-basert */) {
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7; // mandag=0
  const gridStart = addDays(first, -startOffset);

  const weeks = [];
  let cursor = gridStart;
  for (let w = 0; w < 6; w++) {
    const days = [];
    for (let i = 0; i < 7; i++) {
      days.push({ date: cursor, inMonth: cursor.getMonth() === month });
      cursor = addDays(cursor, 1);
    }
    weeks.push({ weekNo: isoWeek(days[0].date), days });
    // Stopp etter at vi har passert måneden (unngå tom 6. rad)
    if (days[6].date.getMonth() !== month && days[0].date.getMonth() !== month) {
      if (w >= 4) break;
    }
  }
  return weeks;
}

export function formatRange(start, end) {
  return start === end ? formatDay(start) : `${formatDay(start)} – ${formatDay(end)}`;
}

export function formatDay(s) {
  const d = parseYmd(s);
  return `${d.getDate()}. ${MONTHS[d.getMonth()]}`;
}
