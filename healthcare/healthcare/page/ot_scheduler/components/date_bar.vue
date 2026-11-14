<script setup>
import { ref } from "vue";
import { Badge, Button, DatePicker, FormControl } from "frappe-ui";

import { isoDate, today } from "../time.js";

defineProps({
	board: { type: Object, default: null },
	filterCount: { type: Number, default: 0 },
});
const filtersOpen = ref(false);
const day = defineModel("day", { type: String, required: true });
const company = defineModel("company", { type: String, default: "" });
const department = defineModel("department", { type: String, default: "" });

function moveDay(days) {
	const date = new Date(`${day.value}T00:00:00`);
	date.setDate(date.getDate() + days);
	day.value = isoDate(date);
}
</script>

<template>
	<div class="flex shrink-0 flex-col gap-2">
		<div
			class="flex-wrap items-center gap-2 lg:flex"
			:class="filtersOpen ? 'flex' : 'hidden'"
		>
			<div v-if="board" class="w-48">
				<FormControl
					v-model="company"
					type="select"
					:options="board.companies"
				/>
			</div>
			<div v-if="board" class="w-48">
				<FormControl
					v-model="department"
					type="select"
					:options="[
						{ label: 'All Departments', value: '' },
						...board.departments,
					]"
				/>
			</div>
			<slot />
			<span
				class="ml-auto rounded-full bg-surface-yellow-2 px-2.5 py-1 text-sm font-medium text-ink-yellow-8"
				title="In beta: tell us what works and what does not"
			>
				Experimental
			</span>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<Button @click="moveDay(-1)">Previous</Button>
			<Button @click="day = today()">Today</Button>
			<Button @click="moveDay(1)">Next</Button>
			<DatePicker v-model="day" format="ddd, D MMM YYYY" class="w-44" />
			<Badge
				v-if="board?.holiday"
				:theme="board.holiday.is_half_day ? 'amber' : 'red'"
				size="lg"
			>
				{{ board.holiday.is_half_day ? "Half-day holiday" : "Holiday" }}:
				{{ board.holiday.description }}
			</Badge>
			<Button class="lg:hidden" @click="filtersOpen = !filtersOpen">
				Filters{{ filterCount ? ` (${filterCount})` : "" }}
			</Button>
			<slot name="actions" />
		</div>
	</div>
</template>
