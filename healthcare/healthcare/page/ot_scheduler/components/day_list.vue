<script setup>
import { computed } from "vue";

import BookingPreview from "./booking_preview.vue";
import { clock } from "../time.js";

const props = defineProps({
	board: { type: Object, required: true },
	hidden: { type: Function, default: () => false },
});
const emit = defineEmits(["open"]);

const theatres = computed(() =>
	props.board.complexes
		.flatMap(group => group.theatres)
		.map(theatre => ({ theatre, cases: casesIn(theatre.name) }))
		.filter(row => row.cases.length),
);

function casesIn(theatre) {
	return props.board.bookings
		.filter(booking => booking.theatre === theatre && !props.hidden(booking))
		.sort((first, second) =>
			String(first.scheduled_start).localeCompare(second.scheduled_start),
		);
}

function heading(theatre) {
	return [theatre.label, theatre.service_unit_type].filter(Boolean).join(" · ");
}

function time(booking) {
	return `${clock(booking.scheduled_start)}–${clock(booking.scheduled_end)}`;
}
</script>

<template>
	<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
		<p v-if="!theatres.length" class="p-8 text-center text-sm text-ink-gray-5">
			No cases on this day
		</p>
		<section
			v-for="row in theatres"
			:key="row.theatre.name"
			class="flex flex-col gap-2"
		>
			<p class="text-sm font-semibold text-ink-gray-7">
				{{ heading(row.theatre) }}
			</p>
			<button
				v-for="booking in row.cases"
				:key="booking.name"
				class="rounded-4 border border-outline-gray-2 text-left"
				@click="emit('open', booking.name)"
			>
				<BookingPreview :booking="booking" :time="time(booking)" wide />
			</button>
		</section>
	</div>
</template>
