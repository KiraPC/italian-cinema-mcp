import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { CinemaService, filterProgramming } from "../../src/service.ts";
import { UciConnector } from "../../src/connectors/uci.ts";
import { ThespaceConnector } from "../../src/connectors/thespace.ts";
import { installFetch, readFixture } from "../helpers.ts";

const DATE = "2026-09-24";

describe("CinemaService", () => {
  let restore: () => void;

  beforeEach(() => {
    const handler = (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/theatres") && !url.includes("/programming")) {
        return Promise.resolve(jsonResponse(readFixture("uci/theatres.json")));
      }
      const uciShow = url.match(/\/theatres\/([^/]+)\/programming\//);
      if (uciShow) {
        const slug = uciShow[1];
        const file = slug === "uci-cinemas-bicocca-milano"
          ? "uci/programming-bicocca-2026-09-24.json"
          : "uci/programming-romaest-2026-09-24.json";
        return Promise.resolve(jsonResponse(readFixture(file)));
      }
      if (url.endsWith("/api/microservice/showings/cinemas")) {
        return Promise.resolve(jsonResponse(readFixture("thespace/cinemas.json")));
      }
      const tsFilms = url.match(/\/cinemas\/([^/]+)\/films/);
      if (tsFilms) {
        const id = tsFilms[1];
        const file =
          id === "1030"
            ? "thespace/films-vimercate-2026-09-24.json"
            : "thespace/films-roma-2026-09-24.json";
        return Promise.resolve(jsonResponse(readFixture(file)));
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    };
    restore = installFetch((input, init) => handler(input, init));
  });

  afterEach(() => {
    restore();
  });

  it("listCinemas merges both chains", async () => {
    const service = new CinemaService([new UciConnector(), new ThespaceConnector()]);
    const cinemas = await service.listCinemas();
    expect(cinemas.length).toBe(33 + 35);
  });

  it("getProgramming applies time and title filters and records out-of-window notes", async () => {
    const service = new CinemaService([new UciConnector(), new ThespaceConnector()]);
    const result = await service.getProgramming(
      ["uci:uci-cinemas-romaest-roma"],
      DATE,
      { fromTime: "20:00", titleContains: "Avengers" },
    );
    expect(result.failures).toEqual([]);
    expect(result.programs.length).toBe(1);
    const films = result.programs[0].films;
    expect(films.length).toBeGreaterThan(0);
    for (const film of films) {
      for (const show of film.showtimes) {
        expect(show.startsAt >= "20:00").toBe(true);
      }
      const note = film.outOfWindow?.find((n) => n.cinemaId === "uci:uci-cinemas-romaest-roma");
      if (note) {
        expect(note.before).toBeGreaterThanOrEqual(1);
        expect(typeof note.lastBefore).toBe("string");
      }
    }
  });

  it("keeps films with no in-window shows when earlier times exist (so formatter can render a note)", async () => {
    // 17:45 is before any UCI Roma Est show on 2026-09-24 per the fixture.
    const service = new CinemaService([new UciConnector(), new ThespaceConnector()]);
    const result = await service.getProgramming(
      ["uci:uci-cinemas-romaest-roma"],
      DATE,
      { fromTime: "21:00", titleContains: "Avengers" },
    );
    expect(result.programs.length).toBe(1);
    const films = result.programs[0].films;
    expect(films.length).toBeGreaterThan(0);
    const avengers = films.find((f) => f.title.toLowerCase().includes("avengers"));
    expect(avengers).toBeDefined();
    const note = avengers!.outOfWindow?.find((n) => n.cinemaId === "uci:uci-cinemas-romaest-roma");
    expect(note).toBeDefined();
    expect(note!.before).toBeGreaterThan(0);
  });

  it("from_time 19:00 keeps after-midnight shows of cinema day D in the window", async () => {
    const service = new CinemaService([new UciConnector(), new ThespaceConnector()]);
    const result = await service.getProgramming(
      ["uci:uci-cinemas-romaest-roma"],
      DATE,
      { fromTime: "19:00", titleContains: "Resident Evil" },
    );
    expect(result.programs.length).toBe(1);
    const resident = result.programs[0].films[0];
    expect(resident).toBeDefined();
    const late = resident.showtimes.find((s) => s.startsAt === "00:30+1");
    expect(late).toBeDefined();
    const note = resident.outOfWindow?.find((n) => n.cinemaId === "uci:uci-cinemas-romaest-roma");
    if (note && note.firstAfter) {
      // "earlier" must not include the post-midnight show.
      expect(note.before).toBe(/* any shows before 19:00 */ 0);
    }
  });

  it("from_time 22:00 + to_time 01:00 includes 00:30+1 and excludes 01:10+1", async () => {
    // Build a synthetic programming block with one cinema and one film
    // having shows at 19:00, 22:30, 00:30+1, 01:10+1.
    const service = new CinemaService([new UciConnector(), new ThespaceConnector()]);
    const fakeProgram: import("../../src/types.ts").CinemaProgramming = {
      cinema: {
        id: "uci:rome-east-test",
        chain: "uci",
        name: "UCI Roma Est",
        city: "Roma",
      },
      date: DATE,
      films: [
        {
          title: "Synthetic",
          showtimes: [
            {
              startsAt: "19:00",
              clockMinutes: 13 * 60,
              version: { format: "2D" },
              soldOut: false,
            },
            {
              startsAt: "22:30",
              clockMinutes: 16 * 60 + 30,
              version: { format: "2D" },
              soldOut: false,
            },
            {
              startsAt: "00:30+1",
              clockMinutes: 18 * 60 + 30,
              version: { format: "2D" },
              soldOut: false,
            },
            {
              startsAt: "01:10+1",
              clockMinutes: 19 * 60 + 10,
              version: { format: "2D" },
              soldOut: false,
            },
          ],
          outOfWindow: [
            {
              cinemaId: "uci:rome-east-test",
              cinemaName: "UCI Roma Est",
              before: 1,
              lastBefore: "19:00",
              after: 1,
              firstAfter: "01:10+1",
            },
          ],
        },
      ],
    };
    // Drive the filter directly through service internals for clarity.
    const result = filterProgramming(fakeProgram, {
      fromTime: "22:00",
      toTime: "01:00",
    });
    expect(result.films).toHaveLength(1);
    const film = result.films[0];
    expect(film.showtimes.map((s) => s.startsAt).sort()).toEqual(["00:30+1", "22:30"]);
    const note = film.outOfWindow?.[0];
    expect(note?.before).toBe(1);
    expect(note?.lastBefore).toBe("19:00");
    expect(note?.after).toBe(1);
    expect(note?.firstAfter).toBe("01:10+1");
  });

  it("getFilmsForCinemas merges titles case-insensitively across chains", async () => {
    const service = new CinemaService([new UciConnector(), new ThespaceConnector()]);
    const { films, failures } = await service.getFilmsForCinemas(
      ["uci:uci-cinemas-romaest-roma", "thespace:1021"],
      DATE,
    );
    expect(failures).toEqual([]);
    const residentKeys = films
      .map((f) => f.title)
      .filter((t) => /^resident evil$/i.test(t));
    expect(residentKeys).toHaveLength(1);
    const resident = films.find((f) => /^resident evil$/i.test(f.title));
    expect(resident).toBeDefined();
    expect(resident!.cinemas.map((c) => c.id).sort()).toEqual([
      "thespace:1021",
      "uci:uci-cinemas-romaest-roma",
    ]);
  });

  it("honours the chain filter on getProgramming", async () => {
    const service = new CinemaService([new UciConnector(), new ThespaceConnector()]);
    const result = await service.getProgramming(
      ["uci:uci-cinemas-romaest-roma", "thespace:1021"],
      DATE,
      { chain: new Set(["uci"]) },
    );
    expect(result.programs.length).toBe(1);
    expect(result.programs[0].cinema.id).toBe("uci:uci-cinemas-romaest-roma");
    expect(result.failures.map((f) => f.cinemaId)).toEqual(["thespace:1021"]);
    expect(result.failures[0].message).toMatch(/Filtered out by chain restriction/);
  });

  it("records per-cinema failures without aborting the batch", async () => {
    const handler = (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/theatres") && !url.includes("/programming")) {
        return Promise.resolve(jsonResponse(readFixture("uci/theatres.json")));
      }
      if (url.includes("/programming/")) {
        return Promise.resolve(new Response("upstream error", { status: 503 }));
      }
      if (url.endsWith("/api/microservice/showings/cinemas")) {
        return Promise.resolve(jsonResponse(readFixture("thespace/cinemas.json")));
      }
      const tsFilms = url.match(/\/cinemas\/([^/]+)\/films/);
      if (tsFilms) {
        return Promise.resolve(jsonResponse(readFixture("thespace/films-roma-2026-09-24.json")));
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    };
    restore();
    restore = installFetch((input, init) => handler(input, init));

    const service = new CinemaService([new UciConnector(), new ThespaceConnector()]);
    const result = await service.getProgramming(
      ["uci:uci-cinemas-romaest-roma", "thespace:1021"],
      DATE,
    );
    expect(result.programs.length).toBe(1);
    expect(result.programs[0].cinema.id).toBe("thespace:1021");
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].cinemaId).toBe("uci:uci-cinemas-romaest-roma");
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
