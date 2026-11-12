<script setup>
import FindIcon from "~icons/lucide/calendar-search";

defineProps({ open: { type: Boolean, default: false } });
const emit = defineEmits(["click"]);
</script>

<template>
	<button
		class="flex size-7 shrink-0 items-center justify-center rounded-3 text-ink-blue-3"
		:class="open ? 'bg-surface-blue-2' : 'bg-surface-gray-2'"
		aria-label="Find slots"
		title="Find slots"
		@click.stop="emit('click')"
		@mousedown.stop
	>
		<FindIcon class="size-4" />
	</button>
</template>
