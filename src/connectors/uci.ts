import type {
  ChainConnector,
  Cinema,
  CinemaProgramming,
  Film,
  Showtime,
} from "../types.js";
import { displayNameFor } from "../names.js";
import { formatAxisMinutes, timeAxis } from "../dates.js";
import { getJson, HttpError } from "../http.js";

const BASE_URL =
  "https://myuci---uci-backend-production-nfluwp7wga-oc.a.run.app/api";
const REFERER = "https://ucicinemas.it";

interface UciTheatre {
  id: number;
  name: string;
  slug: string;
  city: string | null;
  province: string | null;
  is_luxe: boolean;
  screens: string[];
}

interface UciTheatresResponse {
  data: UciTheatre[];
}

interface UciPerformance {
  day: string;
  starts_at: string;
  ends_at: string;
  actual_start_at: string;
  room: string;
  cart_link: string;
  price_starting_from: string;
}

interface UciVersion {
  language: { slug: string } | null;
  duration: string;
  performances: UciPerformance[];
}

interface UciMovie {
  title: string;
  screens: Record<string, UciVersion>[];
}

interface UciProgrammingResponse {
  data: UciMovie[];
}

export class UciConnector implements ChainConnector {
  readonly chain = "uci" as const;

  async listCinemas(signal?: AbortSignal): Promise<Cinema[]> {
    const res = await getJson<UciTheatresResponse>(`${BASE_URL}/theatres`, {
      signal,
      headers: { Referer: REFERER },
    });
    return res.data
      .filter((t) => Boolean(t.slug))
      .map((t) => ({
        id: `uci:${t.slug}`,
        chain: this.chain,
        name: displayNameFor(this.chain, t.name),
        city: t.city ?? "",
        province: t.province ?? undefined,
      }));
  }

  async getProgramming(
    cinemaId: string,
    date: string,
    signal?: AbortSignal,
  ): Promise<CinemaProgramming> {
    const slug = cinemaId.replace(/^uci:/, "");
    let theatre: UciTheatre | undefined;
    try {
      const theatresRes = await getJson<UciTheatresResponse>(
        `${BASE_URL}/theatres`,
        { signal, headers: { Referer: REFERER } },
      );
      theatre = theatresRes.data.find((t) => t.slug === slug);
    } catch (err) {
      if (err instanceof HttpError) {
        // ignore; theatre metadata optional
      } else {
        throw err;
      }
    }
    const programmingRes = await getJson<UciProgrammingResponse>(
      `${BASE_URL}/theatres/${encodeURIComponent(slug)}/programming/${date}`,
      { signal, headers: { Referer: REFERER } },
    );
    const cinema: Cinema = {
      id: `uci:${slug}`,
      chain: this.chain,
      name: theatre ? displayNameFor(this.chain, theatre.name) : `UCI ${slug}`,
      city: theatre?.city ?? "",
      province: theatre?.province ?? undefined,
    };
    return {
      cinema,
      date,
      films: programmingRes.data
        .map((movie) => mapFilm(movie, date))
        .filter((f): f is Film => f !== null && f.showtimes.length > 0),
    };
  }
}

function parseDuration(value: string): number | undefined {
  if (!value || typeof value !== "string") return undefined;
  const parts = value.split(":");
  if (parts.length !== 2) return undefined;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return undefined;
  return hours * 60 + minutes;
}

function mapFilm(movie: UciMovie, date: string): Film | null {
  if (!movie.title) return null;
  const showtimes: Showtime[] = [];
  let durationMinutes: number | undefined;
  for (const screenBlock of movie.screens ?? []) {
    for (const [screenType, versions] of Object.entries(screenBlock)) {
      if (!Array.isArray(versions)) continue;
      for (const version of versions) {
        if (durationMinutes === undefined) {
          durationMinutes = parseDuration(version.duration);
        }
        const language = version.language?.slug;
        const format = screenType;
        for (const perf of (version.performances ?? []) as UciPerformance[]) {
          if (perf.day !== date) continue;
          const hhmm = normalizeTime(perf.actual_start_at);
          // timeAxis() already places HH<06 on the cinema-day-late-night side
          // of the [D 06:00, D+1 06:00) axis, and formatAxisMinutes adds the
          // '+1' marker. Both connectors (UCI, The Space) arrive at the same
          // axis through this helper; no extra "+24h" arithmetic is needed.
          const clockMinutes = timeAxis(hhmm);
          showtimes.push({
            startsAt: formatAxisMinutes(clockMinutes),
            clockMinutes,
            version: {
              language,
              format,
              price: perf.price_starting_from ?? undefined,
              screenName: perf.room,
            },
            soldOut: false,
            bookingUrl: `https://ucicinemas.it${perf.cart_link}`,
          });
        }
      }
    }
  }
  showtimes.sort((a, b) => a.clockMinutes - b.clockMinutes);
  return { title: movie.title.trim(), durationMinutes, showtimes };
}

function normalizeTime(value: string): string {
  if (!value) return value;
  if (value.includes(":")) return value.slice(0, 5);
  return value;
}
