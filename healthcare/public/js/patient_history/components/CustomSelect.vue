<script setup>
import { onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps({
	modelValue: { type: [String, Number], required: true },
	options: { type: Array, required: true },
	ariaLabel: { type: String, required: true },
	showChevron: { type: Boolean, default: true },
});
const emit = defineEmits(["update:modelValue"]);
const root = ref(null);
const trigger = ref(null);
const open = ref(false);
const selected = () =>
	props.options.find(option => String(option.value) === String(props.modelValue));

function choose(option) {
	emit("update:modelValue", option.value);
	open.value = false;
}
function onOutside(event) {
	if (open.value && !root.value?.contains(event.target)) open.value = false;
}
function onTriggerKey(event) {
	if (event.key === "ArrowDown" || event.key === "ArrowUp") {
		event.preventDefault();
		open.value = true;
		requestAnimationFrame(() =>
			root.value?.querySelector("[role=option]")?.focus(),
		);
	}
	if (event.key === "Escape") open.value = false;
}
function onOptionKey(event) {
	const options = [...root.value.querySelectorAll("[role=option]")];
	const index = options.indexOf(document.activeElement);
	if (event.key === "Escape") {
		event.preventDefault();
		open.value = false;
		trigger.value?.focus();
	} else if (["ArrowDown", "ArrowUp"].includes(event.key)) {
		event.preventDefault();
		const offset = event.key === "ArrowDown" ? 1 : -1;
		options[(index + offset + options.length) % options.length]?.focus();
	} else if (event.key === "Home") {
		event.preventDefault();
		options[0]?.focus();
	} else if (event.key === "End") {
		event.preventDefault();
		options.at(-1)?.focus();
	}
}
onMounted(() => document.addEventListener("pointerdown", onOutside));
onBeforeUnmount(() => document.removeEventListener("pointerdown", onOutside));
</script>

<template>
	<div ref="root" class="ph-custom-select">
		<button
			ref="trigger"
			type="button"
			class="ph-custom-select-trigger"
			:aria-label="ariaLabel"
			:aria-expanded="open"
			aria-haspopup="listbox"
			@click="open = !open"
			@keydown="onTriggerKey"
		>
			<span>{{ selected()?.label ?? modelValue }}</span>
			<svg v-if="showChevron" viewBox="0 0 16 16" aria-hidden="true">
				<path d="m3.5 6 4.5 4 4.5-4" />
			</svg>
		</button>
		<Transition name="ph-range-menu">
			<div
				v-if="open"
				class="ph-custom-select-menu"
				role="listbox"
				:aria-label="ariaLabel"
				@keydown="onOptionKey"
			>
				<button
					v-for="option in options"
					:key="option.value"
					type="button"
					role="option"
					:aria-selected="String(option.value) === String(modelValue)"
					:class="{
						'is-selected': String(option.value) === String(modelValue),
					}"
					@click="choose(option)"
				>
					<span>{{ option.label }}</span
					><i aria-hidden="true">✓</i>
				</button>
			</div>
		</Transition>
	</div>
</template>
