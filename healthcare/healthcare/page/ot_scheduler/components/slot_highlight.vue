<script setup>
import { computed } from "vue";
import { Button } from "frappe-ui";
import CloseIcon from "~icons/lucide/x";

import { clock, timeRange } from "../time.js";

const props = defineProps({
	place: { type: Object, required: true },
	gap: { type: Object, required: true },
});
const emit = defineEmits(["book", "clear"]);
const time = computed(() => timeRange(clock(props.gap.start), clock(props.gap.end)));
</script>

<template>
	<div
		class="relative z-10 flex items-center justify-center rounded-4 border-2 border-dashed border-outline-green-5 bg-surface-green-2 px-1"
		:style="place"
		:title="__('{0} fits, with cleaning', [time])"
	>
		<Button size="sm" variant="solid" class="shrink-0" @click="emit('book')">
			{{ __("Book here") }}
		</Button>
		<button
			class="absolute -end-2.5 -top-1 flex size-5 items-center justify-center rounded-full border border-outline-gray-3 bg-surface-base text-ink-gray-7 shadow-sm hover:bg-surface-gray-2"
			:aria-label="__('Clear the picked slot')"
			:title="__('Clear the picked slot')"
			@click="emit('clear')"
		>
			<CloseIcon class="size-3" />
		</button>
	</div>
</template>
