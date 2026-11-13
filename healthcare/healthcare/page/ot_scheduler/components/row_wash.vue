<script setup>
import { computed } from "vue";

import { DAY_MINUTES, placed } from "../time.js";

const props = defineProps({
	workStart: { type: Number, required: true },
	workEnd: { type: Number, required: true },
	allDay: { type: Boolean, default: false },
});

const spans = computed(() =>
	props.allDay
		? [[0, DAY_MINUTES]]
		: [
				[0, props.workStart],
				[props.workEnd, DAY_MINUTES],
		  ],
);
</script>

<template>
	<span
		v-for="[from, to] in spans"
		:key="from"
		class="-z-10 bg-surface-gray-1 opacity-60"
		:style="placed(from, to)"
	/>
</template>
