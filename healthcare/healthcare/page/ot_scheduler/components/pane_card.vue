<script setup>
// A card in the To schedule pane: an open request, or a postponed case (dashed). It is dragged
// onto a theatre's column to book it there; its open button shows the request or the case.
import { Badge, HoverCard } from "frappe-ui";
import OpenIcon from "~icons/lucide/external-link";
import { useHost } from "@framework/ui/island";

import BookingPreview from "./booking_preview.vue";
import { priorityBorder, priorityTheme } from "../case_style.js";
import { patientFacts } from "../patient.js";
import { today } from "../time.js";

defineProps({
	row: { type: Object, required: true },
	procedures: { type: String, required: true },
	// how long the case takes, such as 2h 30m, shown large beside its procedures
	duration: { type: String, required: true },
	// the surgeon, and the order date or the case
	details: { type: Array, required: true },
	postponed: { type: Boolean, default: false },
	// where the open button goes, such as ot-booking/<name>
	route: { type: String, required: true },
	// the case as its hover preview shows it (booking_preview.vue)
	preview: { type: Object, required: true },
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
		<HoverCard :hover-delay="500">
			<template #trigger>
				<div>
					<p
						class="flex items-start gap-2 break-words text-sm font-medium text-ink-gray-9"
					>
						<span class="flex-1">
							{{ row.patient_name }}
							<span class="font-normal text-ink-gray-5">{{
								patientFacts(row)
							}}</span>
						</span>
						<Badge
							v-if="row.priority_label"
							class="shrink-0"
							:theme="priorityTheme(row)"
						>
							{{ row.priority_label }}
						</Badge>
						<button
							class="flex size-7 shrink-0 items-center justify-center rounded-3 bg-surface-gray-2 text-ink-gray-6"
							aria-label="Open"
							title="Open"
							@click.stop="host.navigate?.(route)"
							@mousedown.stop
						>
							<OpenIcon class="size-4" />
						</button>
						<slot name="actions" />
					</p>
					<p class="flex items-start gap-2">
						<span class="flex-1 break-words text-xs text-ink-gray-6">
							{{ procedures }}
							<span v-if="row.theatre_type" class="text-ink-gray-5">
								&middot; {{ row.theatre_type }}
							</span>
						</span>
						<span class="shrink-0 text-base font-semibold text-ink-gray-6">
							{{ duration }}
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
			<BookingPreview :booking="preview" />
		</HoverCard>
	</div>
</template>
