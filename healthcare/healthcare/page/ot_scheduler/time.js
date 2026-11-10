// Times and dates as the board reads and shows them. A time is minutes since midnight.

// the board always shows the whole day, midnight to midnight, an hour to every HOUR_SIZE pixels
export const DAY_MINUTES = 24 * 60;
export const HOUR_SIZE = 96;
export const DAY_SIZE = 24 * HOUR_SIZE;
export const HOURS = Array.from({ length: 25 }, (_, hour) => hour);

// A position down a theatre's column, in pixels from midnight, kept inside the day; a case
// running past midnight is cut there
export function span(start, end) {
	const inside = minutes => Math.min(Math.max(minutes, 0), DAY_MINUTES);
	const from = inside(start);
	const to = Math.max(inside(end < start ? DAY_MINUTES : end), from);
	return { top: pixels(from), height: pixels(to - from) };
}

// Everything in a column shares one grid cell, placed down it by time
export function placed(start, end) {
	const { top, height } = span(start, end);
	return { gridArea: "1 / 1", marginTop: top, height };
}

function pixels(minutes) {
	return `${(minutes / 60) * HOUR_SIZE}px`;
}

// A case's length in minutes, from its full start and end, so one running past midnight counts
export function caseMinutes(booking) {
	const at = value => new Date(String(value).replace(" ", "T"));
	return (at(booking.scheduled_end) - at(booking.scheduled_start)) / 60000;
}

// Where a case sits on the board's `day`, in minutes since its midnight: one carried over from
// the night before starts at 00:00, one running past midnight stops at 24:00, and one on another
// day has no length at all
export function caseOnDay(booking, day) {
	const midnight = new Date(`${day}T00:00:00`);
	const at = value => (new Date(String(value).replace(" ", "T")) - midnight) / 60000;
	const inside = minutes => Math.min(Math.max(minutes, 0), DAY_MINUTES);
	const start = inside(at(booking.scheduled_start));
	return { start, end: Math.max(inside(at(booking.scheduled_end)), start) };
}

export function minutesOf(value) {
	const [hours, minutes] = String(value).split(" ").pop().split(":");
	return Number(hours) * 60 + Number(minutes);
}

export function clock(value) {
	const minutes = minutesOf(value);
	return `${twoDigits(Math.floor(minutes / 60))}:${twoDigits(minutes % 60)}`;
}

// Minutes since midnight before which `day` has passed: all of a past day, today up to one grid
// step (15 minutes) ago, as the server counts it, and none of a day still to come
export function pastUntil(day) {
	if (day < today()) return DAY_MINUTES;
	if (day > today()) return 0;
	return minutesNow() - 15;
}

export function minutesNow() {
	const now = new Date();
	return now.getHours() * 60 + now.getMinutes();
}

export function twoDigits(number) {
	return String(number).padStart(2, "0");
}

export function today() {
	return isoDate(new Date());
}

export function isoDate(date) {
	const offset = date.getTimezoneOffset() * 60000;
	return new Date(date - offset).toISOString().slice(0, 10);
}
