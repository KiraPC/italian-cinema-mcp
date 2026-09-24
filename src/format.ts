import type { CinemaProgramming, Film, OutOfWindowNote, Showtime, ShowtimeVersion } from "./types.js";

export interface FormatOptions {
  includeLinks: boolean;
}

const TIME_RE = /^\d{2}:\d{2}$/;
const DEFAULT_FORMAT = "2D";
const DEFAULT_LANGS = new Set(["ITA", "ITALIANO", "IT"]);

export function formatProgramming(
  programming: CinemaProgramming[],
  options: FormatOptions,
): string {
  if (programming.length === 0) return "No showtimes available.";
  const byFilm = new Map<string, { film: Film; cinemas: Map<string, CinemasShows> }>();
  for (const cinemaProg of programming) {
    for (const film of cinemaProg.films) {
      const key = filmKey(film);
      let entry = byFilm.get(key);
      if (!entry) {
        entry = { film, cinemas: new Map() };
        byFilm.set(key, entry);
      }
      const slot = entry.cinemas.get(cinemaProg.cinema.id) ?? {
        cinemaId: cinemaProg.cinema.id,
        cinemaName: cinemaProg.cinema.name,
        chain: cinemaProg.cinema.chain,
        city: cinemaProg.cinema.city,
        shows: [],
        outOfWindow: undefined,
      };
      for (const show of film.showtimes) {
        slot.shows.push(show);
      }
      slot.shows.sort((a, b) => a.clockMinutes - b.clockMinutes);
      if (film.outOfWindow) {
        const note = film.outOfWindow.find((n) => n.cinemaId === cinemaProg.cinema.id);
        if (note) slot.outOfWindow = note;
      }
      entry.cinemas.set(cinemaProg.cinema.id, slot);
    }
  }
  const sortedFilms = [...byFilm.entries()].sort(([, a], [, b]) =>
    a.film.title.localeCompare(b.film.title),
  );
  const lines: string[] = [];
  const trailingTail = new Map<string, string[]>();

  for (const [, entry] of sortedFilms) {
    const cinemaRows = [...entry.cinemas.entries()]
      .map(([, slot]) => slot)
      .sort((a, b) => a.cinemaName.localeCompare(b.cinemaName));
    const width = Math.max(...cinemaRows.map((c) => c.cinemaName.length), 1);

    type Row = { kind: "in"; text: string; shows: Showtime[] } | { kind: "out"; text: string };
    const rows: Row[] = [];
    for (const slot of cinemaRows) {
      const padded = slot.cinemaName.padEnd(width + 2, " ");
      if (slot.shows.length > 0) {
        const labels = slot.shows.map((s) => formatShow(s, options));
        rows.push({ kind: "in", text: `${padded}${labels.join(", ")}`.trimEnd(), shows: slot.shows });
      } else if (slot.outOfWindow) {
        const note = formatInlineOutNote(slot.outOfWindow);
        if (note) rows.push({ kind: "out", text: `${padded}— none in window ${note}` });
      }
    }

    const hasInWindow = rows.some((r) => r.kind === "in");
    const titleLine = `${entry.film.title}${durationLabel(entry.film.durationMinutes)}`;

    if (hasInWindow) {
      lines.push(titleLine);
      for (const row of rows) {
        lines.push(row.text);
        if (row.kind === "in" && options.includeLinks) {
          const lead = " ".repeat(width + 2);
          for (const show of row.shows) {
            if (!show.bookingUrl) continue;
            lines.push(`${lead}book ${show.startsAt}: ${show.bookingUrl}`);
          }
        }
      }
      lines.push("");
      continue;
    }

    // No in-window shows anywhere: collect a short trailing summary per
    // film, grouping multiple cinemas under the same title.
    const cinemaItems: string[] = [];
    for (const slot of cinemaRows) {
      const note = slot.outOfWindow;
      if (!note) continue;
      const time = note.lastBefore ?? note.firstAfter;
      if (!time) continue;
      cinemaItems.push(`${slot.cinemaName} ${time}`);
    }
    if (cinemaItems.length === 0) continue;
    const key = entry.film.title;
    const bucket = trailingTail.get(key) ?? [];
    bucket.push(...cinemaItems);
    trailingTail.set(key, bucket);
  }

  if (trailingTail.size > 0) {
    const items: string[] = [];
    for (const [title, cinemas] of trailingTail) {
      items.push(`${title} (${cinemas.join(", ")})`);
    }
    lines.push(`Outside the time window: ${items.join("; ")}`);
  }
  return lines.join("\n").trimEnd();
}

function formatShow(show: Showtime, options: FormatOptions): string {
  const time = TIME_RE.test(show.startsAt) ? show.startsAt : show.startsAt;
  const tags = tagsFor(show.version);
  let label = `${time}${tags.length > 0 ? " " + tags.join(" ") : ""}`;
  if (show.soldOut) label = `${label} (sold out)`;
  if (options.includeLinks && show.bookingUrl) {
    label = `${label} [${shortUrl(show.bookingUrl)}]`;
  }
  return label;
}

function formatInlineOutNote(note: OutOfWindowNote): string {
  const parts: string[] = [];
  if (note.before > 0) {
    parts.push(`${note.before} earlier, last ${note.lastBefore ?? "??"}`);
  }
  if (note.after > 0) {
    parts.push(`${note.after} later, first ${note.firstAfter ?? "??"}`);
  }
  return parts.length === 0 ? "" : `(${parts.join("; ")})`;
}

function tagsFor(version: ShowtimeVersion): string[] {
  const tags: string[] = [];
  const fmt = normalizeFormat(version.format);
  if (fmt && fmt !== DEFAULT_FORMAT) tags.push(fmt);
  const lang = normalizeLanguage(version.language);
  if (lang) tags.push(lang);
  return tags;
}

function normalizeFormat(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const upper = trimmed.toUpperCase();
  if (upper === DEFAULT_FORMAT) return DEFAULT_FORMAT;
  return upper;
}

function normalizeLanguage(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const upper = trimmed.toUpperCase();
  if (DEFAULT_LANGS.has(upper)) return undefined;
  if (upper === "ENG" || upper === "EN" || upper === "INGLESE" || upper === "INGLESE/SUB") {
    return "EN";
  }
  if (upper === "OV" || upper === "VO" || upper === "ORIGINAL") {
    return "OV";
  }
  return upper;
}

function durationLabel(minutes: number | undefined): string {
  if (minutes === undefined || minutes === null || !Number.isFinite(minutes)) return "";
  if (minutes <= 0) return "";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return ` (${m}m)`;
  if (m === 0) return ` (${h}h)`;
  return ` (${h}h${m.toString().padStart(2, "0")})`;
}

function filmKey(film: Film): string {
  return `${film.title}`.toLowerCase().replace(/\s+/g, " ").trim();
}

interface CinemasShows {
  cinemaId: string;
  cinemaName: string;
  chain: string;
  city: string;
  shows: Showtime[];
  outOfWindow?: OutOfWindowNote;
}

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "");
}
