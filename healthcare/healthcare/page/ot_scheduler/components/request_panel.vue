<script setup>
// The cases still waiting for a theatre: open surgical requests, and postponed cases. Drag one
// onto a theatre's column to book it. Drop a booked case here to postpone it.
import { computed, ref } from "vue";
import { FormControl } from "frappe-ui";
import { useHost } from "@framework/ui/island";

import PaneCard from "./pane_card.vue";
import { caseMinutes } from "../time.js";

const props = defineProps({
	requests: { type: Array, default: () => [] },
	postponed: { type: Array, default: () => [] },
	// a booked case is being dragged, so the pane offers to take it
	dropping: { type: Boolean, default: false },
});
const emit = defineEmits(["pick", "pickPostponed", "unschedule", "over", "done"]);

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

function duration(seconds) {
	const total = Math.round((seconds || 0) / 60);
	return total >= 60 ? `${Math.floor(total / 60)}h ${total % 60}m` : `${total}m`;
}

function ordered(request) {
	return `Ordered ${
		host.format?.(request.order_date, { fieldtype: "Date" }) ?? request.order_date
	}`;
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
				:procedures="request.procedure"
				:details="[
					duration(request.duration),
					request.practitioner_name,
					ordered(request),
				]"
				@pick="event => emit('pick', request, event)"
				@done="emit('done')"
			/>
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
				postponed
				:procedures="booking.procedures.join(', ')"
				:details="[
					duration(caseMinutes(booking) * 60),
					booking.surgeon,
					booking.name,
				]"
				@pick="event => emit('pickPostponed', booking, event)"
				@done="emit('done')"
			/>
		</div>
	</aside>
</template>
