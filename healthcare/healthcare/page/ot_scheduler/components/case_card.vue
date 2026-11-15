<script setup>
import { ContextMenu, HoverCard } from "frappe-ui";

import BedIcon from "~icons/lucide/bed";
import FastingIcon from "~icons/lucide/utensils-crossed";
import LockIcon from "~icons/lucide/lock";

import BookingPreview from "./booking_preview.vue";
import { caseBorder, caseFill } from "../case_style.js";
import OtherCases from "./other_cases.vue";
import { inpatientText, patientFacts } from "../patient.js";
import { clock, timeRange } from "../time.js";

defineProps({
	booking: { type: Object, required: true },
	theatreLabel: { type: String, default: "" },
	cleaningMinutes: { type: Number, default: 0 },
	menuOptions: { type: Array, required: true },
	menuOpen: { type: Boolean, default: false },
	previewOpen: { type: Boolean, default: false },
	movable: { type: Boolean, default: false },
	passed: { type: Boolean, default: false },
	place: { type: Object, required: true },
	cleaningPlace: { type: Object, default: null },
	dimmed: { type: Boolean, default: false },
});
const emit = defineEmits(["update:menuOpen", "update:previewOpen", "pick", "drop-end"]);
</script>

<template>
	<div
		v-if="cleaningMinutes"
		class="ot-hatch bg-surface-gray-1"
		:class="[dimmed && 'opacity-30', caseBorder(booking), 'rounded-b-4 border-t-0']"
		:style="cleaningPlace"
		:title="__('Cleaning')"
	/>
	<ContextMenu
		:options="menuOptions"
		:open="menuOpen"
		@update:open="open => emit('update:menuOpen', open)"
	>
		<template #default="{ setOpen }">
			<button
				class="overflow-hidden px-2 py-1 text-start"
				:class="[
					dimmed && 'opacity-30',
					caseBorder(booking),
					caseFill(booking),
					cleaningMinutes ? 'rounded-t-4 border-b-0' : 'rounded-4',
				]"
				:style="place"
				:draggable="movable"
				@dragstart="event => emit('pick', event)"
				@dragend="emit('drop-end')"
				@click="setOpen(true)"
			>
				<HoverCard
					:hover-delay="500"
					:open="previewOpen"
					@update:open="open => emit('update:previewOpen', open)"
				>
					<template #trigger>
						<div class="flex h-full flex-col">
							<div class="flex items-start gap-1">
								<p
									class="flex min-w-0 flex-1 flex-wrap gap-x-1 text-sm"
								>
									<span
										class="max-w-full truncate font-medium text-ink-gray-9"
									>
										{{ booking.patient_name }}
									</span>
									<span class="shrink-0 text-ink-gray-5">
										{{ patientFacts(booking) }}
									</span>
								</p>
								<FastingIcon
									class="size-3.5 shrink-0"
									:class="
										booking.fasting_confirmed
											? 'text-ink-green-6'
											: 'text-ink-gray-4'
									"
									:title="
										booking.fasting_confirmed
											? __('Fasting confirmed')
											: __('Fasting not confirmed')
									"
								/>
								<OtherCases :cases="booking.other_cases" />
								<BedIcon
									v-if="booking.inpatient_status"
									class="size-3.5 shrink-0 text-ink-blue-5"
									:title="inpatientText(booking)"
								/>
								<LockIcon
									v-if="passed"
									class="size-3.5 shrink-0 text-ink-gray-5"
									:title="
										__(
											'Its time has passed: reschedule or cancel it',
										)
									"
								/>
							</div>
							<p class="truncate text-xs text-ink-gray-6">
								{{
									timeRange(
										clock(booking.scheduled_start),
										clock(booking.scheduled_end),
									)
								}}
							</p>
							<p class="truncate text-xs text-ink-gray-6">
								{{ booking.surgeon }}
							</p>
						</div>
					</template>
					<BookingPreview
						:booking="booking"
						:theatre="theatreLabel"
						:time="
							timeRange(
								clock(booking.scheduled_start),
								clock(booking.scheduled_end),
							)
						"
					/>
				</HoverCard>
			</button>
		</template>
	</ContextMenu>
</template>
