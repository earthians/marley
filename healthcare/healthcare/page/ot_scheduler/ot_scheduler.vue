<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { Badge, Button, Dialog, FormControl, ToastProvider } from "frappe-ui";
import { useHost } from "@framework/ui/island";

import BoardFilters from "./components/board_filters.vue";
import CaseCard from "./components/case_card.vue";
import DateBar from "./components/date_bar.vue";
import DayList from "./components/day_list.vue";
import DropGhost from "./components/drop_ghost.vue";
import HourScale from "./components/hour_scale.vue";
import RequestPanel from "./components/request_panel.vue";
import RowWash from "./components/row_wash.vue";
import SlotHighlight from "./components/slot_highlight.vue";
import UnavailableBlock from "./components/unavailable_block.vue";
import { useBoardFeed } from "./composables/feed.js";
import { useBoardFilters } from "./composables/use_board_filters.js";
import { useBoardLoad } from "./composables/use_board_load.js";
import { useCaseActions } from "./composables/use_case_actions.js";
import { useDrop } from "./composables/use_drop.js";
import { useSlots } from "./composables/use_slots.js";
import { dayActions } from "./publish.js";
import {
	caseOnDay,
	clock,
	DAY_SIZE,
	HOUR_SIZE,
	HOURS,
	minutesNow,
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
const {
	board,
	requests,
	postponed,
	load,
	filters: boardFilters,
	current,
} = useBoardLoad({
	day,
	company,
	department,
});
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
const slots = useSlots({ day, filters: boardFilters, change: actions.change });
const { finder, picked } = slots;
watch([company, department], slots.close);
const tentativeCount = computed(() => countOf("Tentative"));
const paneOpen = ref(false);
const filterCount = computed(
	() =>
		[
			department.value,
			filters.practitioner.value,
			filters.patient.value,
			filters.theatre.value,
		].filter(Boolean).length,
);

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
const now = ref(minutesNow());
const nowLine = computed(() => (boardDay() === today() ? now.value : null));
let clockTimer = null;

onMounted(() => {
	emit("title", "OT Scheduler");
	load();
	clockTimer = setInterval(() => (now.value = minutesNow()), 60000);
});
onUnmounted(() => clearInterval(clockTimer));
useBoardFeed(load);
watch(board, scrollToOpening, { flush: "post" });
watch([tentativeCount, canEdit, day], sendActions, { immediate: true });

function scrollToOpening() {
	if (!timeline.value || scrolledDay === day.value) return;
	const opening = nowLine.value === null ? workStart.value - 15 : nowLine.value - 60;
	timeline.value.scrollTop = (Math.max(opening, 0) / 60) * HOUR_SIZE;
	scrolledDay = day.value;
}

function sendActions([count, editable, shownDay]) {
	const day = {
		day: shownDay,
		company: board.value?.company,
		department: department.value,
	};
	const context = { ...day, filters: boardFilters(), host, reload: load };
	const newBooking = () => host.navigate?.("ot-booking/new");
	const report = () => openDaySchedule();
	emit(
		"actions",
		dayActions({ editable, count, shownDay, newBooking, report, ...context }),
	);
}

function openDaySchedule() {
	const params = { date: day.value, ...boardFilters(), ...filters.sheetFilters() };
	window.open(
		`/desk/query-report/OT%20Day%20Schedule?${new URLSearchParams(params)}`,
		"_blank",
	);
}

function countOf(status) {
	return (
		board.value?.bookings.filter(booking => booking.status === status).length || 0
	);
}

// the day of the cases shown, which lags `day` until a new day loads
function boardDay() {
	return String(board.value?.date || day.value);
}

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

function cleaningOf(booking) {
	return booking.cleaning_minutes ?? board.value.cleaning_minutes;
}

function cleaningPlace(booking) {
	const { end } = caseOnDay(booking, boardDay());
	return placed(end, end + cleaningOf(booking));
}

function theatreLabel(theatre) {
	return [theatre.label, theatre.service_unit_type].filter(Boolean).join(" · ");
}

function openBooking(name) {
	host.navigate?.(`ot-booking/${name}`);
}

function pickFromPane(pick, row, event) {
	pick(row, event);
	setTimeout(() => (paneOpen.value = false));
}
</script>

<template>
	<div class="flex h-full flex-col gap-3 overflow-hidden p-5">
		<DateBar
			v-model:day="day"
			v-model:company="company"
			v-model:department="department"
			:board="board"
			:filter-count="filterCount"
		>
			<BoardFilters
				v-if="board"
				v-model:practitioner="filters.practitioner.value"
				v-model:patient="filters.patient.value"
				v-model:theatre="filters.theatre.value"
				:board="board"
			/>
			<template #actions>
				<Button
					v-if="board?.can_edit"
					class="hidden md:inline-flex lg:hidden"
					@click="paneOpen = !paneOpen"
				>
					To schedule ({{ requests.length + postponed.length }})
				</Button>
			</template>
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

		<DayList
			v-if="board"
			class="md:hidden"
			:board="board"
			:hidden="filters.caseDimmed"
			@open="openBooking"
		/>

		<div class="relative hidden min-h-0 flex-1 gap-3 md:flex">
			<!-- not canEdit, which is false while a day loads and would make the board jump -->
			<RequestPanel
				v-if="board?.can_edit"
				class="absolute inset-y-0 left-0 z-40 bg-surface-base shadow-xl lg:visible lg:static lg:z-auto lg:bg-transparent lg:shadow-none"
				:class="!paneOpen && 'invisible'"
				:requests="requests"
				:postponed="postponed"
				:dropping="
					Boolean(dragged?.booking && dragged.booking.status !== 'Postponed')
				"
				@pick="
					(request, event) => pickFromPane(drag.pickRequest, request, event)
				"
				@pick-postponed="
					(booking, event) => pickFromPane(drag.pickPostponed, booking, event)
				"
				@unschedule="drag.unschedule"
				@over="drag.clearGhost"
				@done="drag.endDrag"
				:finder="finder"
				:picked="picked"
				@find="slots.find"
				@pick-slot="
					slot => {
						paneOpen = false;
						slots.pick(slot);
					}
				"
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
								class="relative isolate grid overflow-hidden border-l border-outline-gray-1 px-1 [contain:inline-size]"
								:class="[
									dropTheatre === theatre.name && 'bg-surface-gray-1',
									filters.theatreDimmed(theatre.name) && 'opacity-40',
								]"
								@dragover.prevent="drag.dragOver(theatre.name, $event)"
								@dragleave="dropTheatre = null"
								@drop.prevent="drag.drop(theatre.name)"
							>
								<RowWash
									:work-start="workStart"
									:work-end="workEnd"
									:all-day="
										Boolean(
											board.holiday && !board.holiday.is_half_day,
										)
									"
								/>
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
									:cleaning-minutes="cleaningOf(booking)"
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
								<SlotHighlight
									v-if="slots.slotIn(theatre.name)"
									:place="
										placed(
											minutesOf(picked.start),
											minutesOf(picked.end) +
												board.cleaning_minutes,
										)
									"
									:gap="picked"
									@book="slots.book"
									@clear="picked = null"
								/>
								<span
									v-if="nowLine !== null"
									class="pointer-events-none absolute inset-x-0 z-10 border-t border-outline-red-5"
									:style="span(nowLine, nowLine)"
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
/* not scoped: unavailable_block.vue uses it too */
.ot-hatch {
	background-image: repeating-linear-gradient(
		45deg,
		transparent 0 6px,
		var(--outline-gray-2, rgba(0, 0, 0, 0.08)) 6px 7px
	);
}
</style>
