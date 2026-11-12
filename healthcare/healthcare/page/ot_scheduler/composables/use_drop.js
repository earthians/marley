import { ref } from "vue";

import { toastError } from "../api.js";
import { hideDragImage, planDrop, snapFirstDrop, snapToGrid } from "../drop_plan.js";
import { playDropSound } from "../sounds.js";
import {
	caseMinutes,
	caseOnDay,
	DAY_MINUTES,
	minutesOf,
	hourMinute,
	pastUntil,
} from "../time.js";

export function useDrop({
	board,
	canEdit,
	bookingsIn,
	blocksIn,
	change,
	askIfPossible,
	reschedule,
}) {
	const dragged = ref(null);
	const dropTheatre = ref(null);
	const plan = ref(null);

	function pickRequest(request, event) {
		pick(
			{ request, grab: null, length: Math.round(request.duration / 60) },
			request.name,
			event,
		);
	}

	function pickPostponed(booking, event) {
		pick(
			{ booking, grab: null, length: caseMinutes(booking) },
			booking.name,
			event,
		);
	}

	function pick(drag, name, event) {
		dragged.value = drag;
		plan.value = null;
		event.dataTransfer.setData("text/plain", name);
		hideDragImage(event);
	}

	function unschedule() {
		const booking = dragged.value?.booking;
		endDrag();
		if (booking && booking.status !== "Postponed") reschedule(booking, true);
	}

	function clearGhost() {
		dropTheatre.value = null;
		plan.value = null;
	}

	function endDrag() {
		dragged.value = null;
		clearGhost();
	}

	function pickBooking(booking, event) {
		const block = event.currentTarget.getBoundingClientRect();
		const lane = event.currentTarget.parentElement.getBoundingClientRect();
		const grab = alongLane(event, lane, block);
		pick({ booking, grab, length: caseMinutes(booking) }, booking.name, event);
	}

	function dragOver(theatre, event) {
		if (!canEdit.value || !dragged.value) return;
		dropTheatre.value = theatre;
		const drag = dragged.value;
		const cleaning = drag.booking
			? cleaningOf(drag.booking)
			: board.value.cleaning_minutes;
		const cases = columnCases(theatre, drag.booking?.name);
		plan.value = planDrop({
			cases,
			blocks: columnBlocks(theatre),
			start: dropStart(drag, cases, event),
			length: drag.length,
			cleaning,
			dayEnd: minutesOf(board.value.day_end),
			holiday: fullHoliday(),
			pastUntil: pastUntil(String(board.value.date)),
			emergency: Boolean(
				drag.request?.is_emergency || drag.booking?.is_emergency,
			),
		});
	}

	// over the theatre's name there is no cursor time, so the case lands at the start of the day
	function dropStart(drag, cases, event) {
		const workStart = minutesOf(board.value.day_start);
		if (!event)
			return drag.grab === null ? snapFirstDrop(cases, workStart) : workStart;
		const at = cursorMinutes(event);
		return drag.grab === null
			? snapFirstDrop(cases, at)
			: snapToGrid(at - drag.grab);
	}

	function columnBlocks(theatre) {
		return blocksIn(theatre).map(block => ({
			start: minutesOf(block.start_time),
			end: minutesOf(block.end_time),
		}));
	}

	function fullHoliday() {
		const holiday = board.value.holiday;
		return holiday && !holiday.is_half_day ? holiday.description : null;
	}

	function columnCases(theatre, leaving) {
		return bookingsIn(theatre)
			.filter(booking => booking.name !== leaving)
			.map(booking => ({
				name: booking.name,
				patient_name: booking.patient_name,
				status: booking.status,
				is_emergency: booking.is_emergency,
				cleaning: cleaningOf(booking),
				...caseOnDay(booking, String(board.value.date)),
			}));
	}

	function cleaningOf(booking) {
		return booking.cleaning_minutes ?? board.value.cleaning_minutes;
	}

	function cursorMinutes(event) {
		return alongLane(event, event.currentTarget.getBoundingClientRect());
	}

	function alongLane(event, lane, from = lane) {
		return ((event.clientY - from.top) / lane.height) * DAY_MINUTES;
	}

	function atTime(minutes) {
		return `${board.value.date} ${hourMinute(minutes)}:00`;
	}

	function drop(theatre) {
		dropTheatre.value = null;
		const drag = dragged.value;
		const landing = plan.value;
		dragged.value = null;
		plan.value = null;
		if (!drag || !landing) return;
		if (landing.problem) {
			toastError(landing.problem);
			return playDropSound("refused");
		}
		const start = atTime(landing.start);
		if (drag.request) {
			const booking = { service_request: drag.request.name, theatre, start };
			if (landing.needsReason)
				return askIfPossible("book_request", booking, "Add", true);
			return change("book_request", booking, true);
		}
		const move = { name: drag.booking.name, theatre, start };
		if (drag.booking.needs_reason || landing.needsReason)
			return askIfPossible("move_booking", move, "Move", true);
		change("move_booking", move, true);
	}

	return {
		dragged,
		dropTheatre,
		plan,
		pickRequest,
		pickPostponed,
		pickBooking,
		dragOver,
		drop,
		unschedule,
		clearGhost,
		endDrag,
	};
}
