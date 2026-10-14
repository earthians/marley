<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

const props = defineProps({
	from: { type: String, default: null },
	to: { type: String, default: null },
	inputId: { type: String, default: "ph-date-range" },
});
const emit = defineEmits(["update:from", "update:to", "change"]);

const ISO = "YYYY-MM-DD";
const open = ref(false);
const field = ref(null);
const trigger = ref(null);
const panel = ref(null);
const draftFrom = ref("");
const draftTo = ref("");
const pos = ref({ top: 0, left: 0, width: 340 });

const fmt = value => (value ? moment(value, ISO).format("DD MMM YYYY") : "");
const label = computed(() => {
	if (props.from && props.to) return `${fmt(props.from)} – ${fmt(props.to)}`;
	if (props.from) return `${fmt(props.from)} – …`;
	if (props.to) return `… – ${fmt(props.to)}`;
	return "";
});
const hasValue = computed(() => Boolean(props.from || props.to));
const invalid = computed(() =>
	Boolean(draftFrom.value && draftTo.value && draftFrom.value > draftTo.value),
);
const canApply = computed(
	() => Boolean(draftFrom.value && draftTo.value) && !invalid.value,
);

const presets = computed(() => {
	const lastMonth = moment().subtract(1, "month");
	return [
		[__("Last 7 days"), moment().subtract(6, "days"), moment()],
		[__("Last 30 days"), moment().subtract(29, "days"), moment()],
		[__("This month"), moment().startOf("month"), moment()],
		[
			__("Last month"),
			lastMonth.clone().startOf("month"),
			lastMonth.clone().endOf("month"),
		],
		[__("Last 3 months"), moment().subtract(3, "months"), moment()],
		[__("This year"), moment().startOf("year"), moment()],
	].map(([text, from, to]) => ({ text, from: from.format(ISO), to: to.format(ISO) }));
});
const isActive = preset =>
	preset.from === draftFrom.value && preset.to === draftTo.value;

function place() {
	if (!field.value) return;
	const rect = field.value.getBoundingClientRect();
	const width = Math.min(340, window.innerWidth - 24);
	const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
	let top = rect.bottom + 6;
	const height = panel.value ? panel.value.offsetHeight : 300;
	if (top + height > window.innerHeight - 12 && rect.top - height - 6 > 12)
		top = rect.top - height - 6;
	pos.value = { top, left, width };
}
function openPanel() {
	draftFrom.value = props.from || "";
	draftTo.value = props.to || "";
	open.value = true;
	nextTick(place);
}
function close(returnFocus = true) {
	open.value = false;
	if (returnFocus) trigger.value?.focus();
}
function toggle() {
	open.value ? close(false) : openPanel();
}
function commit() {
	if (!canApply.value) return;
	emit("update:from", draftFrom.value);
	emit("update:to", draftTo.value);
	emit("change");
	close();
}
function applyPreset(preset) {
	draftFrom.value = preset.from;
	draftTo.value = preset.to;
	commit();
}
function clear() {
	draftFrom.value = "";
	draftTo.value = "";
	emit("update:from", null);
	emit("update:to", null);
	emit("change");
	if (open.value) close();
}
function onOutside(event) {
	if (panel.value?.contains(event.target) || field.value?.contains(event.target))
		return;
	close(false);
}
function onKey(event) {
	if (event.key === "Escape") {
		event.stopPropagation();
		close();
	}
}
function bind(on) {
	const method = on ? "addEventListener" : "removeEventListener";
	document[method]("pointerdown", onOutside, true);
	document[method]("keydown", onKey);
	window[method]("resize", place);
	window[method]("scroll", place, true);
}
watch(open, bind);
onBeforeUnmount(() => bind(false));
</script>

<template>
	<div class="phdr">
		<div ref="field" class="phdr-field" :class="{ 'is-open': open }">
			<button
				:id="inputId"
				ref="trigger"
				type="button"
				class="phdr-trigger"
				:class="{ 'has-value': hasValue }"
				aria-haspopup="dialog"
				:aria-expanded="open"
				@click="toggle"
			>
				<svg class="phdr-icon" viewBox="0 0 20 20" aria-hidden="true">
					<rect
						x="3"
						y="4.5"
						width="14"
						height="12.5"
						rx="2.5"
						fill="none"
						stroke="currentColor"
						stroke-width="1.6"
					/>
					<path
						d="M3 8.5h14M7 2.8v3M13 2.8v3"
						fill="none"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
					/>
				</svg>
				<span class="phdr-text">{{ label || __("Select date range") }}</span>
			</button>
			<button
				v-if="hasValue"
				type="button"
				class="phdr-clear"
				:aria-label="__('Clear date range')"
				@click="clear"
			>
				×
			</button>
		</div>

		<Teleport to="body">
			<div
				v-if="open"
				ref="panel"
				class="phdr-panel"
				role="dialog"
				:aria-label="__('Choose date range')"
				:style="{
					top: pos.top + 'px',
					left: pos.left + 'px',
					width: pos.width + 'px',
				}"
			>
				<div class="phdr-presets">
					<button
						v-for="preset in presets"
						:key="preset.text"
						type="button"
						class="phdr-preset"
						:class="{ 'is-active': isActive(preset) }"
						@click="applyPreset(preset)"
					>
						{{ preset.text }}
					</button>
				</div>
				<div class="phdr-divider"></div>
				<div class="phdr-dates">
					<label class="phdr-date"
						><span>{{ __("From") }}</span
						><input v-model="draftFrom" type="date" :max="draftTo || null"
					/></label>
					<label class="phdr-date"
						><span>{{ __("To") }}</span
						><input v-model="draftTo" type="date" :min="draftFrom || null"
					/></label>
				</div>
				<p v-if="invalid" class="phdr-note is-error">
					{{ __("The start date must be before the end date.") }}
				</p>
				<p
					v-else-if="(draftFrom && !draftTo) || (!draftFrom && draftTo)"
					class="phdr-note"
				>
					{{ __("Pick both dates to apply.") }}
				</p>
				<div class="phdr-actions">
					<button
						type="button"
						class="phdr-link"
						:disabled="!hasValue && !draftFrom && !draftTo"
						@click="clear"
					>
						{{ __("Clear") }}
					</button>
					<button
						type="button"
						class="phdr-apply"
						:disabled="!canApply"
						@click="commit"
					>
						{{ __("Apply") }}
					</button>
				</div>
			</div>
		</Teleport>
	</div>
</template>

<style scoped>
.phdr,
.phdr-panel {
	--d-border: var(--ph-border, var(--border-color, #e2e8f0));
	--d-text: var(--ph-text, var(--text-color, #0f172a));
	--d-muted: var(--ph-muted, var(--text-muted, #64748b));
	--d-primary: var(--ph-primary, var(--primary, #2563eb));
	--d-bg: var(--control-bg, var(--ph-surface, #fff));
	--d-surface: var(--card-bg, #fff);
	--d-hover: color-mix(in srgb, var(--d-text) 6%, transparent);
}
.phdr {
	position: relative;
	width: 100%;
	min-width: 0;
}

/* the field */
.phdr-field {
	display: flex;
	align-items: center;
	height: 46px;
	box-sizing: border-box;
	border: 1px solid var(--d-border);
	border-radius: 10px;
	background: var(--d-bg);
	transition:
		border-color 0.16s ease,
		box-shadow 0.16s ease,
		background-color 0.16s ease;
}
.phdr-field:hover {
	border-color: color-mix(in srgb, var(--d-text) 25%, var(--d-border));
}
.phdr-field:focus-within,
.phdr-field.is-open {
	border-color: var(--d-primary);
	box-shadow: 0 0 0 3px color-mix(in srgb, var(--d-primary) 20%, transparent);
}
.phdr-trigger {
	display: flex;
	flex: 1;
	align-items: center;
	gap: 8px;
	min-width: 0;
	height: 100%;
	padding: 0 8px 0 11px;
	border: 0;
	border-radius: 8px;
	background: transparent;
	color: var(--d-muted);
	font: inherit;
	font-size: 12px;
	text-align: left;
	cursor: pointer;
	outline: none;
}
.phdr-trigger.has-value {
	color: var(--d-text);
	font-weight: 500;
}
.phdr-icon {
	flex: none;
	width: 16px;
	height: 16px;
	color: var(--d-muted);
}
.phdr-text {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.phdr-clear {
	display: grid;
	flex: none;
	place-items: center;
	width: 22px;
	height: 22px;
	margin-right: 6px;
	padding: 0;
	border: 0;
	border-radius: 50%;
	background: transparent;
	color: var(--d-muted);
	font-size: 16px;
	line-height: 1;
	cursor: pointer;
}
.phdr-clear:hover {
	background: var(--d-hover);
	color: var(--d-text);
}

/* the popover */
.phdr-panel {
	position: fixed;
	z-index: 1060;
	box-sizing: border-box;
	padding: 14px;
	border: 1px solid var(--d-border);
	border-radius: 12px;
	background: var(--d-surface);
	color: var(--d-text);
	font-size: 12px;
	box-shadow:
		0 12px 32px rgba(15, 23, 42, 0.16),
		0 2px 6px rgba(15, 23, 42, 0.06);
	animation: phdr-in 0.14s ease-out;
}
@keyframes phdr-in {
	from {
		opacity: 0;
		transform: translateY(-4px);
	}
	to {
		opacity: 1;
		transform: none;
	}
}
@media (prefers-reduced-motion: reduce) {
	.phdr-panel {
		animation: none;
	}
}
.phdr-presets {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 6px;
}
.phdr-preset {
	height: 30px;
	padding: 0 8px;
	border: 1px solid var(--d-border);
	border-radius: 8px;
	background: transparent;
	color: var(--d-text);
	font: inherit;
	cursor: pointer;
	transition:
		background 0.12s,
		border-color 0.12s;
}
.phdr-preset:hover {
	background: var(--d-hover);
}
.phdr-preset.is-active {
	border-color: var(--d-primary);
	background: color-mix(in srgb, var(--d-primary) 10%, transparent);
	color: var(--d-primary);
	font-weight: 600;
}
.phdr-divider {
	height: 1px;
	margin: 12px 0;
	background: var(--d-border);
}
.phdr-dates {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 10px;
}
.phdr-date {
	display: flex;
	flex-direction: column;
	gap: 4px;
	min-width: 0;
}
.phdr-date > span {
	color: var(--d-muted);
	font-size: 10px;
	font-weight: 650;
	letter-spacing: 0.06em;
	text-transform: uppercase;
}
.phdr-date input {
	box-sizing: border-box;
	width: 100%;
	height: 34px;
	padding: 0 8px;
	border: 1px solid var(--d-border);
	border-radius: 8px;
	background: var(--d-bg);
	color: var(--d-text);
	color-scheme: light dark;
	font: inherit;
	font-size: 12px;
}
.phdr-date input:focus {
	border-color: var(--d-primary);
	outline: 2px solid color-mix(in srgb, var(--d-primary) 25%, transparent);
	outline-offset: 1px;
}
.phdr-note {
	margin: 8px 0 0;
	color: var(--d-muted);
	font-size: 11px;
}
.phdr-note.is-error {
	color: #dc2626;
}
.phdr-actions {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-top: 12px;
}
.phdr-link {
	padding: 4px 2px;
	border: 0;
	background: transparent;
	color: var(--d-muted);
	font: inherit;
	font-weight: 600;
	cursor: pointer;
}
.phdr-link:hover:not(:disabled) {
	color: var(--d-text);
}
.phdr-link:disabled {
	opacity: 0.4;
	cursor: default;
}
.phdr-apply {
	height: 32px;
	padding: 0 16px;
	border: 0;
	border-radius: 8px;
	background: var(--d-primary);
	color: #fff;
	font: inherit;
	font-weight: 600;
	cursor: pointer;
	transition:
		filter 0.12s,
		opacity 0.12s;
}
.phdr-apply:hover:not(:disabled) {
	filter: brightness(1.08);
}
.phdr-apply:disabled {
	opacity: 0.45;
	cursor: not-allowed;
}
</style>
