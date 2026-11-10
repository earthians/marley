<script setup>
// The cases still waiting for a theatre: open surgical requests, and postponed cases. Drag one
// onto a theatre's column to book it. Drop a booked case here to postpone it.
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
	// a booked case is being dragged, so the pane offers to take it
	dropping: { type: Boolean, default: false },
	// the slot finder: which card it is open on and what it found (use_slots.js)
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

const shownRequests = computed(() =>
	matching(props.requests, request => [request.procedure, request.practitioner_name]),
);
const shownPostponed = computed(() =>
	matching(props.postponed, booking => [...booking.procedures, booking.surgeon]),
);

function matching(rows, details) {
	const text = search.value.trim().toLowerCase();
	if (!text) return rows;
	return rows.filter(row =>
		[row.patient_name, row.name, ...details(row)]
			.join(" ")
			.toLowerCase()
			.includes(text),
	);
}

// a length such as 2h 30m, 3h or 45m
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

// a request shaped like a case, so the pane shows it with the board's hover preview
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
			<p
				v-if="!shownRequests.length && !shownPostponed.length"
				class="p-4 text-center text-sm text-ink-gray-5"
			>
				{{ search ? "Nothing matches" : "Every surgical request is booked" }}
			</p>
			<PaneCard
				v-for="request in shownRequests"
				:key="request.name"
				:row="request"
				:route="`service-request/${request.name}`"
				:preview="requestPreview(request)"
				:procedures="request.procedure"
				:duration="duration(request.duration)"
				:details="[request.practitioner_name, ordered(request)]"
				@pick="event => emit('pick', request, event)"
				@done="emit('done')"
			>
				<template #actions>
					<FinderButton
						:open="finder.for === request.name"
						@click="emit('find', { request })"
					/>
				</template>
				<SlotList
					v-if="finder.for === request.name"
					class="mt-2"
					:finder="finder"
					:picked="picked"
					@pick="slot => emit('pickSlot', slot)"
				/>
			</PaneCard>
			<p
				v-if="shownPostponed.length"
				class="pt-2 text-sm font-semibold text-ink-gray-7"
			>
				To reschedule ({{ shownPostponed.length }})
			</p>
			<PaneCard
				v-for="booking in shownPostponed"
				:key="booking.name"
				:row="booking"
				:route="`ot-booking/${booking.name}`"
				:preview="booking"
				postponed
				:procedures="booking.procedures.join(', ')"
				:duration="duration(caseMinutes(booking) * 60)"
				:details="[booking.surgeon, booking.name]"
				@pick="event => emit('pickPostponed', booking, event)"
				@done="emit('done')"
			>
				<template #actions>
					<FinderButton
						:open="finder.for === booking.name"
						@click="emit('find', { booking })"
					/>
				</template>
				<SlotList
					v-if="finder.for === booking.name"
					class="mt-2"
					:finder="finder"
					:picked="picked"
					@pick="slot => emit('pickSlot', slot)"
				/>
			</PaneCard>
		</div>
	</aside>
</template>
