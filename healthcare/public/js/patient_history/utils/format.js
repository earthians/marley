export function formatDate(value, pattern = "DD MMM YYYY") {
	const date = window.moment(value);
	return date.isValid() ? date.format(pattern) : "";
}
export function formatDateTime(value, pattern = "DD MMM YYYY, hh:mm A") {
	return formatDate(value, pattern);
}
export function isoDate(value) {
	const date = window.moment(value);
	return date.isValid() ? date.format("YYYY-MM-DD") : null;
}
export function timestamp(value) {
	const date = window.moment(value);
	return date.isValid() ? date.valueOf() : NaN;
}
export function toNumber(value) {
	if (value === null || value === undefined || value === "") return null;
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}
export function vitalTime(row) {
	return timestamp(`${row.signs_date || ""} ${row.signs_time || "00:00:00"}`);
}
export function temperatureInCelsius(value) {
	const number = toNumber(value);
	if (number === null) return null;
	return number > 50 ? Math.round(((number - 32) * 50) / 9) / 10 : number;
}
