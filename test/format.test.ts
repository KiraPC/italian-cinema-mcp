import { describe, expect, it } from "vitest";
import { formatProgramming } from "../../src/format.ts";
import type { CinemaProgramming } from "../../src/types.ts";

const DATE = "2026-09-24";

function cinema(id: string, name: string, city: string) {
  return {
    id,
    chain: (id.startsWith("thespace:") ? "thespace" : "uci") as "uci" | "thespace",
    name,
    city,
  };
}

describe("formatProgramming", () => {
  it("groups showtimes by film and then by cinema", () => {
    const programming: CinemaProgramming[] = [
      {
        cinema: cinema("uci:rome-east", "UCI Roma Est", "Roma"),
        date: DATE,
        films: [
          {
            title: "Resident Evil",
            durationMinutes: 115,
            showtimes: [
              { startsAt: "19:10", version: { format: "2D", language: "ITA" }, soldOut: false },
              { startsAt: "21:40", version: { format: "2D", language: "ITA" }, soldOut: true },
            ],
          },
        ],
      },
      {
        cinema: cinema("thespace:1021", "The Space Roma Moderno", "Roma"),
        date: DATE,
        films: [
          {
            title: "Resident Evil",
            durationMinutes: 115,
            showtimes: [
              { startsAt: "19:10", version: { format: "IMAX", language: "ITA" }, soldOut: false },
            ],
          },
        ],
      },
    ];
    const out = formatProgramming(programming, { includeLinks: false });
    expect(out).toMatch(/Resident Evil \(1h55\)/);
    expect(out).toMatch(/UCI Roma Est[\s\S]*19:10[\s\S]*21:40 \(sold out\)/);
    expect(out).toMatch(/The Space Roma Moderno[\s\S]*19:10 IMAX/);
    expect(out).not.toMatch(/2D ITA/);
  });

  it("returns 'No showtimes available.' for empty input", () => {
    expect(formatProgramming([], { includeLinks: false })).toBe(
      "No showtimes available.",
    );
  });

  it("includes booking links when requested", () => {
    const programming: CinemaProgramming[] = [
      {
        cinema: cinema("uci:rome-east", "UCI Roma Est", "Roma"),
        date: DATE,
        films: [
          {
            title: "Resident Evil",
            showtimes: [
              {
                startsAt: "19:10",
                version: { format: "2D" },
                soldOut: false,
                bookingUrl: "https://ucicinemas.it/movies/x",
              },
            ],
          },
        ],
      },
    ];
    const out = formatProgramming(programming, { includeLinks: true });
    expect(out).toMatch(/ucicinemas\.it\/movies\/x/);
  });

  it("normalises EN/OV and keeps non-default format tabs, drops defaults", () => {
    const programming: CinemaProgramming[] = [
      {
        cinema: cinema("uci:rome-east", "UCI Roma Est", "Roma"),
        date: DATE,
        films: [
          {
            title: "Heart of the Beast",
            showtimes: [
              { startsAt: "20:00", version: { format: "2D", language: "ENG" }, soldOut: false },
              { startsAt: "20:30", version: { format: "IMAX", language: "ITALIANO" }, soldOut: false },
              { startsAt: "21:00", version: { format: "2D", language: "OV" }, soldOut: false },
              { startsAt: "22:00", version: { format: "XL", language: "ITA" }, soldOut: false },
            ],
          },
        ],
      },
    ];
    const out = formatProgramming(programming, { includeLinks: false });
    expect(out).toContain("20:00 EN");
    expect(out).toContain("20:30 IMAX");
    expect(out).toContain("21:00 OV");
    expect(out).toContain("22:00 XL");
    expect(out).not.toMatch(/ITALIANO/);
    const def = formatProgramming([
      {
        cinema: cinema("uci:rome-east", "UCI Roma Est", "Roma"),
        date: DATE,
        films: [
          {
            title: "Default",
            showtimes: [{ startsAt: "20:00", version: { format: "2D", language: "ITA" }, soldOut: false }],
          },
        ],
      },
    ], { includeLinks: false });
    expect(def).toContain("20:00");
    expect(def).not.toMatch(/2D/);
    expect(def).not.toMatch(/ITA/);
  });

  it("aligns the cinema column to the longest name in the block", () => {
    const programming: CinemaProgramming[] = [
      {
        cinema: cinema("thespace:1030", "The Space Vimercate", "Milano"),
        date: DATE,
        films: [
          {
            title: "X",
            showtimes: [{ startsAt: "20:00", version: { format: "2D", language: "ITA" }, soldOut: false }],
          },
        ],
      },
      {
        cinema: cinema("uci:rome-east", "UCI Roma Est", "Roma"),
        date: DATE,
        films: [
          {
            title: "X",
            showtimes: [{ startsAt: "21:00", version: { format: "2D", language: "ITA" }, soldOut: false }],
          },
        ],
      },
    ];
    const out = formatProgramming(programming, { includeLinks: false });
    const lines = out.split("\n").slice(1).filter((l) => l.includes("20:00") || l.includes("21:00"));
    expect(lines[0].indexOf("20:00") - lines[0].indexOf("The Space Vimercate"))
      .toBeGreaterThanOrEqual(2);
  });

  it("renders an inline 'none in window' note per cinema when only that cinema is filtered", () => {
    const programming: CinemaProgramming[] = [
      {
        cinema: cinema("uci:maximo", "UCI Luxe Maximo", "Roma"),
        date: DATE,
        films: [
          {
            title: "Resident Evil",
            showtimes: [],
            outOfWindow: [
              {
                cinemaId: "uci:maximo",
                cinemaName: "UCI Luxe Maximo",
                before: 4,
                lastBefore: "18:30",
                after: 0,
              },
            ],
          },
        ],
      },
      {
        cinema: cinema("thespace:roma", "The Space Roma Moderno", "Roma"),
        date: DATE,
        films: [
          {
            title: "Resident Evil",
            showtimes: [
              { startsAt: "21:10", version: { format: "2D", language: "ITA" }, soldOut: false },
              { startsAt: "22:00", version: { format: "IMAX", language: "ITA" }, soldOut: false },
            ],
          },
        ],
      },
    ];
    const out = formatProgramming(programming, { includeLinks: false });
    expect(out).toMatch(/Resident Evil/);
    expect(out).toMatch(/UCI Luxe Maximo\s+— none in window \(4 earlier, last 18:30\)/);
    expect(out).toMatch(/The Space Roma Moderno\s+21:10, 22:00 IMAX/);
    expect(out).not.toMatch(/Outside the time window/);
  });

  it("appends a single trailing 'Outside the time window' line when a film has no in-window shows anywhere", () => {
    const programming: CinemaProgramming[] = [
      {
        cinema: cinema("uci:maximo", "UCI Luxe Maximo", "Roma"),
        date: DATE,
        films: [
          {
            title: "L'isola dei ricordi",
            showtimes: [],
            outOfWindow: [
              { cinemaId: "uci:maximo", cinemaName: "UCI Luxe Maximo", before: 2, lastBefore: "17:40", after: 0 },
            ],
          },
        ],
      },
      {
        cinema: cinema("thespace:roma", "The Space Roma Moderno", "Roma"),
        date: DATE,
        films: [
          {
            title: "Spider-Man",
            showtimes: [],
            outOfWindow: [
              { cinemaId: "thespace:roma", cinemaName: "The Space Roma Moderno", before: 3, lastBefore: "15:50", after: 0 },
            ],
          },
        ],
      },
    ];
    const out = formatProgramming(programming, { includeLinks: false });
    expect(out).toContain("Outside the time window:");
    expect(out).toMatch(/L'isola dei ricordi \(UCI Luxe Maximo 17:40\)/);
    expect(out).toMatch(/Spider-Man \(The Space Roma Moderno 15:50\)/);
    expect(out).not.toMatch(/— none in window/);
    expect(out).not.toMatch(/L'isola dei ricordi\(?\s*\n/);
  });

  it("emits 'later' wording when only to_time drops shows", () => {
    const programming: CinemaProgramming[] = [
      {
        cinema: cinema("uci:maximo", "UCI Luxe Maximo", "Roma"),
        date: DATE,
        films: [
          {
            title: "L'isola dei ricordi",
            showtimes: [],
            outOfWindow: [
              { cinemaId: "uci:maximo", cinemaName: "UCI Luxe Maximo", before: 0, after: 2, firstAfter: "23:10" },
            ],
          },
        ],
      },
      {
        cinema: cinema("thespace:roma", "The Space Roma Moderno", "Roma"),
        date: DATE,
        films: [
          {
            title: "L'isola dei ricordi",
            showtimes: [
              { startsAt: "20:30", version: { format: "2D", language: "ITA" }, soldOut: false },
            ],
          },
        ],
      },
    ];
    const out = formatProgramming(programming, { includeLinks: false });
    expect(out).toMatch(/UCI Luxe Maximo\s+— none in window \(2 later, first 23:10\)/);
  });
});
