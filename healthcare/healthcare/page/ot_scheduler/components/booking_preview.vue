<script setup>
import { Badge } from "frappe-ui";
import BedIcon from "~icons/lucide/bed";
import SeveralIcon from "~icons/lucide/copy";
import FastingIcon from "~icons/lucide/utensils-crossed";

import { inpatientText, patientFacts } from "../patient.js";

defineProps({
	booking: { type: Object, required: true },
	theatre: { type: String, default: "" },
	time: { type: String, default: "" },
	wide: { type: Boolean, default: false },
});

const STATUS_THEMES = {
	Tentative: "gray",
	Scheduled: "blue",
	"In Progress": "amber",
	Completed: "green",
	Unscheduled: "amber",
	Ordered: "violet",
};
</script>

<template>
	<div class="flex flex-col gap-2 p-3 text-sm" :class="wide ? 'w-full' : 'w-72'">
		<div class="flex items-start justify-between gap-2">
			<div class="min-w-0">
				<p class="truncate font-medium text-ink-gray-9">
					{{ booking.patient_name }}
				</p>
				<p class="text-xs text-ink-gray-5">
					{{
						[patientFacts(booking), booking.patient]
							.filter(Boolean)
							.join(" · ")
					}}
				</p>
			</div>
			<Badge :theme="STATUS_THEMES[booking.status]">{{
				__(booking.status)
			}}</Badge>
		</div>
		<ul class="text-ink-gray-8">
			<li v-for="procedure in booking.procedures" :key="procedure">
				{{ procedure }}
			</li>
		</ul>
		<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
			<template v-if="theatre">
				<dt class="text-ink-gray-5">{{ __("Theatre") }}</dt>
				<dd class="text-ink-gray-8">{{ theatre }}</dd>
			</template>
			<template v-if="time">
				<dt class="text-ink-gray-5">{{ __("Time") }}</dt>
				<dd class="text-ink-gray-8">{{ time }}</dd>
			</template>
			<template v-if="booking.inpatient_status">
				<dt class="flex items-center gap-1 text-ink-gray-5">
					<BedIcon class="size-3.5 shrink-0 text-ink-blue-5" />
					{{ __("Inpatient") }}
				</dt>
				<dd class="text-ink-gray-8">{{ inpatientText(booking) }}</dd>
			</template>
			<dt class="text-ink-gray-5">{{ __("Surgeon") }}</dt>
			<dd class="text-ink-gray-8">{{ booking.surgeon }}</dd>
			<template v-if="booking.team_names?.length">
				<dt class="text-ink-gray-5">{{ __("Team") }}</dt>
				<dd class="text-ink-gray-8">{{ booking.team_names.join(", ") }}</dd>
			</template>
			<dt class="text-ink-gray-5">{{ __("Priority") }}</dt>
			<dd :class="booking.is_emergency ? 'text-ink-red-7' : 'text-ink-gray-8'">
				{{ booking.priority_label }}
			</dd>
			<template v-if="booking.other_cases?.length">
				<dt class="flex items-center gap-1 text-ink-gray-5">
					<SeveralIcon class="size-3.5 shrink-0 text-ink-amber-7" />
					{{ __("Also today") }}
				</dt>
				<dd class="text-ink-amber-7">
					<p v-for="other in booking.other_cases" :key="other">{{ other }}</p>
				</dd>
			</template>
			<template v-if="'fasting_confirmed' in booking">
				<dt class="flex items-center gap-1 text-ink-gray-5">
					<FastingIcon
						class="size-3.5 shrink-0"
						:class="
							booking.fasting_confirmed
								? 'text-ink-green-6'
								: 'text-ink-gray-4'
						"
					/>
					{{ __("Fasting") }}
				</dt>
				<dd class="text-ink-gray-8">
					{{
						booking.fasting_confirmed
							? __("Confirmed")
							: __("Not confirmed")
					}}
				</dd>
			</template>
		</dl>
		<p class="text-xs text-ink-gray-5">{{ booking.name }}</p>
	</div>
</template>
