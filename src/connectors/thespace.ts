import type {
  ChainConnector,
  Cinema,
  CinemaProgramming,
  Film,
  Showtime,
  ShowtimeVersion,
} from "../types.js";
import { displayNameFor } from "../names.js";
import { locationFor, parseFallbackLocation } from "../locations.js";
import { formatAxisMinutes, timeAxis } from "../dates.js";
import { getJson } from "../http.js";

const BASE_URL = "https://www.thespacecinema.it/api/microservice/showings";
const REFERER = "https://www.thespacecinema.it/";

interface TsCinema {
  cinemaId: string;
  cinemaName: string;
  fullName: string;
  itemName?: string;
}

interface TsCinemasResponse {
  result: { cinemas: TsCinema[] }[];
}

interface TsAttribute {
  name: string;
  value: string;
  attributeType: string;
}

interface TsSession {
  startTime: string;
  endTime: string;
  screenName: string;
  isSoldOut: boolean;
  bookingUrl: string;
  attributes: TsAttribute[];
}

interface TsShowingGroup {
  date: string;
  sessions: TsSession[];
}

interface TsFilm {
  filmTitle: string;
  runningTime: number;
  showingGroups: TsShowingGroup[];
}

interface TsFilmsResponse {
  result: TsFilm[];
}

export class ThespaceConnector implements ChainConnector {
  readonly chain = "thespace" as const;

  async listCinemas(signal?: AbortSignal): Promise<Cinema[]> {
    const res = await getJson<TsCinemasResponse>(`${BASE_URL}/cinemas`, {
      signal,
      headers: { Referer: REFERER },
    });
    const cinemas: Cinema[] = [];
    for (const group of res.result ?? []) {
      for (const c of group.cinemas ?? []) {
        if (!c.cinemaId) continue;
        const location = locationFor(c.cinemaId) ?? parseFallbackLocation(c);
        cinemas.push({
          id: `thespace:${c.cinemaId}`,
          chain: this.chain,
          name: displayNameFor(this.chain, c.cinemaName ?? ""),
          city: location.city,
          province: location.province,
        });
      }
    }
    return cinemas;
  }

  async getProgramming(
    cinemaId: string,
    date: string,
    signal?: AbortSignal,
  ): Promise<CinemaProgramming> {
    const numericId = cinemaId.replace(/^thespace:/, "");
    const cinema: Cinema = {
      id: cinemaId,
      chain: this.chain,
      name: displayNameFor(this.chain, numericId),
      city: "",
    };
    const showingDate = `${date}T00:00:00`;
    const res = await getJson<TsFilmsResponse>(
      `${BASE_URL}/cinemas/${encodeURIComponent(numericId)}/films` +
        `?showingDate=${showingDate}` +
        `&minEmbargoLevel=3&includesSession=true&includeSessionAttributes=true`,
      { signal, headers: { Referer: REFERER } },
    );
    try {
      const cinemas = await this.listCinemas(signal);
      const found = cinemas.find((c) => c.id === cinemaId);
      if (found) {
        cinema.name = found.name;
        cinema.city = found.city;
        cinema.province = found.province;
      }
    } catch {
      // ignore: name fallback is the displayNameFor(numericId)
    }
    if (!cinema.province) {
      const known = locationFor(numericId);
      if (known) {
        cinema.city = known.city;
        cinema.province = known.province;
      }
    }
    const films = (res.result ?? [])
      .map((film) => mapFilm(film, date))
      .filter((f): f is Film => f !== null && f.showtimes.length > 0);
    return { cinema, date, films };
  }
}

function mapFilm(film: TsFilm, date: string): Film | null {
  if (!film.filmTitle) return null;
  const showtimes: Showtime[] = [];
  for (const group of film.showingGroups ?? []) {
    if ((group.date ?? "").slice(0, 10) !== date) continue;
    for (const session of group.sessions ?? []) {
      const startTime = session.startTime ?? "";
      const hhmm = startTime.slice(11, 16);
      // timeAxis() places HH<06 on the cinema-day-late-night side of the
      // [D 06:00, D+1 06:00) axis. If startTime is on the next calendar day,
      // it's already HH<06 in practice (e.g. "01:00"); we don't double-count.
      const clockMinutes = timeAxis(hhmm);
      showtimes.push({
        startsAt: formatAxisMinutes(clockMinutes),
        clockMinutes,
        version: buildVersion(session),
        soldOut: Boolean(session.isSoldOut),
        bookingUrl: session.bookingUrl
          ? `https://www.thespacecinema.it${session.bookingUrl}`
          : undefined,
      });
    }
  }
  showtimes.sort((a, b) => a.clockMinutes - b.clockMinutes);
  return {
    title: film.filmTitle.trim(),
    durationMinutes: film.runningTime,
    showtimes,
  };
}

function buildVersion(session: TsSession): ShowtimeVersion {
  const attrs = (session.attributes ?? []).filter((a) => a.value);
  const language = pickAttr(attrs, "Language");
  const format = pickAttr(attrs, "Session") ?? pickAttr(attrs, "Session_Special");
  return {
    language,
    format,
    screenName: session.screenName,
  };
}

function pickAttr(attrs: TsAttribute[], type: string): string | undefined {
  for (const attr of attrs) {
    if (attr.attributeType === type && attr.value) return attr.value;
  }
  return undefined;
}
