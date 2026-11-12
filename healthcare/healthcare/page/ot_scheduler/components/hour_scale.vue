<script setup>
import { HOURS, span } from "../time.js";
</script>

<template>
	<div
		class="relative sticky left-0 z-20 border-r border-outline-gray-2 bg-surface-base"
	>
		<span
			v-for="hour in HOURS.slice(0, -1)"
			:key="hour"
			class="absolute left-2 -translate-y-1/2 text-xs text-ink-gray-5"
			:style="span(hour * 60, hour * 60)"
		>
			{{ String(hour).padStart(2, "0") }}:00
		</span>
	</div>
</template>
