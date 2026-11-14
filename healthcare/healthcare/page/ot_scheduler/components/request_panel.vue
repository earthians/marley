<script setup>
import { computed, ref } from "vue";
import { FormControl } from "frappe-ui";
import { useHost } from "@framework/ui/island";

import FinderButton from "./finder_button.vue";
import PaneCard from "./pane_card.vue";
import SlotList from "./slot_list.vue";
import { caseMinutes } from "../time.js";

const props = defineProps({
	requests: { type: Array, default: () => [] },
	postponed: { type: Array, default: () => [] },
	dropping: { type: Boolean, default: false },
	finder: { type: Object, required: true },
	picked: { type: Object, default: null },
});
const emit = defineEmits([
	"pick",
	"pickPostponed",
	"unschedule",
	"over",
	"done",
	"find",
	"pickSlot",
]);

const host = useHost();
const search = ref("");
const over = ref(false);

const cards = computed(() =>
	[...props.requests.map(requestCard), ...props.postponed.map(postponedCard)]
		.filter(card => matches(card.searchText))
		.sort(byExpectedDate),
);

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

function postponedCard(booking) {
	return {
		row: booking,
		route: `ot-booking/${booking.name}`,
		preview: booking,
		postponed: true,
		procedures: booking.procedures.join(", "),
		duration: duration(caseMinutes(booking) * 60),
		details: [booking.surgeon, booking.name],
		searchText: [
			booking.patient_name,
			booking.name,
			...booking.procedures,
			booking.surgeon,
		],
		pick: event => emit("pickPostponed", booking, event),
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
	return [hours && `${hours}h`, (minutes || !hours) && `${minutes}m`]
		.filter(Boolean)
		.join(" ");
}

function ordered(request) {
	return `Ordered ${
		host.format?.(request.order_date, { fieldtype: "Date" }) ?? request.order_date
	}`;
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
		<p class="text-sm font-semibold text-ink-gray-7">
			To schedule ({{ requests.length + postponed.length }})
		</p>
		<p
			v-if="dropping"
			class="rounded-4 p-3 text-center text-sm text-ink-gray-6"
			:class="over ? 'bg-surface-gray-3' : 'bg-surface-gray-1'"
		>
			Drop here to reschedule the case
		</p>
		<FormControl
			v-model="search"
			placeholder="Search patient, procedure, surgeon"
		/>
		<div class="flex flex-col gap-2 overflow-y-auto">
			<p v-if="!cards.length" class="p-4 text-center text-sm text-ink-gray-5">
				{{ search ? "Nothing matches" : "Every surgical request is booked" }}
			</p>
			<PaneCard
				v-for="card in cards"
				:key="card.row.name"
				:row="card.row"
				:route="card.route"
				:preview="card.preview"
				:postponed="Boolean(card.postponed)"
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
		</div>
	</aside>
</template>
