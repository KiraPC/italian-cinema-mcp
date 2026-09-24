import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { ThespaceConnector } from "../../src/connectors/thespace.ts";
import { installFetch, readFixture } from "../helpers.ts";

const DATE = "2026-09-24";

describe("ThespaceConnector (fixture-driven)", () => {
  let restore: () => void;

  beforeEach(() => {
    const handler = (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/microservice/showings/cinemas")) {
        return Promise.resolve(jsonResponse(readFixture("thespace/cinemas.json")));
      }
      const filmMatch = url.match(/\/api\/microservice\/showings\/cinemas\/([^/]+)\/films/);
      if (filmMatch) {
        const id = filmMatch[1];
        const file = id === "1030"
          ? "thespace/films-vimercate-2026-09-24.json"
          : id === "1021"
          ? "thespace/films-roma-2026-09-24.json"
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

  it("listCinemas returns 35 cinemas with namespaced ids and a The Space-prefixed display name", async () => {
    const connector = new ThespaceConnector();
    const cinemas = await connector.listCinemas();
    expect(cinemas).toHaveLength(35);
    const roma = cinemas.find((c) => c.id === "thespace:1021");
    expect(roma).toBeDefined();
    expect(roma!.name).toBe("The Space Roma Moderno");
    expect(roma!.city).toBe("Roma");
    expect(roma!.province).toBe("Roma");
    const vimercate = cinemas.find((c) => c.id === "thespace:1030");
    expect(vimercate?.name).toBe("The Space Vimercate");
    expect(vimercate?.city).toBe("Vimercate");
    expect(vimercate?.province).toBe("Monza-Brianza");
    const guidonia = cinemas.find((c) => c.id === "thespace:1007");
    expect(guidonia?.city).toBe("Guidonia Montecelio");
    expect(guidonia?.province).toBe("Roma");
  });

  it("uses the parser fallback for unknown The Space ids (defensive)", async () => {
    // Inject an unknown id via a hand-built response that bypasses the static map.
    const restoreUnknown = installFetch((input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/microservice/showings/cinemas")) {
        return Promise.resolve(
          jsonResponse({
            result: [
              { alpha: "?", cinemas: [
                { cinemaId: "9999", cinemaName: "Test Cinema", fullName: "Cosenza, Cosenza, The Space", itemName: null },
              ] },
            ],
          }),
        );
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    try {
      const connector = new ThespaceConnector();
      const cinemas = await connector.listCinemas();
      const c = cinemas.find((x) => x.id === "thespace:9999");
      expect(c?.city).toBe("Cosenza");
      expect(c?.province).toBe("Cosenza");
    } finally {
      restoreUnknown();
    }
  });

  it("getProgramming maps Rozzano films with attributes and sold-out flag", async () => {
    const connector = new ThespaceConnector();
    const program = await connector.getProgramming(
      "thespace:1021",
      DATE,
    );
    expect(program.films.length).toBeGreaterThan(0);
    const avengers = program.films.find((f) => f.title.includes("AVENGERS"));
    expect(avengers).toBeDefined();
    expect(avengers!.showtimes.length).toBeGreaterThan(0);
    const sample = avengers!.showtimes[0];
    expect(sample.startsAt).toMatch(/^\d{2}:\d{2}$/);
    expect(sample.version.language).toBe("ITALIANO");
    expect(sample.version.format).toBe("2D");
    expect(sample.bookingUrl).toMatch(/^https:\/\/www\.thespacecinema\.it\//);
  });

  it("captures and tolerates sold-out sessions if any", async () => {
    const connector = new ThespaceConnector();
    const program = await connector.getProgramming("thespace:1030", DATE);
    const totalShows = program.films.reduce((acc, f) => acc + f.showtimes.length, 0);
    expect(totalShows).toBeGreaterThan(20);
  });

  it("places after-midnight sessions on the cinema-day axis (real fixture)", async () => {
    const connector = new ThespaceConnector();
    const program = await connector.getProgramming("thespace:1030", DATE);
    const avengers = program.films.find((f) => f.title.toUpperCase().includes("AVENGERS"));
    expect(avengers).toBeDefined();
    const late = avengers!.showtimes.find((s) => s.startsAt === "01:00+1");
    expect(late).toBeDefined();
    expect(late!.clockMinutes).toBe(1140);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
