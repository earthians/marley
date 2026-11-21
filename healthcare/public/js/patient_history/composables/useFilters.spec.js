import { describe, expect, it } from "vitest";
import { useFilters } from "./useFilters";

describe("useFilters", () => {
  it("keeps ISO date, doctype and selected-day state together", () => {
    const { filters, dateRange, setDay, clear } = useFilters();
    filters.doctypes = ["Vital Signs"];
    filters.from = "2026-10-01";
    filters.to = "2026-10-12";
    expect(dateRange.value).toEqual(["2026-10-01", "2026-10-12"]);
    setDay("2026-10-13");
    expect([filters.day, filters.from, filters.to]).toEqual(["2026-10-13", "2026-10-13", "2026-10-13"]);
    clear();
    expect({ ...filters }).toEqual({ doctypes: [], from: null, to: null, day: null });
  });
});
