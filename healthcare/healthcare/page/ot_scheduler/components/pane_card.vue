<script setup>
import { Badge, HoverCard } from "frappe-ui";
import BedIcon from "~icons/lucide/bed";
import OpenIcon from "~icons/lucide/external-link";
import { useHost } from "@framework/ui/island";

import BookingPreview from "./booking_preview.vue";
import { priorityBorder, priorityTheme } from "../case_style.js";
import { patientFacts } from "../patient.js";
import { today } from "../time.js";

defineProps({
	row: { type: Object, required: true },
	procedures: { type: String, required: true },
	duration: { type: String, required: true },
	details: { type: Array, required: true },
	postponed: { type: Boolean, default: false },
	route: { type: String, required: true },
	preview: { type: Object, required: true },
	previewOpen: { type: Boolean, default: false },
});
const emit = defineEmits(["pick", "done", "update:previewOpen"]);
const host = useHost();

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
		<div class="flex items-start gap-2">
			<div class="min-w-0 flex-1">
				<HoverCard
					:hover-delay="500"
					:open="previewOpen"
					@update:open="open => emit('update:previewOpen', open)"
				>
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
									<BedIcon
										v-if="row.inpatient_status"
										class="ml-1 inline size-3.5 align-[-2px] text-ink-blue-5"
									/>
								</span>
								<Badge
									v-if="row.priority_label"
									class="shrink-0"
									:theme="priorityTheme(row)"
								>
									{{ row.priority_label }}
								</Badge>
							</p>
							<p class="flex items-start gap-2">
								<span
									class="flex-1 break-words text-xs text-ink-gray-6"
								>
									{{ procedures }}
									<span
										v-if="row.theatre_type"
										class="text-ink-gray-5"
									>
										&middot; {{ row.theatre_type }}
									</span>
								</span>
								<span
									class="shrink-0 text-base font-semibold text-ink-gray-6"
								>
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
						</div>
					</template>
					<BookingPreview :booking="preview" />
				</HoverCard>
			</div>
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
		</div>
		<slot />
	</div>
</template>
