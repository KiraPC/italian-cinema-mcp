import type { ChainConnector, ChainId, Cinema, CinemaProgramming, Film, OutOfWindowNote } from "./types.js";
import { TtlCache } from "./cache.js";
import { runBounded } from "./http.js";
import { timeAxis } from "./dates.js";

const SHOWTIMES_TTL_MS = 5 * 60 * 1000;
const CINEMAS_TTL_MS = 24 * 60 * 60 * 1000;

export interface ConnectorFailure {
  cinemaId: string;
  chain: ChainId;
  message: string;
}

export interface ProgrammingResult {
  programs: CinemaProgramming[];
  failures: ConnectorFailure[];
}

export class CinemaService {
  private readonly cinemasById = new Map<string, Cinema>();
  private readonly cinemasCache = new TtlCache<ChainId, Cinema[]>(CINEMAS_TTL_MS);
  private readonly programmingCache = new TtlCache<string, CinemaProgramming>(
    SHOWTIMES_TTL_MS,
  );

  constructor(private readonly connectors: ChainConnector[]) {}

  availableChains(): ChainId[] {
    return this.connectors.map((c) => c.chain);
  }

  connectorFor(chain: ChainId | string): ChainConnector | undefined {
    return this.connectors.find((c) => c.chain === chain);
  }

  async listCinemas(chain?: ChainId, signal?: AbortSignal): Promise<Cinema[]> {
    const targets = chain ? this.connectors.filter((c) => c.chain === chain) : this.connectors;
    const fetched = await Promise.all(
      targets.map(async (c) => {
        const cached = this.cinemasCache.get(c.chain);
        if (cached) return cached;
        try {
          const list = await c.listCinemas(signal);
          this.cinemasCache.set(c.chain, list);
          return list;
        } catch (err) {
          return [] as Cinema[];
        }
      }),
    );
    const merged: Cinema[] = [];
    this.cinemasById.clear();
    for (const list of fetched) {
      for (const cinema of list) {
        merged.push(cinema);
        this.cinemasById.set(cinema.id, cinema);
      }
    }
    return merged;
  }

  private resolveChainFilter(
    ids: string[],
    allowed: Set<ChainId> | undefined,
  ): { allowedIds: string[]; rejected: string[] } {
    if (!allowed || allowed.size === 0) return { allowedIds: ids, rejected: [] };
    const allowedIds: string[] = [];
    const rejected: string[] = [];
    for (const id of ids) {
      if (allowed.has(chainOf(id))) allowedIds.push(id);
      else rejected.push(id);
    }
    return { allowedIds, rejected };
  }

  resolveCinema(id: string): Cinema | undefined {
    return this.cinemasById.get(id);
  }

  async getProgramming(
    cinemaIds: string[],
    date: string,
    options: {
      fromTime?: string;
      toTime?: string;
      titleContains?: string;
      chain?: Set<ChainId>;
      signal?: AbortSignal;
    } = {},
  ): Promise<ProgrammingResult> {
    const { allowedIds, rejected } = this.resolveChainFilter(cinemaIds, options.chain);
    const programs: CinemaProgramming[] = [];
    const failures: ConnectorFailure[] = rejected.map((cinemaId) => ({
      cinemaId,
      chain: chainOf(cinemaId),
      message: `Filtered out by chain restriction`,
    }));
    await runBounded(
      allowedIds,
      4,
      async (cinemaId) => {
        const cacheKey = `${cinemaId}|${date}`;
        let program = this.programmingCache.get(cacheKey);
        if (!program) {
          const chain = chainOf(cinemaId);
          const connector = this.connectorFor(chain);
          if (!connector) {
            failures.push({
              cinemaId,
              chain,
              message: `Unknown chain for cinema id "${cinemaId}"`,
            });
            return;
          }
          try {
            program = await connector.getProgramming(cinemaId, date, options.signal);
            this.programmingCache.set(cacheKey, program);
          } catch (err) {
            failures.push({
              cinemaId,
              chain,
              message: err instanceof Error ? err.message : String(err),
            });
            return;
          }
        }
        const filtered = filterProgramming(program, options);
        programs.push(filtered);
      },
      options.signal,
    );
    return { programs, failures };
  }

  async getFilmsForCinemas(
    cinemaIds: string[],
    date: string,
    options: { chain?: Set<ChainId>; signal?: AbortSignal } = {},
  ): Promise<{
    films: { title: string; cinemas: Cinema[] }[];
    failures: ConnectorFailure[];
  }> {
    const result = await this.getProgramming(cinemaIds, date, options);
    const merged = new Map<string, { title: string; cinemas: Cinema[] }>();
    for (const program of result.programs) {
      for (const film of program.films) {
        const key = filmGroupKey(film);
        const existing = merged.get(key) ?? { title: film.title, cinemas: [] };
        if (!existing.cinemas.some((c) => c.id === program.cinema.id)) {
          existing.cinemas.push(program.cinema);
        }
        merged.set(key, existing);
      }
    }
    return {
      films: [...merged.values()].sort((a, b) => a.title.localeCompare(b.title)),
      failures: result.failures,
    };
  }
}

export function filmGroupKey(film: Film): string {
  return film.title.toLowerCase().replace(/\s+/g, " ").trim();
}

function chainOf(cinemaId: string): ChainId {
  const idx = cinemaId.indexOf(":");
  if (idx <= 0) return "uci";
  const prefix = cinemaId.slice(0, idx);
  if (prefix === "thespace") return "thespace";
  return "uci";
}

export function filterProgramming(
  program: CinemaProgramming,
  options: { fromTime?: string; toTime?: string; titleContains?: string },
): CinemaProgramming {
  const fromAxis = options.fromTime !== undefined ? timeAxis(options.fromTime) : undefined;
  const toAxis = options.toTime !== undefined ? timeAxis(options.toTime) : undefined;
  const films = program.films
    .filter((film) => {
      if (!options.titleContains) return true;
      const needle = options.titleContains.toLowerCase();
      return film.title.toLowerCase().includes(needle);
    })
    .map<Film>((film) => {
      const inWindow: typeof film.showtimes = [];
      const outBefore: typeof film.showtimes = [];
      const outAfter: typeof film.showtimes = [];
      for (const show of film.showtimes) {
        if (typeof show.clockMinutes !== "number") continue;
        if (fromAxis !== undefined && show.clockMinutes < fromAxis) {
          outBefore.push(show);
          continue;
        }
        if (toAxis !== undefined && show.clockMinutes > toAxis) {
          outAfter.push(show);
          continue;
        }
        inWindow.push(show);
      }
      if (outBefore.length === 0 && outAfter.length === 0) {
        const { outOfWindow: _drop, ...rest } = film;
        return rest;
      }
      const note: OutOfWindowNote = {
        cinemaId: program.cinema.id,
        cinemaName: program.cinema.name,
        before: outBefore.length,
        lastBefore:
          outBefore.length > 0 ? outBefore[outBefore.length - 1].startsAt : undefined,
        after: outAfter.length,
        firstAfter: outAfter.length > 0 ? outAfter[0].startsAt : undefined,
      };
      const existing = film.outOfWindow ?? [];
      if (inWindow.length === 0) {
        // keep the film visible so the formatter can render the inline note.
        return { ...film, showtimes: inWindow, outOfWindow: [...existing, note] };
      }
      return { ...film, showtimes: inWindow, outOfWindow: [...existing, note] };
    });
  return { ...program, films };
}
