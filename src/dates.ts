export function todayInRome(now: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(now);
}

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

export function compareTime(a: string, b: string): number {
  return a.localeCompare(b);
}

/**
 * Cinema-day axis used for time-window comparisons and ordering.
 *
 * A "cinema day" spans [D 06:00, D+1 06:00) in Europe/Rome. We pick 06:00 as
 * the anchor because both APIs only ever hand us performances inside this
 * window (with rare pre-dawn exceptions treated the same as late-night shows
 * of the previous day). The axis maps:
 *
 *   D 06:00       ->    0
 *   D 19:00       ->  780
 *   D 23:30       -> 1050
 *   D+1 00:30     -> 1110
 *   D+1 06:00     -> 1440
 *
 * HH:MM below 06:00 always means "after midnight of D+1", which is the
 * reference convention for from_time / to_time too (e.g. to_time "01:00"
 * means "until 1 am"). Upstream next-day flags (UCI's starts_at calendar
 * date, The Space's startTime calendar date) confirm the same placement
 * for showtimes, but are not strictly needed.
 */
export function timeAxis(hhmm: string): number {
  const [h, m] = parseHHMM(hhmm);
  return h < 6 ? (h + 18) * 60 + m : (h - 6) * 60 + m;
}

/** True if the HH:MM token represents an after-midnight time of D+1. */
export function isAfterMidnight(hhmm: string): boolean {
  const [h] = parseHHMM(hhmm);
  return h < 6;
}

/** Render an axis value back as "HH:MM" with a "+1" marker beyond midnight. */
export function formatAxisMinutes(axis: number): string {
  let min = axis + 6 * 60;
  let suffix = "";
  if (min >= 24 * 60) {
    suffix = "+1";
    min -= 24 * 60;
  } else if (min < 0) {
    min = (min + 24 * 60) % (24 * 60);
  }
  const h = Math.floor(min / 60).toString().padStart(2, "0");
  const m = Math.round(min % 60).toString().padStart(2, "0");
  return `${h}:${m}${suffix}`;
}

function parseHHMM(hhmm: string): [number, number] {
  const h = Number(hhmm.slice(0, 2));
  const m = Number(hhmm.slice(3, 5));
  return [Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0];
}
