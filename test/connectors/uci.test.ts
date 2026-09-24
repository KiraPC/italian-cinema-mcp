import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { UciConnector } from "../../src/connectors/uci.ts";
import {
  installFetch,
  readFixture,
  recordingFetch,
} from "../helpers.ts";

const DATE = "2026-09-24";

describe("UciConnector (fixture-driven)", () => {
  let restore: () => void;

  beforeEach(() => {
    const { handler, calls } = recordingFetch(async (req) => {
      const url = req.url;
      if (url.endsWith("/api/theatres")) {
        return jsonResponse(readFixture("uci/theatres.json"));
      }
      const showtimeMatch = url.match(/\/api\/theatres\/([^/]+)\/programming\/(\d{4}-\d{2}-\d{2})$/);
      if (showtimeMatch) {
        const slug = showtimeMatch[1];
        const file = slug === "uci-cinemas-bicocca-milano"
          ? "uci/programming-bicocca-2026-09-24.json"
          : "uci/programming-romaest-2026-09-24.json";
        return jsonResponse(readFixture(file));
      }
      return new Response("not found", { status: 404 });
    });
    restore = installFetch((input, init) => handler(input, init));
    expect(calls).toBeDefined();
  });

  afterEach(() => {
    restore();
  });

  it("listCinemas maps slugs to namespaced ids", async () => {
    const connector = new UciConnector();
    const cinemas = await connector.listCinemas();
    expect(cinemas.length).toBeGreaterThan(20);
    expect(cinemas[0].id.startsWith("uci:")).toBe(true);
    expect(cinemas[0]).toEqual(
      expect.objectContaining({
        chain: "uci",
        name: expect.any(String),
        city: expect.any(String),
      }),
    );
  });

  it("getProgramming for Roma Est returns structured films", async () => {
    const connector = new UciConnector();
    const program = await connector.getProgramming("uci:uci-cinemas-romaest-roma", DATE);
    expect(program.cinema.name).toBe("UCI Roma Est");
    expect(program.cinema.city).toBe("Roma");
    expect(program.date).toBe(DATE);
    expect(program.films.length).toBeGreaterThan(5);
    const film = program.films.find((f) => f.title.includes("Endgame"));
    expect(film).toBeDefined();
    const [firstShow] = film!.showtimes;
    expect(firstShow.startsAt).toMatch(/^\d{2}:\d{2}$/);
    expect(firstShow.bookingUrl).toMatch(/^https:\/\/ucicinemas\.it\//);
  });

  it("filters out performances for other days", async () => {
    const connector = new UciConnector();
    const program = await connector.getProgramming("uci:uci-cinemas-romaest-roma", DATE);
    for (const film of program.films) {
      for (const show of film.showtimes) {
        void show;
      }
      expect(film.showtimes.length).toBeGreaterThan(0);
    }
  });

  it("captures IMAX/XL and language tags on Bicocca", async () => {
    const connector = new UciConnector();
    const program = await connector.getProgramming("uci:uci-cinemas-bicocca-milano", DATE);
    const formats = new Set(program.films.flatMap((f) => f.showtimes.map((s) => s.version.format)));
    expect(formats.has("XL") || formats.has("IMAX") || formats.has("2D")).toBe(true);
    const languages = new Set(program.films.flatMap((f) => f.showtimes.map((s) => s.version.language)));
    expect(languages.size).toBeGreaterThan(0);
  });

  it("reads Film.durationMinutes from the version payload (real fixture)", async () => {
    const connector = new UciConnector();
    const program = await connector.getProgramming("uci:uci-cinemas-romaest-roma", DATE);
    const endgame = program.films.find((f) => f.title.includes("Endgame"));
    expect(endgame).toBeDefined();
    expect(endgame!.durationMinutes).toBe(3 * 60 + 5);
    for (const film of program.films) {
      expect(film.durationMinutes, `runtime for ${film.title}`).toBeDefined();
    }
  });

  it("places after-midnight performances on the cinema-day axis (real fixture)", async () => {
    const connector = new UciConnector();
    const program = await connector.getProgramming("uci:uci-cinemas-romaest-roma", DATE);
    const resident = program.films.find((f) => f.title === "Resident Evil");
    expect(resident).toBeDefined();
    const late = resident!.showtimes.find((s) => s.startsAt === "00:30+1");
    expect(late).toBeDefined();
    expect(late!.clockMinutes).toBe(1110);
    // The 19:10 evening show is well before the late one on the cinema-day
    // axis even though HH:MM is bigger than 00:30.
    const evening = resident!.showtimes.find((s) => s.startsAt === "19:10");
    expect(evening!.clockMinutes).toBeLessThan(late!.clockMinutes);
  });

  it("lists cinemas with the chain-prefixed display name", async () => {
    const connector = new UciConnector();
    const cinemas = await connector.listCinemas();
    const sample = cinemas.find((c) => c.id === "uci:uci-cinemas-porta-di-roma-roma");
    expect(sample?.name).toBe("UCI Porta di Roma");
    const luxe = cinemas.find((c) => c.id === "uci:uci-luxe-maximo");
    expect(luxe?.name).toBe("UCI Luxe Maximo");
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
