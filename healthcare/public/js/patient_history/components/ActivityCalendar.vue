<script setup>
import { computed, ref, watch } from "vue";
import { useBreakpoint } from "../composables/useBreakpoint";
import CustomSelect from "./CustomSelect.vue";
const props = defineProps({
	years: Array,
	year: Number,
	filter: String,
	days: Array,
	selected: String,
	loading: Boolean,
});
const emit = defineEmits(["update:year", "update:filter", "select-day"]);
const { monthWindow } = useBreakpoint();
const windowStart = ref(0),
	monthNames = computed(() => moment.monthsShort());
const yearOptions = computed(() => {
	const earliest = props.years.length
		? Math.min(...props.years)
		: new Date().getFullYear();
	return Array.from(
		{ length: new Date().getFullYear() - earliest + 1 },
		(_, index) => new Date().getFullYear() - index,
	);
});
const yearSelectOptions = computed(() =>
	yearOptions.value.map(value => ({ value, label: String(value) })),
);
const filterOptions = [
	{ value: "all", label: __("All records") },
	{ value: "encounters", label: __("Encounters only") },
	{ value: "vitals", label: __("Vitals only") },
	{ value: "labs", label: __("Labs only") },
];
const months = computed(() =>
	Array.from({ length: 12 }, (_, index) => index).slice(
		windowStart.value,
		windowStart.value + monthWindow.value,
	),
);
const dayMap = computed(() =>
	Object.fromEntries(props.days.map(day => [day.date, day])),
);
function monthWeeks(month) {
	const start = moment([props.year, month, 1]).startOf("isoWeek");
	return Array.from({ length: 6 }, (_, week) =>
		Array.from({ length: 7 }, (_, day) => {
			const date = start.clone().add(week * 7 + day, "day");
			return date.month() === month ? date.format("YYYY-MM-DD") : "";
		}),
	);
}
function moveMonth(amount) {
	windowStart.value = Math.max(
		0,
		Math.min(12 - monthWindow.value, windowStart.value + amount),
	);
}
watch(
	() => props.year,
	() => {
		windowStart.value = 0;
	},
);
</script>
<template>
	<section class="ph-card ph-activity-card" aria-label="Clinical activity">
		<header class="ph-activity-header">
			<div class="ph-card-heading">
				<div class="ph-heading-icon" aria-hidden="true">
					<svg viewBox="0 0 24 24" fill="none">
						<rect
							x="3.5"
							y="5"
							width="17"
							height="15.5"
							rx="2.5"
							stroke="currentColor"
							stroke-width="1.7"
						/>
						<path
							d="M7.5 3.5v3M16.5 3.5v3M4 9h16M8 12.5h2M14 12.5h2M8 16h2M14 16h2"
							stroke="currentColor"
							stroke-width="1.7"
							stroke-linecap="round"
						/>
					</svg>
				</div>
				<div>
					<h2>{{ __("Clinical Activity") }}</h2>
					<p>
						{{
							days.reduce((sum, item) => sum + Number(item.total || 0), 0)
						}}
						{{ __("records this year") }}
					</p>
				</div>
			</div>
			<div class="ph-activity-controls">
				<div
					class="ph-year-control"
					role="group"
					:aria-label="__('Activity year')"
					@keydown.left.prevent="emit('update:year', year - 1)"
					@keydown.right.prevent="emit('update:year', year + 1)"
				>
					<button
						type="button"
						:aria-label="__('Previous year')"
						:disabled="!years.length || year <= Math.min(...years)"
						@click="emit('update:year', year - 1)"
					>
						‹
					</button>
					<CustomSelect
						:model-value="year"
						:options="yearSelectOptions"
						:aria-label="__('Choose year')"
						:show-chevron="false"
						class="ph-year-select"
						@update:model-value="emit('update:year', Number($event))"
					/>
					<button
						type="button"
						:aria-label="__('Next year')"
						:disabled="year >= new Date().getFullYear()"
						@click="emit('update:year', year + 1)"
					>
						›
					</button>
				</div>
				<CustomSelect
					:model-value="filter"
					:options="filterOptions"
					:aria-label="__('Record filter')"
					class="ph-activity-filter"
					@update:model-value="emit('update:filter', $event)"
				/>
			</div>
		</header>
		<div class="ph-activity-scroll">
			<div class="ph-month-window-controls" v-if="monthWindow < 12">
				<button
					type="button"
					:aria-label="__('Previous months')"
					:disabled="windowStart === 0"
					@click="moveMonth(-monthWindow)"
				>
					‹</button
				><button
					type="button"
					:aria-label="__('Next months')"
					:disabled="windowStart + monthWindow >= 12"
					@click="moveMonth(monthWindow)"
				>
					›
				</button>
			</div>
			<div class="ph-activity-months">
				<section
					v-for="month in months"
					:key="`${year}-${month}`"
					class="ph-month"
				>
					<h3 class="ph-month-name">{{ monthNames[month] }}</h3>
					<div class="ph-month-grid">
						<div
							v-for="(week, weekIndex) in monthWeeks(month)"
							:key="`${month}-${weekIndex}`"
							class="ph-week"
						>
							<template
								v-for="(date, dayIndex) in week"
								:key="`${weekIndex}-${dayIndex}`"
								><button
									v-if="date"
									type="button"
									class="ph-activity-cell"
									:class="[
										`level-${Math.min(4, Math.ceil(Number(dayMap[date]?.total || 0) / 2))}`,
										{
											'is-abnormal': dayMap[date]?.abnormal,
											'is-selected': date === selected,
											'is-future':
												date > moment().format('YYYY-MM-DD'),
										},
									]"
									:disabled="
										!dayMap[date]?.total ||
										date > moment().format('YYYY-MM-DD')
									"
									:aria-label="`${moment(date).format('DD MMM YYYY')}: ${dayMap[date]?.total || 0} ${__('records')}`"
									:title="moment(date).format('dddd, DD MMM YYYY')"
									:aria-current="
										date === moment().format('YYYY-MM-DD')
											? 'date'
											: undefined
									"
									@click="emit('select-day', date)"
								></button
								><span v-else class="ph-activity-blank"></span
							></template>
						</div>
					</div>
				</section>
			</div>
		</div>
		<div class="ph-day-detail">
			<strong>{{
				selected
					? moment(selected).format("dddd, DD MMM YYYY")
					: __("Select a day with activity")
			}}</strong>
			<div v-if="selected && dayMap[selected]" class="ph-day-badges">
				<button
					type="button"
					v-for="item in Object.entries(dayMap[selected].by_type || {})"
					:key="item[0]"
					@click="$emit('select-day', selected, item[0])"
				>
					{{ item[0] }} · {{ item[1] }}
				</button>
			</div>
			<span v-else-if="selected">{{
				__("No activity recorded for this day.")
			}}</span>
		</div>
	</section>
</template>
