import { describe, expect, it } from "vitest";
import { todayInRome, isValidDate, compareTime } from "../../src/dates.ts";

describe("dates", () => {
  it("todayInRome returns YYYY-MM-DD", () => {
    const v = todayInRome();
    expect(v).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("isValidDate accepts YYYY-MM-DD", () => {
    expect(isValidDate("2026-09-24")).toBe(true);
    expect(isValidDate("2026-13-40")).toBe(false);
    expect(isValidDate("not a date")).toBe(false);
  });

  it("compareTime orders HH:MM values lexicographically", () => {
    expect(compareTime("19:00", "21:00")).toBeLessThan(0);
    expect(compareTime("22:30", "20:00")).toBeGreaterThan(0);
    expect(compareTime("20:00", "20:00")).toBe(0);
  });
});
