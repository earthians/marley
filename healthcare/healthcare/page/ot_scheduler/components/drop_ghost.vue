<script setup>
import { placed } from "../time.js";

defineProps({
	plan: { type: Object, required: true },
});
</script>

<template>
	<div
		class="pointer-events-none z-10 overflow-hidden rounded-4 border-2 border-dashed px-2 py-1"
		:class="
			plan.problem
				? 'border-outline-red-3 bg-surface-red-1'
				: 'border-outline-green-5 bg-surface-green-2'
		"
		:style="placed(plan.start, plan.end)"
	>
		<p
			class="text-xs font-medium"
			:class="plan.problem ? 'text-ink-red-7' : 'text-ink-gray-8'"
		>
			{{ plan.label }}
		</p>
	</div>
	<div
		v-for="push in plan.pushes"
		:key="push.name"
		class="pointer-events-none z-10 rounded-4 border border-dashed border-outline-gray-4"
		:style="placed(push.start, push.end)"
	/>
</template>
