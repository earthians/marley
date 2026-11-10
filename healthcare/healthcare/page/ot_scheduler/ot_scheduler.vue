<script setup>
// The OT Scheduler: one day of every theatre. Theatres are columns, grouped by OT complex, and
// the whole day runs down them, scrolled to the usual working hours. Each case shows its cleaning
// time below it, blocked theatre time is hatched, and the practitioners away that day are listed
// above the board. A request from the pane dropped into a column is booked there; a case dragged
// elsewhere moves. The server checks every drop, so a refused one stays where it was.
import { computed, onMounted, ref, watch } from "vue";
import { Badge, Dialog, FormControl, ToastProvider } from "frappe-ui";
import { useHost } from "@framework/ui/island";

import BoardFilters from "./components/board_filters.vue";
import CaseCard from "./components/case_card.vue";
import DateBar from "./components/date_bar.vue";
import DropGhost from "./components/drop_ghost.vue";
import HourScale from "./components/hour_scale.vue";
import RequestPanel from "./components/request_panel.vue";
import RowWash from "./components/row_wash.vue";
import UnavailableBlock from "./components/unavailable_block.vue";
import { useBoardFeed } from "./composables/feed.js";
import { useBoardFilters } from "./composables/use_board_filters.js";
import { useBoardLoad } from "./composables/use_board_load.js";
import { useCaseActions } from "./composables/use_case_actions.js";
import { useDrop } from "./composables/use_drop.js";
import {
	caseOnDay,
	clock,
	DAY_SIZE,
	HOUR_SIZE,
	HOURS,
	minutesOf,
	pastUntil,
	placed,
	span,
	today,
} from "./time.js";

const props = defineProps({
	route: { type: Array, default: () => [] },
	query: { type: Object, default: () => ({}) },
});
const emit = defineEmits(["title", "actions"]);
const host = useHost();

const day = ref(props.query.date || today());
const company = ref(props.query.company || "");
const department = ref(props.query.department || "");
const { board, requests, postponed, load, current } = useBoardLoad({
	day,
	company,
	department,
});
// a viewer who cannot change bookings sees the board read-only, as does anyone while it loads
const canEdit = computed(() => current.value && Boolean(board.value.can_edit));
const filters = useBoardFilters();
const actions = useCaseActions({ canEdit, reload: load, open: openBooking });
const { reasonFor, reason, menuFor, previewFor } = actions;
const drag = useDrop({
	board,
	canEdit,
	bookingsIn,
	blocksIn,
	change: actions.change,
	askIfPossible: actions.askIfPossible,
	reschedule: actions.reschedule,
});
const { dragged, dropTheatre, plan } = drag;

// The whole day, midnight to midnight; any hour is bookable. A theatre's column is at least
// 144px wide and shares out whatever room the board has left.
const timeline = ref(null);
const boardGrid = computed(() => ({
	gridTemplateColumns: `56px repeat(${theatres.value.length}, minmax(144px, 1fr))`,
	gridTemplateRows: `auto ${DAY_SIZE}px`,
	gridAutoFlow: "column",
}));
const theatres = computed(() => board.value.complexes.flatMap(group => group.theatres));
const workStart = computed(() => minutesOf(board.value?.day_start || "08:00"));
const workEnd = computed(() => minutesOf(board.value?.day_end || "20:00"));
let scrolledDay = null;

onMounted(() => {
	emit("title", "OT Scheduler");
	load();
});
useBoardFeed(load);
// a new day opens at the start of working hours; a reload of the same day stays where it is
watch(board, scrollToWorkingHours, { flush: "post" });
// the page menu (the three dots)
watch(canEdit, editable => emit("actions", pageActions(editable)), { immediate: true });

function scrollToWorkingHours() {
	if (!timeline.value || scrolledDay === day.value) return;
	// a quarter of an hour early, so a case at the start of the day clears the theatre names
	timeline.value.scrollTop = ((workStart.value - 15) / 60) * HOUR_SIZE;
	scrolledDay = day.value;
}

function pageActions(editable) {
	if (!editable) return [];
	return [
		{ label: "New OT Booking", onClick: () => host.navigate?.("ot-booking/new") },
	];
}

// The day the board's cases are for. Next and Previous change `day` at once, but the cases shown
// are the old day's until the new day loads, and are placed against their own day meanwhile.
function boardDay() {
	return String(board.value?.date || day.value);
}

// a case whose time has passed stays put: it can only be rescheduled or cancelled
function hasPassed(booking) {
	return caseOnDay(booking, boardDay()).start < pastUntil(boardDay());
}

function isMovable(booking) {
	return (
		canEdit.value &&
		["Tentative", "Scheduled"].includes(booking.status) &&
		!hasPassed(booking)
	);
}

function bookingsIn(theatre) {
	return board.value.bookings.filter(booking => booking.theatre === theatre);
}

function blocksIn(theatre) {
	return board.value.blocks.filter(block => block.scope === theatre);
}

function casePlace(booking) {
	const { start, end } = caseOnDay(booking, boardDay());
	return placed(start, end);
}

function cleaningPlace(booking) {
	const { end } = caseOnDay(booking, boardDay());
	return placed(end, end + board.value.cleaning_minutes);
}

function theatreLabel(theatre) {
	return [theatre.label, theatre.service_unit_type].filter(Boolean).join(" · ");
}

function openBooking(name) {
	host.navigate?.(`ot-booking/${name}`);
}
</script>

<template>
	<div class="flex h-full flex-col gap-3 overflow-hidden p-5">
		<DateBar
			v-model:day="day"
			v-model:company="company"
			v-model:department="department"
			:board="board"
		>
			<BoardFilters
				v-if="board"
				v-model:practitioner="filters.practitioner.value"
				v-model:patient="filters.patient.value"
				v-model:theatre="filters.theatre.value"
				:board="board"
			/>
		</DateBar>

		<ToastProvider />

		<div
			v-if="board?.away.length"
			class="flex shrink-0 flex-wrap items-center gap-2 text-sm"
		>
			<span class="text-ink-gray-5">Away today</span>
			<Badge
				v-for="row in board.away"
				:key="`${row.practitioner} ${row.reason} ${row.from_time}`"
				theme="gray"
			>
				{{ row.practitioner_name }} &middot; {{ row.reason }}
				<template v-if="row.from_time"
					>{{ clock(row.from_time) }}&ndash;{{ clock(row.to_time) }}</template
				>
			</Badge>
		</div>

		<div class="flex min-h-0 flex-1 gap-3">
			<!-- shown for anyone who may edit, also while a new day loads, so the board does not
			     shift; dropping waits for the load (use_drop.js checks canEdit) -->
			<RequestPanel
				v-if="board?.can_edit"
				:requests="requests"
				:postponed="postponed"
				:dropping="
					Boolean(dragged?.booking && dragged.booking.status !== 'Postponed')
				"
				@pick="drag.pickRequest"
				@pick-postponed="drag.pickPostponed"
				@unschedule="drag.unschedule"
				@over="drag.clearGhost"
				@done="drag.endDrag"
			/>

			<p
				v-if="board && !board.complexes.length"
				class="p-8 text-center text-base text-ink-gray-5"
			>
				No operation theatres. Mark a Healthcare Service Unit Type as an OT to
				see its units here.
			</p>

			<div
				v-else-if="board"
				ref="timeline"
				class="flex-1 overflow-auto rounded-4 border border-outline-gray-2"
				@scroll="previewFor = null"
			>
				<!-- one grid, so the hours and the theatres scroll together, with both pinned -->
				<div class="grid min-h-full w-max min-w-full" :style="boardGrid">
					<div
						class="sticky left-0 top-0 z-30 border-b border-outline-gray-2 bg-surface-base"
					/>
					<HourScale />
					<template v-for="group in board.complexes" :key="group.name">
						<template
							v-for="(theatre, index) in group.theatres"
							:key="theatre.name"
						>
							<div
								class="sticky top-0 z-20 border-b border-l border-outline-gray-2 bg-surface-base p-2"
								@dragover.prevent="drag.dragOver(theatre.name, null)"
								@drop.prevent="drag.drop(theatre.name)"
							>
								<p
									class="truncate text-xs font-semibold text-ink-gray-7"
									:class="index && 'invisible'"
								>
									{{ group.name || "Theatres" }}
								</p>
								<p class="truncate text-base text-ink-gray-8">
									{{ theatre.label }}
								</p>
								<p class="truncate text-xs text-ink-gray-5">
									{{ theatre.service_unit_type }}
								</p>
							</div>
							<div
								class="relative isolate grid overflow-hidden border-l border-outline-gray-1 px-1"
								:class="[
									dropTheatre === theatre.name && 'bg-surface-gray-1',
									filters.theatreDimmed(theatre.name) && 'opacity-40',
								]"
								@dragover.prevent="drag.dragOver(theatre.name, $event)"
								@dragleave="dropTheatre = null"
								@drop.prevent="drag.drop(theatre.name)"
							>
								<RowWash :work-start="workStart" :work-end="workEnd" />
								<span
									v-for="hour in HOURS"
									:key="hour"
									class="absolute inset-x-0 -z-10 border-t border-outline-gray-1"
									:style="span(hour * 60, hour * 60)"
								/>
								<UnavailableBlock
									v-for="block in blocksIn(theatre.name)"
									:key="block.name"
									:block="block"
									:open="previewFor === block.name"
									@update:open="
										open => actions.previewOpened(block, open)
									"
									@view="
										name =>
											host.navigate?.(
												`practitioner-availability/${name}`,
											)
									"
									:place="
										placed(
											minutesOf(block.start_time),
											minutesOf(block.end_time),
										)
									"
								/>
								<CaseCard
									v-for="booking in bookingsIn(theatre.name)"
									:key="booking.name"
									:booking="booking"
									:dimmed="filters.caseDimmed(booking)"
									:theatre-label="theatreLabel(theatre)"
									:cleaning-minutes="board.cleaning_minutes"
									:menu-options="actions.menuOf(booking)"
									:menu-open="menuFor === booking.name"
									@update:menu-open="
										open => actions.menuOpened(booking, open)
									"
									:preview-open="previewFor === booking.name"
									@update:preview-open="
										open => actions.previewOpened(booking, open)
									"
									:movable="isMovable(booking)"
									:passed="hasPassed(booking)"
									:place="casePlace(booking)"
									:cleaning-place="cleaningPlace(booking)"
									@pick="event => drag.pickBooking(booking, event)"
									@drop-end="drag.endDrag"
								/>
								<DropGhost
									v-if="plan && dropTheatre === theatre.name"
									:plan="plan"
								/>
							</div>
						</template>
					</template>
				</div>
			</div>
		</div>

		<Dialog
			:open="Boolean(reasonFor)"
			title="Reason for this change"
			message="The list for this day is committed, so say why the case is changing."
			:actions="[
				{
					label: reasonFor?.action || 'Save',
					variant: 'solid',
					onClick: actions.changeWithReason,
				},
			]"
			@update:open="open => !open && (reasonFor = null)"
		>
			<FormControl v-model="reason" type="textarea" placeholder="Reason" />
		</Dialog>
	</div>
</template>

<style>
/* not scoped: unavailable_block.vue hatches its blocks the same way */
.ot-hatch {
	background-image: repeating-linear-gradient(
		45deg,
		transparent 0 6px,
		var(--outline-gray-2, rgba(0, 0, 0, 0.08)) 6px 7px
	);
}
</style>
