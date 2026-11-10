<script setup>
// A card in the To schedule pane: an open request, or a postponed case (dashed). It is dragged
// onto a theatre's column to book it there.
import { Badge } from "frappe-ui";
import { useHost } from "@framework/ui/island";

import { priorityBorder, priorityTheme } from "../case_style.js";
import { patientFacts } from "../patient.js";
import { today } from "../time.js";

defineProps({
	row: { type: Object, required: true },
	procedures: { type: String, required: true },
	// the length, the surgeon, and the order date or the case
	details: { type: Array, required: true },
	postponed: { type: Boolean, default: false },
});
const emit = defineEmits(["pick", "done"]);
const host = useHost();

// a date as desk prints a Date field, in the date format of System Settings
function formatDate(value) {
	return host.format?.(value, { fieldtype: "Date" }) ?? value;
}
</script>

<template>
	<div
		draggable="true"
		class="cursor-grab rounded-4 bg-surface-base p-2"
		:class="[priorityBorder(row), postponed && 'border-dashed']"
		@dragstart="event => emit('pick', event)"
		@dragend="emit('done')"
	>
		<p
			class="flex items-start gap-2 break-words text-sm font-medium text-ink-gray-9"
		>
			<span class="flex-1">
				{{ row.patient_name }}
				<span class="font-normal text-ink-gray-5">{{ patientFacts(row) }}</span>
			</span>
			<Badge
				v-if="row.priority_label"
				class="shrink-0"
				:theme="priorityTheme(row)"
			>
				{{ row.priority_label }}
			</Badge>
			<slot name="actions" />
		</p>
		<p class="break-words text-xs text-ink-gray-6">
			{{ procedures }}
			<span v-if="row.theatre_type" class="text-ink-gray-5">
				&middot; {{ row.theatre_type }}
			</span>
		</p>
		<p class="text-xs text-ink-gray-5">
			{{ details.filter(Boolean).join(" · ") }}
		</p>
		<p
			v-if="row.expected_date"
			class="text-xs"
			:class="
				String(row.expected_date) < today()
					? 'text-ink-red-7'
					: 'text-ink-gray-6'
			"
		>
			Expected by {{ formatDate(row.expected_date) }}
		</p>
		<slot />
	</div>
</template>
