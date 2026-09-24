import { describe, expect, it } from "vitest";
import { CinemaService } from "../../src/service.ts";
import { UciConnector } from "../../src/connectors/uci.ts";
import { ThespaceConnector } from "../../src/connectors/thespace.ts";
import { todayInRome } from "../../src/dates.ts";
import { describeIntegration } from "../helpers.ts";

const live = describeIntegration();

live("live smoke test against UCI and The Space APIs", () => {
  it("lists cinemas from both chains", async () => {
    const service = new CinemaService([new UciConnector(), new ThespaceConnector()]);
    const cinemas = await service.listCinemas();
    expect(cinemas.length).toBeGreaterThan(60);
  }, 30_000);

  it("fetches showtimes for a Roma venue today", async () => {
    const service = new CinemaService([new UciConnector(), new ThespaceConnector()]);
    const cinemas = await service.listCinemas();
    const romaUci = cinemas.find(
      (c) => c.chain === "uci" && /Roma Est/.test(c.name),
    );
    expect(romaUci, "UCI Roma Est id should exist").toBeDefined();
    const programs = await service.getProgramming([romaUci!.id], todayInRome());
    expect(programs.failures).toEqual([]);
    expect(programs.programs[0].films.length).toBeGreaterThan(5);
  }, 30_000);
});
