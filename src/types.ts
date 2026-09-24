export type ChainId = "uci" | "thespace";

export interface Cinema {
  id: string;
  chain: ChainId;
  name: string;
  city: string;
  province?: string;
}

export interface ShowtimeVersion {
  language?: string;
  format?: string;
  screenName?: string;
  durationMinutes?: number;
  price?: string;
}

export interface OutOfWindowNote {
  cinemaId: string;
  cinemaName: string;
  before: number;
  lastBefore?: string;
  after: number;
  firstAfter?: string;
}

export interface Showtime {
  startsAt: string;
  clockMinutes: number;
  endsAt?: string;
  version: ShowtimeVersion;
  soldOut: boolean;
  bookingUrl?: string;
}

export interface Film {
  title: string;
  durationMinutes?: number;
  showtimes: Showtime[];
  outOfWindow?: OutOfWindowNote[];
}

export interface CinemaProgramming {
  cinema: Cinema;
  date: string;
  films: Film[];
}

export interface ChainConnector {
  chain: ChainId;
  listCinemas(signal?: AbortSignal): Promise<Cinema[]>;
  getProgramming(
    cinemaId: string,
    date: string,
    signal?: AbortSignal,
  ): Promise<CinemaProgramming>;
}
