<script setup>
import { computed } from "vue";
import { Button, HoverCard } from "frappe-ui";
import { useHost } from "@framework/ui/island";

import { clock } from "../time.js";

const props = defineProps({
	block: { type: Object, required: true },
	place: { type: Object, required: true },
	open: { type: Boolean, default: false },
});
const emit = defineEmits(["update:open", "view"]);
const host = useHost();

const why = computed(() => props.block.reason || "Unavailable");
const hasDetails = computed(() => props.block.reason || props.block.note);
const time = computed(
	() => `${clock(props.block.start_time)}–${clock(props.block.end_time)}`,
);
const days = computed(() => {
	const { start_date, end_date } = props.block;
	if (start_date === end_date) return formatDate(start_date);
	return `${formatDate(start_date)} to ${formatDate(end_date)}`;
});

function formatDate(value) {
	return host.format?.(value, { fieldtype: "Date" }) ?? value;
}
</script>

<template>
	<HoverCard
		:hover-delay="500"
		:open="open"
		@update:open="value => emit('update:open', value)"
	>
		<template #trigger>
			<div
				class="ot-hatch overflow-hidden rounded-4 bg-surface-red-1 px-2 py-1"
				:style="place"
			>
				<p v-if="hasDetails" class="truncate text-xs text-ink-red-7">
					<span class="font-medium">{{ why }}</span>
					<span v-if="block.note"> · {{ block.note }}</span>
				</p>
				<p v-else class="truncate text-xs font-medium text-ink-red-7">
					{{ block.title }}
				</p>
			</div>
		</template>
		<div class="flex w-72 flex-col gap-2 p-3 text-sm">
			<p class="font-medium text-ink-gray-9">{{ why }}</p>
			<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
				<dt class="text-ink-gray-5">Time</dt>
				<dd class="text-ink-gray-8">{{ time }}</dd>
				<dt class="text-ink-gray-5">Days</dt>
				<dd class="text-ink-gray-8">{{ days }}</dd>
				<template v-if="block.note">
					<dt class="text-ink-gray-5">Note</dt>
					<dd class="whitespace-pre-line text-ink-gray-8">
						{{ block.note }}
					</dd>
				</template>
			</dl>
			<div class="flex items-center justify-between gap-2">
				<p class="truncate text-xs text-ink-gray-5">{{ block.title }}</p>
				<Button size="sm" @click="emit('view', block.name)">View</Button>
			</div>
		</div>
	</HoverCard>
</template>
