// Where a dragged case would land in a theatre's column, and what the drop would do there. It follows
// the server's rules for one theatre (ot_booking/push.py), so the board can show a drop's result
// before it is made; the server still checks every drop. Times are minutes since midnight.

import { twoDigits } from "./time.js";

export const SNAP_MINUTES = 15;
const UNDER_WAY = ["In Progress", "Completed"];
// A 1×1 transparent image, so the browser draws no drag image and the ghost in the column is all
// that shows. It is made when the page loads: an image made at drag start has not loaded yet,
// and the browser would not use it. There is no Image outside a browser, as in a script check.
const NO_IMAGE =
	typeof Image === "undefined"
		? null
		: Object.assign(new Image(), {
				src: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
		  });

export function hideDragImage(event) {
	if (NO_IMAGE?.complete) event.dataTransfer.setDragImage(NO_IMAGE, 0, 0);
}

// A first drop lands where it is dropped, on the grid, unless that is inside the case before it,
// its cleaning, or just after them: then it snaps straight after that case. Every case keeps
// its own cleaning time (`cleaning` on each).
const MAGNET_MINUTES = 30;

export function snapFirstDrop(cases, at) {
	const dropped = snapToGrid(at);
	const before = cases.filter(item => item.start < at);
	if (!before.length) return dropped;
	const free = Math.max(...before.map(item => item.end + item.cleaning));
	return dropped < free + MAGNET_MINUTES ? free : dropped;
}

export function snapToGrid(minutes) {
	return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

// `holiday` is the day's full theatre holiday, if any: only an emergency may be booked on it
export function planDrop({
	cases,
	blocks,
	start,
	length,
	cleaning,
	dayEnd,
	holiday,
	emergency,
	pastUntil,
}) {
	const end = start + length;
	const pushes = pushesAfter(cases, start, end, cleaning);
	const problem =
		start < pastUntil
			? "That time has passed"
			: holiday && !emergency
			  ? `${holiday} is a theatre holiday`
			  : findProblem({ cases, blocks, start, end, pushes, emergency });
	const lastEnd = Math.max(end, ...pushes.map(push => push.end));
	const late = lastEnd > dayEnd ? `Runs past ${hourMinute(dayEnd)}` : "";
	const overBlock = emergency && blockedBy(blocks, [{ start, end }]);
	const warning = overBlock ? `Emergency in blocked ${blockedText(overBlock)}` : "";
	return {
		start,
		end,
		pushes,
		problem,
		needsReason: pushes.some(push => push.status === "Scheduled"),
		label:
			problem ||
			[result(start, end, pushes), late, warning].filter(Boolean).join(" · "),
	};
}

// The cases after the drop that must move back, just enough to keep each one's cleaning time
// before the next; `cleaning` is the dropped case's own
function pushesAfter(cases, start, end, cleaning) {
	const pushes = [];
	let freeFrom = end + cleaning;
	for (const item of cases
		.filter(other => other.start >= start)
		.sort((a, b) => a.start - b.start)) {
		if (item.start >= freeFrom) break;
		const length = item.end - item.start;
		pushes.push({
			...item,
			start: freeFrom,
			end: freeFrom + length,
			shift: freeFrom - item.start,
		});
		freeFrom += length + item.cleaning;
	}
	return pushes;
}

// An emergency may go into blocked theatre time (the server only warns), so only the
// non-emergency cases, the dropped one and those it pushes, are checked against blocks
function findProblem({ cases, blocks, start, end, pushes, emergency }) {
	const overlapped = cases.find(
		item => item.start < start && item.end + item.cleaning > start,
	);
	if (overlapped) return `Overlaps ${overlapped.patient_name}`;
	const underWay = pushes.find(push => UNDER_WAY.includes(push.status));
	if (underWay) return `${underWay.patient_name} is under way and cannot be pushed`;
	const spans = [{ start, end, is_emergency: emergency }, ...pushes];
	const blocked = blockedBy(
		blocks,
		spans.filter(span => !span.is_emergency),
	);
	return blocked ? `Theatre blocked ${blockedText(blocked)}` : "";
}

function blockedBy(blocks, spans) {
	return blocks.find(block =>
		spans.some(span => span.start < block.end && block.start < span.end),
	);
}

function blockedText(block) {
	return `${hourMinute(block.start)}–${hourMinute(block.end)}`;
}

function result(start, end, pushes) {
	if (!pushes.length) return `Fits ${hourMinute(start)}–${hourMinute(end)}`;
	return `Pushes ${pushes.length} case(s) back by ${pushes[0].shift} min`;
}

function hourMinute(minutes) {
	return `${twoDigits(Math.floor(minutes / 60))}:${twoDigits(minutes % 60)}`;
}
