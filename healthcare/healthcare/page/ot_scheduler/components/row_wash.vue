<script setup>
import { DAY_MINUTES, placed } from "../time.js";

defineProps({
	workStart: { type: Number, required: true },
	workEnd: { type: Number, required: true },
});
</script>

<template>
	<span
		v-for="[from, to] in [
			[0, workStart],
			[workEnd, DAY_MINUTES],
		]"
		:key="from"
		class="-z-10 bg-surface-gray-1 opacity-30"
		:style="placed(from, to)"
	/>
</template>
