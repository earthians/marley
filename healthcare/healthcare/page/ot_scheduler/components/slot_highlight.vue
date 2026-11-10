<script setup>
// A picked slot on its theatre row: the case and its cleaning time outlined in green, with
// Book here inside, and a small round ✕ on its top-right corner to let the slot go. Nothing is
// clipped, so both stay in reach however narrow the slot.
import { computed } from "vue";
import { Button } from "frappe-ui";
import CloseIcon from "~icons/lucide/x";

import { clock } from "../time.js";

const props = defineProps({
	place: { type: Object, required: true },
	gap: { type: Object, required: true },
});
const emit = defineEmits(["book", "clear"]);
const time = computed(() => `${clock(props.gap.start)}–${clock(props.gap.end)}`);
</script>

<template>
	<div
		class="relative z-10 flex items-center justify-center rounded-4 border-2 border-dashed border-outline-green-5 bg-surface-green-2 px-1"
		:style="place"
		:title="`${time} fits, with cleaning`"
	>
		<Button size="sm" variant="solid" class="shrink-0" @click="emit('book')">
			Book here
		</Button>
		<button
			class="absolute -right-2.5 -top-1 flex size-5 items-center justify-center rounded-full border border-outline-gray-3 bg-surface-base text-ink-gray-7 shadow-sm hover:bg-surface-gray-2"
			aria-label="Clear the picked slot"
			title="Clear the picked slot"
			@click="emit('clear')"
		>
			<CloseIcon class="size-3" />
		</button>
	</div>
</template>
