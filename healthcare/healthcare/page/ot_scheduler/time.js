export const DAY_MINUTES = 24 * 60;
export const HOUR_SIZE = 96;
export const DAY_SIZE = 24 * HOUR_SIZE;
export const HOURS = Array.from({ length: 25 }, (_, hour) => hour);
// a start in the current 15-minute step still counts as now, as on the server (day_rules.py)
const NOW_GRACE_MINUTES = 15;

export function span(start, end) {
	const from = withinDay(start);
	const to = Math.max(withinDay(end < start ? DAY_MINUTES : end), from);
	return { top: pixels(from), height: pixels(to - from) };
}

export function placed(start, end) {
	const { top, height } = span(start, end);
	return { gridArea: "1 / 1", marginTop: top, height };
}

function pixels(minutes) {
	return `${(minutes / 60) * HOUR_SIZE}px`;
}

function withinDay(minutes) {
	return Math.min(Math.max(minutes, 0), DAY_MINUTES);
}

function toDate(value) {
	return new Date(String(value).replace(" ", "T"));
}

export function caseMinutes(booking) {
	return (toDate(booking.scheduled_end) - toDate(booking.scheduled_start)) / 60000;
}

export function caseOnDay(booking, day) {
	const midnight = new Date(`${day}T00:00:00`);
	const sinceMidnight = value => (toDate(value) - midnight) / 60000;
	const start = withinDay(sinceMidnight(booking.scheduled_start));
	return {
		start,
		end: Math.max(withinDay(sinceMidnight(booking.scheduled_end)), start),
	};
}

export function minutesOf(value) {
	const [hours, minutes] = String(value).split(" ").pop().split(":");
	return Number(hours) * 60 + Number(minutes);
}

export function clock(value) {
	return hourMinute(minutesOf(value));
}

export function hourMinute(minutes) {
	return `${twoDigits(Math.floor(minutes / 60))}:${twoDigits(minutes % 60)}`;
}

export function pastUntil(day) {
	if (day < today()) return DAY_MINUTES;
	if (day > today()) return 0;
	return minutesNow() - NOW_GRACE_MINUTES;
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
