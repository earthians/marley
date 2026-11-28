<script setup>
import { computed } from "vue";
import { toNumber } from "../utils/format";
const props = defineProps({
	row: Object,
	previous: Object,
	metric: String,
	config: Object,
});
const date = computed(() =>
	window
		.moment(`${props.row.signs_date || ""} ${props.row.signs_time || "00:00:00"}`)
		.format("DD MMM YYYY · hh:mm A"),
);
function status(series) {
	const value = toNumber(props.row[series.key]);
	if (value === null) return __("No reading");
	if (!series.band) return __("Recorded");
	return value < series.band[0]
		? __("Low")
		: value > series.band[1]
		  ? __("High")
		  : __("Normal");
}
const delta = computed(() => {
	const series = props.config.series[0],
		current = toNumber(props.row[series.key]),
		before = toNumber(props.previous?.[series.key]);
	return current !== null && before !== null ? current - before : null;
});
</script>
<template>
	<div class="ph-chart-tooltip" role="status">
		<header>{{ date }}</header>
		<div
			v-for="(series, index) in config.series"
			:key="series.key"
			class="ph-tooltip-row"
		>
			<i
				:style="{
					'--series-color':
						index === 0
							? 'var(--ph-chart-systolic-from)'
							: 'var(--ph-chart-diastolic)',
				}"
			></i
			><span>{{ series.label }}</span>
			<strong>{{ row[series.key] ?? "—" }} {{ series.unit }}</strong>
			<em :class="`is-${status(series).toLowerCase()}`">{{ status(series) }}</em>
		</div>
		<footer v-if="delta !== null" :class="delta <= 0 ? 'is-good' : 'is-bad'">
			{{ delta >= 0 ? "▲ +" : "▼ " }}{{ delta.toFixed(0) }}
			{{ __("vs previous reading") }}
		</footer>
	</div>
</template>
