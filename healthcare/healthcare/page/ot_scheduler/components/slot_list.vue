<script setup>
import { useHost } from "@framework/ui/island";

import { clock } from "../time.js";

defineProps({
	finder: { type: Object, required: true },
	picked: { type: Object, default: null },
});
const emit = defineEmits(["pick"]);
const host = useHost();

function when(slot) {
	const date = host.format?.(slot.date, { fieldtype: "Date" }) ?? slot.date;
	return `${date} · ${clock(slot.start)}–${clock(slot.end)}`;
}

function isPicked(picked, slot) {
	return (
		Boolean(picked) &&
		picked.theatre === slot.theatre &&
		picked.start === slot.start
	);
}
</script>

<template>
	<div
		class="flex flex-col gap-1 rounded-4 border border-outline-gray-2 bg-surface-base p-2"
	>
		<p class="text-xs font-semibold text-ink-gray-7">Earliest slots that fit</p>
		<p v-if="finder.loading" class="text-xs text-ink-gray-6">Finding slots…</p>
		<p v-else-if="finder.error" class="text-xs text-ink-red-7">
			{{ finder.error }}
		</p>
		<p v-else-if="!finder.slots.length" class="text-xs text-ink-gray-6">
			No free slot in the next 7 days. Try All Departments, or drop the case where
			you want it: a drop can push other cases back.
		</p>
		<button
			v-for="slot in finder.slots"
			:key="`${slot.theatre} ${slot.start}`"
			class="flex items-center justify-between gap-2 rounded-3 border px-2 py-1 text-left text-xs"
			:class="
				isPicked(picked, slot)
					? 'border-outline-green-5 bg-surface-green-2'
					: 'border-outline-gray-2 bg-surface-base'
			"
			@click="emit('pick', slot)"
		>
			<span class="text-ink-gray-9">
				<span class="font-semibold">{{ slot.theatre_label }}</span> ·
				{{ when(slot) }}
			</span>
		</button>
	</div>
</template>
