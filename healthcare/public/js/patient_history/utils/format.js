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
