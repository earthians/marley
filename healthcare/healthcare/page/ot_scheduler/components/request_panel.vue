<script setup>
import { computed, ref } from "vue";
import { FormControl } from "frappe-ui";
import { useHost } from "@framework/ui/island";

import FinderButton from "./finder_button.vue";
import PaneCard from "./pane_card.vue";
import SlotList from "./slot_list.vue";
import ChevronIcon from "~icons/lucide/chevron-right";
import { isoDate, today } from "../time.js";

const props = defineProps({
	requests: { type: Array, default: () => [] },
	unscheduled: { type: Array, default: () => [] },
	dropping: { type: Boolean, default: false },
	finder: { type: Object, required: true },
	picked: { type: Object, default: null },
});
const emit = defineEmits([
	"pick",
	"pickUnscheduled",
	"unschedule",
	"over",
	"done",
	"find",
	"pickSlot",
]);

const host = useHost();
const search = ref("");
const over = ref(false);
const previewFor = ref(null);

function previewOpened(name, open) {
	if (open) previewFor.value = name;
	else if (previewFor.value === name) previewFor.value = null;
}

const cards = computed(() =>
	[...props.requests.map(requestCard), ...props.unscheduled.map(unscheduledCard)]
		.filter(card => matches(card.searchText))
		.sort(byExpectedDate),
);

const NO_DATE = "No Expected By date";
const tomorrow = isoDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
const expanded = ref(new Set([today(), tomorrow]));

const groups = computed(() => {
	const byDate = new Map();
	for (const card of cards.value) {
		const date = card.row.expected_date || NO_DATE;
		byDate.set(date, [...(byDate.get(date) || []), card]);
	}
	const dates = search.value.trim() ? [...byDate.keys()] : shownDays(byDate);
	return dates.map(date => ({
		date,
		label: dateLabel(date),
		cards: byDate.get(date) || [],
	}));
});

function shownDays(byDate) {
	const dated = [...byDate.keys()].filter(date => date !== NO_DATE).sort();
	const past = dated.filter(date => date < today());
	const last = [tomorrow, ...dated].sort().at(-1);
	const undated = byDate.has(NO_DATE) ? [NO_DATE] : [];
	return [...past, ...daysBetween(today(), last), ...undated];
}

function daysBetween(first, last) {
	const days = [];
	const day = new Date(`${first}T00:00`);
	while (isoDate(day) <= last) {
		days.push(isoDate(day));
		day.setDate(day.getDate() + 1);
	}
	return days;
}

function dateLabel(date) {
	if (date === NO_DATE) return __("No Expected By date");
	const formatted = host.format?.(date, { fieldtype: "Date" }) ?? date;
	return date === today() ? __("{0} (Today)", [formatted]) : formatted;
}

function isOpen(date) {
	return Boolean(search.value.trim()) || expanded.value.has(date);
}

function toggle(date) {
	const open = new Set(expanded.value);
	open.has(date) ? open.delete(date) : open.add(date);
	expanded.value = open;
}

function requestCard(request) {
	return {
		row: request,
		route: `service-request/${request.name}`,
		preview: requestPreview(request),
		procedures: request.procedure,
		duration: duration(request.duration),
		details: [request.practitioner_name, ordered(request)],
		searchText: [
			request.patient_name,
			request.name,
			request.procedure,
			request.practitioner_name,
		],
		pick: event => emit("pick", request, event),
		find: { request },
	};
}

function unscheduledCard(booking) {
	return {
		row: booking,
		route: `ot-booking/${booking.name}`,
		preview: booking,
		unscheduled: true,
		procedures: booking.procedures.join(", "),
		duration: duration(booking.duration),
		details: [booking.surgeon, booking.name],
		searchText: [
			booking.patient_name,
			booking.name,
			...booking.procedures,
			booking.surgeon,
		],
		pick: event => emit("pickUnscheduled", booking, event),
		find: { booking },
	};
}

function byExpectedDate(first, second) {
	const expected = card => String(card.row.expected_date || "9999-12-31");
	return expected(first).localeCompare(expected(second));
}

function matches(searchText) {
	const text = search.value.trim().toLowerCase();
	return !text || searchText.join(" ").toLowerCase().includes(text);
}

function duration(seconds) {
	const total = Math.round((seconds || 0) / 60);
	const hours = Math.floor(total / 60);
	const minutes = total % 60;
	return [hours && __("{0}h", [hours]), (minutes || !hours) && __("{0}m", [minutes])]
		.filter(Boolean)
		.join(" ");
}

function ordered(request) {
	const date =
		host.format?.(request.order_date, { fieldtype: "Date" }) ?? request.order_date;
	return __("Ordered {0}", [date]);
}

function requestPreview(request) {
	return {
		...request,
		status: "Ordered",
		procedures: [request.procedure],
		surgeon: request.practitioner_name,
	};
}

function drop() {
	over.value = false;
	emit("unschedule");
}
</script>

<template>
	<aside
		class="flex w-72 shrink-0 flex-col gap-2 overflow-hidden rounded-4 border-2 border-dashed"
		:class="dropping ? 'border-outline-gray-3 p-1' : 'border-transparent'"
		@dragover.prevent="
			over = dropping;
			emit('over');
		"
		@dragleave="over = false"
		@drop.prevent="drop"
	>
		<p
			v-if="dropping"
			class="rounded-4 p-3 text-center text-sm text-ink-gray-6"
			:class="over ? 'bg-surface-gray-3' : 'bg-surface-gray-1'"
		>
			{{ __("Drop here to reschedule the case") }}
		</p>
		<FormControl
			v-model="search"
			:placeholder="__('Search {0} to schedule', [cards.length])"
		/>
		<div class="flex flex-col gap-2 overflow-y-auto" @scroll="previewFor = null">
			<p v-if="!cards.length" class="p-4 text-center text-sm text-ink-gray-5">
				{{
					search
						? __("Nothing matches")
						: __("Every surgical request is booked")
				}}
			</p>
			<section
				v-for="group in groups"
				:key="group.date"
				class="flex flex-col gap-2"
			>
				<button
					class="flex items-center gap-1 text-start text-sm font-medium text-ink-gray-6"
					@click="toggle(group.date)"
				>
					<ChevronIcon
						class="size-4 shrink-0 transition-transform"
						:class="
							isOpen(group.date) ? 'rotate-90' : '[&:dir(rtl)]:rotate-180'
						"
					/>
					<span class="flex-1">{{ group.label }}</span>
					<span class="text-ink-gray-5">({{ group.cards.length }})</span>
				</button>
				<template v-if="isOpen(group.date)">
					<PaneCard
						v-for="card in group.cards"
						:key="card.row.name"
						:row="card.row"
						:route="card.route"
						:preview="card.preview"
						:preview-open="previewFor === card.row.name"
						@update:preview-open="
							open => previewOpened(card.row.name, open)
						"
						:unscheduled="Boolean(card.unscheduled)"
						:procedures="card.procedures"
						:duration="card.duration"
						:details="card.details"
						@pick="card.pick"
						@done="emit('done')"
					>
						<template #actions>
							<FinderButton
								:open="finder.for === card.row.name"
								@click="emit('find', card.find)"
							/>
						</template>
						<SlotList
							v-if="finder.for === card.row.name"
							class="mt-2"
							:finder="finder"
							:picked="picked"
							@pick="slot => emit('pickSlot', slot)"
						/>
					</PaneCard>
				</template>
			</section>
		</div>
	</aside>
</template>
