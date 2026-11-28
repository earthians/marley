import { describe, expect, it } from "vitest";
import { temperatureInCelsius, toNumber } from "./format";

describe("format", () => {
	it("treats empty values as missing", () => {
		expect(toNumber(null)).toBe(null);
		expect(toNumber("")).toBe(null);
		expect(toNumber("0")).toBe(0);
	});
	it("converts Fahrenheit temperatures to Celsius", () => {
		expect(temperatureInCelsius("98.6")).toBe(37);
		expect(temperatureInCelsius("37.5")).toBe(37.5);
		expect(temperatureInCelsius("")).toBe(null);
	});
});
