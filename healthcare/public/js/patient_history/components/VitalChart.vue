<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import ChartTooltip from "./ChartTooltip.vue";
import { timestamp } from "../utils/format";

const props = defineProps({
	metric: { type: String, default: "bp" },
	rows: { type: Array, default: () => [] },
	config: Object,
	range: String,
	hiddenSeries: { type: Array, default: () => [] },
});
const emit = defineEmits(["update:range"]);
const container = ref(null),
	svgElement = ref(null),
	width = ref(1),
	height = ref(320),
	activeKey = ref(null),
	tooltipPosition = ref({ left: "0px", top: "0px" }),
	tooltipBelow = ref(false),
	arrowPosition = ref("50%"),
	axisFading = ref(false);
let resizeObserver, drawFrame, morphFrame;
const reducedMotion = () =>
	window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
function valid(value) {
	return (
		value !== null &&
		value !== undefined &&
		value !== "" &&
		Number.isFinite(Number(value))
	);
}
function time(row) {
	return timestamp(`${row.signs_date || ""} ${row.signs_time || "00:00:00"}`);
}
function pointKey(series, point) {
	return `${series.key}|${point.rowIndex}|${point.at}`;
}
function capturePaths() {
	return new Map(
		[...(container.value?.querySelectorAll(".ph-chart-line") || [])].map(path => [
			path.dataset.series,
			path.getAttribute("d"),
		]),
	);
}
function tokenize(path) {
	return path.match(/[a-zA-Z]|-?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) || [];
}
function morphPaths(previous) {
	cancelAnimationFrame(morphFrame);
	const paths = [
		...(container.value?.querySelectorAll(".ph-chart-line") || []),
	].flatMap(path => {
		const from = previous.get(path.dataset.series),
			to = path.getAttribute("d");
		if (!from || !to) return [];
		const start = tokenize(from),
			end = tokenize(to);
		if (
			start.length !== end.length ||
			start.some((token, i) => /[a-z]/i.test(token) !== /[a-z]/i.test(end[i]))
		)
			return [];
		return [{ path, start, end }];
	});
	if (!paths.length || reducedMotion()) return false;
	const startAt = performance.now(),
		duration = 500;
	const animate = now => {
		const progress = Math.min(1, (now - startAt) / duration),
			eased =
				progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
		paths.forEach(({ path, start, end }) =>
			path.setAttribute(
				"d",
				end
					.map((token, i) =>
						/[a-z]/i.test(token)
							? token
							: String(
									Number(start[i]) +
										(Number(token) - Number(start[i])) * eased,
								),
					)
					.join(" "),
			),
		);
		if (progress < 1) morphFrame = requestAnimationFrame(animate);
	};
	morphFrame = requestAnimationFrame(animate);
	return true;
}
function drawIn() {
	cancelAnimationFrame(drawFrame);
	nextTick(() => {
		const paths = container.value?.querySelectorAll(".ph-chart-line") || [];
		if (reducedMotion()) {
			paths.forEach(path => (path.style.strokeDashoffset = "0"));
			return;
		}
		paths.forEach(path => {
			path.style.strokeDasharray = "1";
			path.style.strokeDashoffset = "1";
		});
		drawFrame = requestAnimationFrame(() =>
			paths.forEach(path => (path.style.strokeDashoffset = "0")),
		);
	});
}
onMounted(() => {
	resizeObserver = new ResizeObserver(entries => {
		width.value = Math.max(1, entries[0].contentRect.width);
		height.value = width.value <= 640 ? 240 : 320;
	});
	if (container.value) resizeObserver.observe(container.value);
	drawIn();
});
watch(
	[() => props.metric, () => props.range, () => props.rows, () => props.hiddenSeries],
	async () => {
		const oldPaths = capturePaths();
		activeKey.value = null;
		axisFading.value = true;
		await nextTick();
		if (!morphPaths(oldPaths)) drawIn();
		requestAnimationFrame(() => {
			axisFading.value = false;
		});
	},
	{ flush: "pre" },
);
onBeforeUnmount(() => {
	resizeObserver?.disconnect();
	cancelAnimationFrame(drawFrame);
	cancelAnimationFrame(morphFrame);
});

const visibleRows = computed(() => {
	const since =
		props.range === "all"
			? -Infinity
			: Date.now() - Number(props.range) * 30.4375 * 86400000;
	return props.rows.filter(
		row =>
			time(row) >= since &&
			props.config.series.some(series => valid(row[series.key])),
	);
});
const frame = computed(() => {
	const rows = visibleRows.value,
		config = props.config;
	const left = 48,
		right = props.metric === "pulse_rate" ? 40 : 20,
		top = 26,
		bottom = 44,
		padX = 24;
	const plotLeft = left + padX,
		plotRight = Math.max(plotLeft + 1, width.value - right - padX),
		plotWidth = plotRight - plotLeft,
		plotHeight = height.value - top - bottom;
	let minTime = rows.length ? time(rows[0]) : 0,
		maxTime = rows.length ? time(rows.at(-1)) : 1;
	if (minTime === maxTime) {
		minTime -= 43200000;
		maxTime += 43200000;
	}
	const x = at => plotLeft + ((at - minTime) / (maxTime - minTime)) * plotWidth;
	const values = rows.flatMap(row =>
		config.series
			.filter(series => !props.hiddenSeries.includes(series.key))
			.map(series => row[series.key])
			.filter(valid)
			.map(Number),
	);
	let min, max, step;
	if (props.metric === "bp") {
		min = 60;
		max = 180;
		step = 20;
	} else {
		step = props.metric === "temperature" ? 0.5 : props.metric === "bmi" ? 5 : 20;
		const range = values.length ? values : config.range;
		min = Math.floor(Math.min(config.range[0], ...range) / step) * step;
		max = Math.ceil(Math.max(config.range[1], ...range) / step) * step;
		if (min === max) max = min + step;
	}
	const y = value => top + ((max - value) / (max - min || 1)) * plotHeight;
	const yFor = (value, series) =>
		props.metric === "pulse_rate" && series.key === "respiratory_rate"
			? top + ((30 - value) / 22) * plotHeight
			: y(value);
	const ticks = [];
	for (let tick = min; tick <= max; tick += step) ticks.push(Number(tick.toFixed(1)));
	const series = config.series.map(item => {
		const points = rows
			.map((row, rowIndex) => ({
				row,
				rowIndex,
				at: time(row),
				value: valid(row[item.key]) ? Number(row[item.key]) : null,
			}))
			.filter(point => point.value !== null)
			.map(point => ({
				...point,
				x: x(point.at),
				y: yFor(point.value, item),
				abnormal:
					!!item.band &&
					(point.value < item.band[0] || point.value > item.band[1]),
			}));
		const path = points
			.map((point, index) => {
				if (!index) return `M${point.x},${point.y}`;
				const before = points[index - 1];
				if (item.dashed) return `L${point.x},${point.y}`;
				const dx = point.x - before.x;
				if (dx <= 0) return `L${point.x},${point.y}`;
				const slope = (point.y - before.y) / dx;
				const priorSlope =
					index > 1
						? (before.y - points[index - 2].y) /
							(before.x - points[index - 2].x || 1)
						: slope;
				const next = points[index + 1],
					nextSlope = next
						? (next.y - point.y) / (next.x - point.x || 1)
						: slope;
				const tangentBefore =
					priorSlope * slope <= 0
						? 0
						: (2 * priorSlope * slope) / (priorSlope + slope);
				const tangentAfter =
					slope * nextSlope <= 0
						? 0
						: (2 * slope * nextSlope) / (slope + nextSlope);
				return `C${before.x + dx / 3},${before.y + (tangentBefore * dx) / 3} ${point.x - dx / 3},${point.y - (tangentAfter * dx) / 3} ${point.x},${point.y}`;
			})
			.join(" ");
		return { ...item, points, path };
	});
	const span = maxTime - minTime,
		limit = width.value < 640 ? 3 : 6,
		count = Math.min(limit, Math.max(1, rows.length));
	const dateFormat =
		span > 730 * 86400000 ? "YYYY" : span > 100 * 86400000 ? "MMM YYYY" : "DD MMM";
	const ticksX = Array.from({ length: count }, (_, index) => {
		const at = minTime + (span * index) / (count - 1 || 1);
		return {
			at,
			x: x(at),
			text: moment(at).format(dateFormat),
			anchor: index === 0 ? "start" : index === count - 1 ? "end" : "middle",
		};
	}).filter((tick, index, all) => index === 0 || tick.text !== all[index - 1].text);
	const normalBand = config.normalBand || (props.metric === "bp" ? [80, 120] : null);
	const bands = normalBand
		? [
				{
					key: "normal",
					top: y(normalBand[1]),
					bottom: y(normalBand[0]),
					label: `${__("Normal")} ${normalBand[0]}–${normalBand[1]}`,
				},
			]
		: [];
	const secondaryTicks =
		props.metric === "pulse_rate"
			? [8, 12, 16, 20, 24, 30].map(value => ({
					value,
					y: yFor(value, { key: "respiratory_rate" }),
				}))
			: [];
	return {
		left,
		right,
		top,
		bottom,
		plotLeft,
		plotRight,
		plotWidth,
		plotHeight,
		minTime,
		maxTime,
		x,
		y,
		ticks,
		ticksX,
		series,
		bands,
		secondaryTicks,
	};
});
const activePoint = computed(() => {
	if (!activeKey.value) return null;
	for (const series of frame.value.series) {
		const point = series.points.find(
			item => pointKey(series, item) === activeKey.value,
		);
		if (point) return { series, point };
	}
	return null;
});
const activeRow = computed(() => activePoint.value?.point.row || null);
const previousRow = computed(() => {
	if (!activeRow.value) return null;
	const index = visibleRows.value.indexOf(activeRow.value);
	return index > 0 ? visibleRows.value[index - 1] : null;
});
function positionTooltip() {
	const selected = activePoint.value;
	const svg = svgElement.value,
		card = container.value;
	if (!selected || !svg || !card) return;
	const point = selected.point,
		svgRect = svg.getBoundingClientRect(),
		cardRect = card.getBoundingClientRect();
	const key = pointKey(selected.series, point);
	const centerX =
		svgRect.left - cardRect.left + (point.x / width.value) * svgRect.width;
	const pointY =
		svgRect.top - cardRect.top + (point.y / height.value) * svgRect.height;
	nextTick(() => {
		const tooltip = card.querySelector(".ph-chart-tooltip");
		if (!tooltip || activeKey.value !== key) return;
		const tooltipWidth = tooltip.offsetWidth,
			tooltipHeight = tooltip.offsetHeight;
		let left = centerX - tooltipWidth / 2;
		left = Math.max(8, Math.min(left, card.clientWidth - tooltipWidth - 8));
		const below = pointY - tooltipHeight - 12 < 4;
		let top = below ? pointY + 12 : pointY - tooltipHeight - 12;
		top = Math.max(4, Math.min(top, card.clientHeight - tooltipHeight - 4));
		arrowPosition.value = `${Math.max(14, Math.min(tooltipWidth - 14, centerX - left))}px`;
		tooltipBelow.value = below;
		tooltipPosition.value = { left: `${left}px`, top: `${top}px` };
	});
}
function showPoint(series, point) {
	activeKey.value = pointKey(series, point);
	positionTooltip();
}
function hidePoint(series, point) {
	if (!series || !point || activeKey.value === pointKey(series, point))
		activeKey.value = null;
}
function blurPoint(event, series, point) {
	if (!event.relatedTarget?.classList?.contains("ph-vital-hit"))
		hidePoint(series, point);
}
function moveFocus(event, series, point) {
	if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
	event.preventDefault();
	const hits = [...container.value.querySelectorAll(".ph-vital-hit")].sort(
		(a, b) =>
			Number(a.dataset.rowIndex) - Number(b.dataset.rowIndex) ||
			Number(a.dataset.seriesIndex) - Number(b.dataset.seriesIndex),
	);
	const current = event.currentTarget,
		index = hits.indexOf(current),
		direction = event.key === "ArrowRight" ? 1 : -1;
	const next = hits[index + direction];
	if (next) next.focus();
	else showPoint(series, point);
}
function activateOnTap(event, series, point) {
	event.stopPropagation();
	showPoint(series, point);
}
function seriesColor(index) {
	return index === 0 ? "var(--ph-chart-systolic-from)" : "var(--ph-chart-diastolic)";
}
</script>

<template>
	<div ref="container" class="patient_vital_charts" @pointerdown="hidePoint()">
		<div v-if="!rows.length" class="ph-empty">
			{{ __("No vital signs recorded for this patient") }}
		</div>
		<div v-else-if="!visibleRows.length" class="ph-empty">
			<p>{{ __("No readings in the selected range") }}</p>
			<button type="button" @click="emit('update:range', 'all')">
				{{ __("Show all time") }}
			</button>
		</div>
		<svg
			v-else
			ref="svgElement"
			class="ph-trends-svg"
			:class="{ 'is-axis-fading': axisFading }"
			:viewBox="`0 0 ${width} ${height}`"
			:aria-label="`${config.title}, ${visibleRows.length} ${__('readings')}`"
			preserveAspectRatio="xMidYMid meet"
		>
			<defs>
				<linearGradient id="ph-systolic-gradient" x1="0" x2="1">
					<stop offset="0" stop-color="var(--ph-chart-systolic-from)" />
					<stop offset="1" stop-color="var(--ph-chart-systolic-to)" />
				</linearGradient>
				<linearGradient id="ph-diastolic-gradient" x1="0" x2="1">
					<stop offset="0" stop-color="var(--ph-chart-diastolic)" />
					<stop offset="1" stop-color="var(--ph-chart-diastolic-to)" />
				</linearGradient>
				<linearGradient id="ph-chart-band-gradient" x1="0" x2="1">
					<stop
						offset="0"
						stop-color="var(--ph-chart-band)"
						stop-opacity=".10"
					/>
					<stop
						offset=".5"
						stop-color="var(--ph-chart-band)"
						stop-opacity=".14"
					/>
					<stop
						offset="1"
						stop-color="var(--ph-chart-band)"
						stop-opacity=".10"
					/>
				</linearGradient>
			</defs>
			<rect
				v-for="zone in frame.bands"
				:key="`${zone.key}-high`"
				:x="frame.plotLeft"
				:y="frame.top"
				:width="frame.plotWidth"
				:height="zone.top - frame.top"
				fill="var(--ph-chart-abnormal-zone)"
				opacity=".2"
			/>
			<rect
				v-for="zone in frame.bands"
				:key="`${zone.key}-low`"
				:x="frame.plotLeft"
				:y="zone.bottom"
				:width="frame.plotWidth"
				:height="height - frame.bottom - zone.bottom"
				fill="var(--ph-chart-abnormal-zone)"
				opacity=".2"
			/>
			<g
				v-for="(tick, index) in frame.ticks"
				:key="tick"
				class="ph-chart-axis"
				:style="{ '--tick-delay': `${index * 40}ms` }"
			>
				<line
					:x1="frame.plotLeft"
					:x2="frame.plotRight"
					:y1="frame.y(tick)"
					:y2="frame.y(tick)"
				/>
				<text :x="frame.left - 8" :y="frame.y(tick) + 4" text-anchor="end">
					{{ tick }}
				</text>
			</g>
			<text class="ph-chart-unit" :x="frame.left - 8" y="18" text-anchor="end">
				{{ config.series[0]?.unit }}
			</text>
			<g
				v-for="band in frame.bands"
				:key="`band-${band.key}`"
				class="ph-chart-normal-band"
			>
				<rect
					:x="frame.plotLeft"
					:y="band.top"
					:width="frame.plotWidth"
					:height="band.bottom - band.top"
					fill="url(#ph-chart-band-gradient)"
				/>
				<line
					:x1="frame.plotLeft"
					:x2="frame.plotRight"
					:y1="band.top"
					:y2="band.top"
				/>
				<line
					:x1="frame.plotLeft"
					:x2="frame.plotRight"
					:y1="band.bottom"
					:y2="band.bottom"
				/>
				<text
					:x="frame.plotRight - 4"
					:y="(band.top + band.bottom) / 2 + 3"
					text-anchor="end"
				>
					{{ band.label }}
				</text>
			</g>
			<template v-for="(series, seriesIndex) in frame.series" :key="series.key">
				<path
					v-if="series.points.length > 1"
					pathLength="1"
					class="ph-chart-line"
					:data-series="series.key"
					:class="[
						{ 'is-dashed': series.dashed },
						{ 'is-hidden': hiddenSeries.includes(series.key) },
					]"
					:d="series.path"
					:style="{
						stroke:
							seriesIndex === 0
								? 'url(#ph-systolic-gradient)'
								: 'url(#ph-diastolic-gradient)',
					}"
				/>
				<g
					v-for="(point, index) in series.points"
					:key="`${series.key}-${point.rowIndex}-${point.at}`"
					class="ph-point-wrap"
					:class="{
						'is-focused': activeKey === pointKey(series, point),
						'is-dimmed': activeKey && activeKey !== pointKey(series, point),
						'is-hidden': hiddenSeries.includes(series.key),
					}"
					:style="{
						'--point-delay': `${Math.min(1800, 1000 + index * 15)}ms`,
					}"
				>
					<line
						v-if="activeKey === pointKey(series, point)"
						class="ph-point-guide"
						:x1="point.x"
						:x2="point.x"
						:y1="point.y"
						:y2="height - frame.bottom"
					/>
					<circle
						v-if="seriesIndex === 0 && point === series.points.at(-1)"
						class="ph-latest-ping"
						:cx="point.x"
						:cy="point.y"
						r="8"
					/>
					<circle
						class="ph-vital-dot"
						:class="{ 'is-abnormal': point.abnormal }"
						:cx="point.x"
						:cy="point.y"
						r="4"
						:style="{
							fill: point.abnormal
								? 'var(--ph-chart-abnormal)'
								: seriesColor(seriesIndex),
							stroke: 'var(--ph-surface)',
						}"
					/>
					<circle
						class="ph-vital-hit"
						:class="{ 'is-focused': activeKey === pointKey(series, point) }"
						:data-row-index="point.rowIndex"
						:data-series-index="seriesIndex"
						:cx="point.x + ((index % 3) - 1) * 1.4"
						:cy="point.y"
						r="14"
						fill="transparent"
						:tabindex="hiddenSeries.includes(series.key) ? -1 : 0"
						:aria-label="
							__('{0}, {1} {2} {3}', [
								moment(
									point.row.signs_date +
										' ' +
										(point.row.signs_time || '00:00'),
								).format('DD MMM YYYY · hh:mm A'),
								series.label,
								point.value,
								series.unit,
							])
						"
						@pointerenter="showPoint(series, point)"
						@pointerleave="hidePoint(series, point)"
						@pointerdown.stop.prevent="activateOnTap($event, series, point)"
						@focus="showPoint(series, point)"
						@blur="blurPoint($event, series, point)"
						@keydown="moveFocus($event, series, point)"
					/>
				</g>
			</template>
			<text
				v-for="(tick, index) in frame.ticksX"
				:key="`${tick.at}-${index}`"
				class="ph-chart-xlabel"
				:x="tick.x"
				:y="height - 13"
				:text-anchor="tick.anchor"
			>
				{{ tick.text }}
			</text>
			<text
				v-for="tick in frame.secondaryTicks"
				:key="`right-${tick.value}`"
				class="ph-chart-axis-right"
				:x="width - frame.right + 4"
				:y="tick.y + 4"
			>
				{{ tick.value }}
			</text>
		</svg>
		<span class="sr-only" aria-live="polite">{{
			activeRow
				? `${moment(time(activeRow)).format("DD MMM YYYY HH:mm")}: ${config.series.map(series => `${series.label} ${activeRow[series.key] ?? __("No reading")}`).join(", ")}`
				: ""
		}}</span>
		<ChartTooltip
			v-if="activeRow"
			:class="{ 'is-below': tooltipBelow }"
			:style="{ ...tooltipPosition, '--arrow-left': arrowPosition }"
			:row="activeRow"
			:previous="previousRow"
			:metric="metric"
			:config="config"
		/>
	</div>
</template>
