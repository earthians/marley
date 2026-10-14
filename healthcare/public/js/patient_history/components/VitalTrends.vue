<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import VitalChart from "./VitalChart.vue";
import CustomSelect from "./CustomSelect.vue";

const props = defineProps({ state: { type: Object, required: true } });
const hidden = ref([]);
const rangeOptions = [
	{ value: "6", label: __("Last 6 months") },
	{ value: "12", label: __("Last 12 months") },
	{ value: "all", label: __("All time") },
];
const visibleRows = computed(() => {
	const since =
		props.state.range === "all"
			? -Infinity
			: Date.now() - Number(props.state.range) * 30.4375 * 86400000;
	return props.state.data.filter(row => new Date(row.signs_date).getTime() >= since);
});
const primaryStats = computed(() => {
	const series = props.state.config.series[0];
	const points = visibleRows.value
		.map(row => ({
			value: Number(row[series.key]),
			diastolic: Number(row.bp_diastolic),
			date: row.signs_date,
		}))
		.filter(point => Number.isFinite(point.value));
	if (!points.length) return [];
	const low = points.reduce((a, b) => (a.value <= b.value ? a : b));
	const high = points.reduce((a, b) => (a.value >= b.value ? a : b));
	const average = points.reduce((sum, point) => sum + point.value, 0) / points.length;
	const diastolicPoints = points.filter(point => Number.isFinite(point.diastolic));
	const averageDiastolic = diastolicPoints.length
		? diastolicPoints.reduce((sum, point) => sum + point.diastolic, 0) /
			diastolicPoints.length
		: NaN;
	const bp = props.state.metric === "bp";
	return [
		{
			label: __("Lowest"),
			value: low.value,
			paired: low.diastolic,
			date: low.date,
		},
		{
			label: __("Average"),
			value: average,
			paired: averageDiastolic,
			date: "",
			count: `${points.length} ${__("readings")}`,
		},
		{
			label: __("Highest"),
			value: high.value,
			paired: high.diastolic,
			date: high.date,
		},
	].map(stat => ({ ...stat, bp }));
});
const statsKey = computed(
	() => `${props.state.metric}|${props.state.range}|${props.state.data.length}`,
);
const displayedStats = ref([]);
let statsFrame = 0;
watch(
	statsKey,
	() => {
		cancelAnimationFrame(statsFrame);
		const target = primaryStats.value;
		if (!target.length) {
			displayedStats.value = [];
			return;
		}
		const previous = new Map(displayedStats.value.map(stat => [stat.label, stat]));
		const from = target.map(stat => {
			const prior = previous.get(stat.label);
			return {
				value: Number(prior?.value) || 0,
				paired: Number(prior?.paired) || 0,
			};
		});
		if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
			displayedStats.value = target;
			return;
		}
		const started = performance.now();
		const animate = now => {
			const progress = Math.min(1, (now - started) / 650);
			const eased = 1 - (1 - progress) ** 3;
			displayedStats.value = target.map((stat, index) => ({
				...stat,
				value: from[index].value + (stat.value - from[index].value) * eased,
				paired: from[index].paired + (stat.paired - from[index].paired) * eased,
			}));
			if (progress < 1) statsFrame = requestAnimationFrame(animate);
			else displayedStats.value = target;
		};
		statsFrame = requestAnimationFrame(animate);
	},
	{ immediate: true },
);
onBeforeUnmount(() => cancelAnimationFrame(statsFrame));

function toggleSeries(key) {
	hidden.value = hidden.value.includes(key)
		? hidden.value.filter(item => item !== key)
		: [...hidden.value, key];
}
const metricTabs = computed(() => [
	["bp", __("Blood Pressure")],
	["pulse_rate", __("Pulse & Respiration")],
	["temperature", __("Temperature")],
	["bmi", __("BMI")],
]);
function statValue(stat) {
	const value = Math.round(Number(stat.value));
	const paired = Number(stat.paired);
	return stat.bp && Number.isFinite(paired)
		? `${value}/${Math.round(paired)} ${props.state.config.series[0].unit}`
		: `${value} ${props.state.config.series[0].unit}`;
}
</script>

<template>
	<section class="ph-card ph-vitals-card">
		<header class="ph-vitals-header">
			<div class="ph-vitals-title">
				<h2>{{ __("Vital Trends") }}</h2>
				<p>{{ state.config.title }}</p>
			</div>
			<div class="ph-vitals-header-controls">
				<div
					class="show_chart_btns"
					role="tablist"
					:aria-label="__('Measurement')"
				>
					<button
						v-for="item in metricTabs"
						:key="item[0]"
						type="button"
						role="tab"
						class="btn-show-chart"
						:aria-selected="state.metric === item[0]"
						:class="{ 'is-active': state.metric === item[0] }"
						@click="state.metric = item[0]"
					>
						{{ item[1] }}
					</button>
				</div>
				<CustomSelect
					v-model="state.range"
					:options="rangeOptions"
					:aria-label="__('Chart date range')"
					class="ph-range-select"
				/>
			</div>
		</header>
		<div
			v-if="state.loading"
			class="ph-chart-skeleton"
			:aria-label="__('Loading vital measurements')"
		>
			<svg viewBox="0 0 600 220" preserveAspectRatio="none" aria-hidden="true">
				<path
					d="M10 170 C80 150 110 75 180 110 S300 180 360 80 460 120 590 30"
				/></svg
			><i v-for="item in 5" :key="item"></i>
		</div>
		<div v-else-if="state.error" class="ph-chart-error">
			<p>{{ __("Could not load vital measurements") }}</p>
			<button type="button" @click="state.load()">{{ __("Retry") }}</button>
		</div>
		<VitalChart
			v-else
			:rows="state.data"
			:config="state.config"
			:range="state.range"
			:hidden-series="hidden"
			:metric="state.metric"
			@update:range="state.range = $event"
		/>
		<footer v-if="!state.loading && !state.error" class="ph-chart-footer">
			<div class="ph-chart-legend">
				<button
					v-for="series in state.config.series"
					:key="series.key"
					type="button"
					class="ph-chart-legend-item"
					:class="{ 'is-hidden': hidden.includes(series.key) }"
					:aria-pressed="!hidden.includes(series.key)"
					@click="toggleSeries(series.key)"
				>
					<i :class="{ 'is-dashed': series.dashed }"></i>{{ series.label }}
				</button>
			</div>
			<div v-if="displayedStats.length" class="ph-vital-stats">
				<div
					v-for="stat in displayedStats"
					:key="stat.label"
					class="ph-stat-chip"
				>
					<span>{{ stat.label }}</span
					><strong>{{ statValue(stat) }}</strong
					><time v-if="stat.date">{{
						moment(stat.date).format("DD MMM YYYY")
					}}</time
					><time v-else>{{ stat.count }}</time>
				</div>
			</div>
		</footer>
	</section>
</template>
