<script setup>
// A case's details on hover, like desk's link preview, so it can be read without leaving the board:
// a case in a theatre, or a waiting one in the pane (a postponed case, or a request shaped like a
// case by request_panel.vue). Only the rows a case has are shown.
import { Badge } from "frappe-ui";

import { inpatientText, patientFacts } from "../patient.js";

defineProps({
	booking: { type: Object, required: true },
	theatre: { type: String, default: "" },
	time: { type: String, default: "" },
});

const STATUS_THEMES = {
	Tentative: "gray",
	Scheduled: "blue",
	"In Progress": "amber",
	Completed: "green",
	Postponed: "amber",
	Ordered: "violet",
};
</script>

<template>
	<div class="flex w-72 flex-col gap-2 p-3 text-sm">
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
			<Badge :theme="STATUS_THEMES[booking.status]">{{ booking.status }}</Badge>
		</div>
		<ul class="text-ink-gray-8">
			<li v-for="procedure in booking.procedures" :key="procedure">
				{{ procedure }}
			</li>
		</ul>
		<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
			<template v-if="theatre">
				<dt class="text-ink-gray-5">Theatre</dt>
				<dd class="text-ink-gray-8">{{ theatre }}</dd>
				<dt class="text-ink-gray-5">Time</dt>
				<dd class="text-ink-gray-8">{{ time }}</dd>
			</template>
			<template v-if="booking.inpatient_status">
				<dt class="text-ink-gray-5">Inpatient</dt>
				<dd class="text-ink-gray-8">{{ inpatientText(booking) }}</dd>
			</template>
			<dt class="text-ink-gray-5">Surgeon</dt>
			<dd class="text-ink-gray-8">{{ booking.surgeon }}</dd>
			<template v-if="booking.team_names?.length">
				<dt class="text-ink-gray-5">Team</dt>
				<dd class="text-ink-gray-8">{{ booking.team_names.join(", ") }}</dd>
			</template>
			<dt class="text-ink-gray-5">Priority</dt>
			<dd :class="booking.is_emergency ? 'text-ink-red-7' : 'text-ink-gray-8'">
				{{ booking.priority_label }}
			</dd>
			<template v-if="booking.other_cases?.length">
				<dt class="text-ink-gray-5">Also today</dt>
				<dd class="text-ink-amber-7">
					<p v-for="other in booking.other_cases" :key="other">{{ other }}</p>
				</dd>
			</template>
			<template v-if="'fasting_confirmed' in booking">
				<dt class="text-ink-gray-5">Fasting</dt>
				<dd class="text-ink-gray-8">
					{{ booking.fasting_confirmed ? "Confirmed" : "Not confirmed" }}
				</dd>
			</template>
		</dl>
		<p class="text-xs text-ink-gray-5">{{ booking.name }}</p>
	</div>
</template>
