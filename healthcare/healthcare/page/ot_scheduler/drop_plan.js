import { hourMinute } from "./time.js";

export const SNAP_MINUTES = 15;
// a first drop this close after the cases before it snaps to the end of their cleaning
const MAGNET_MINUTES = 30;
const UNDER_WAY = ["In Progress", "Completed"];
// a transparent image in place of the browser's drag picture: the ghost in the column shows the case
const NO_IMAGE =
	typeof Image === "undefined"
		? null
		: Object.assign(new Image(), {
				src: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
		  });

export function hideDragImage(event) {
	if (NO_IMAGE?.complete) event.dataTransfer.setDragImage(NO_IMAGE, 0, 0);
}

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
	const problem = dropProblem({
		cases,
		blocks,
		start,
		end,
		pushes,
		holiday,
		emergency,
		pastUntil,
	});
	return {
		start,
		end,
		pushes,
		problem,
		needsReason: pushes.some(push => push.status === "Scheduled"),
		label: problem || dropLabel({ blocks, start, end, pushes, dayEnd, emergency }),
	};
}

function dropProblem({
	cases,
	blocks,
	start,
	end,
	pushes,
	holiday,
	emergency,
	pastUntil,
}) {
	if (start < pastUntil) return "That time has passed";
	if (holiday && !emergency) return `${holiday} is a theatre holiday`;
	return findProblem({ cases, blocks, start, end, pushes, emergency });
}

function dropLabel({ blocks, start, end, pushes, dayEnd, emergency }) {
	const lastEnd = Math.max(end, ...pushes.map(push => push.end));
	const late = lastEnd > dayEnd ? `Runs past ${hourMinute(dayEnd)}` : "";
	const overBlock = emergency && blockedBy(blocks, [{ start, end }]);
	const warning = overBlock ? `Emergency in blocked ${blockedText(overBlock)}` : "";
	return [result(start, end, pushes), late, warning].filter(Boolean).join(" · ");
}

function pushesAfter(cases, start, end, cleaning) {
	const pushes = [];
	let freeFrom = end + cleaning;
	const later = cases
		.filter(other => other.start >= start)
		.sort((a, b) => a.start - b.start);
	for (const item of later) {
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
