<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps({
	modelValue: { type: Array, default: () => [] },
	options: { type: Array, default: () => [] },
	error: Boolean,
});
const emit = defineEmits(["update:modelValue", "retry"]);
const search = ref("");
const open = ref(false);
const root = ref(null);
const visibleOptions = computed(() => {
	const query = search.value.trim().toLocaleLowerCase();
	return props.options.filter(item => item.toLocaleLowerCase().includes(query));
});

function onOutsideClick(event) {
	if (open.value && !root.value?.contains(event.target)) open.value = false;
}
onMounted(() => document.addEventListener("pointerdown", onOutsideClick));
onBeforeUnmount(() => document.removeEventListener("pointerdown", onOutsideClick));

function toggle(type) {
	const selected = new Set(props.modelValue);
	selected.has(type) ? selected.delete(type) : selected.add(type);
	emit("update:modelValue", [...selected].sort());
}
function navigateOptions(event) {
	if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
	const fields = [...event.currentTarget.querySelectorAll("input[type=checkbox]")];
	if (!fields.length) return;
	event.preventDefault();
	const index = fields.indexOf(document.activeElement);
	fields[
		(index + (event.key === "ArrowDown" ? 1 : fields.length - 1)) % fields.length
	]?.focus();
}
function onKey(event) {
	if (event.key === "Escape") open.value = false;
	else if (event.key === "ArrowDown") {
		event.preventDefault();
		root.value?.querySelector(".ph-multiselect-menu input[type=search]")?.focus();
	}
}
</script>

<template>
	<div ref="root" class="ph-multiselect">
		<button
			type="button"
			class="ph-multiselect-field"
			role="combobox"
			:aria-expanded="open"
			aria-haspopup="listbox"
			:aria-label="__('Filter by document type')"
			@click="open = !open"
			@keydown="onKey"
		>
			<span class="ph-multiselect-value">
				<template v-if="modelValue.length">
					<span
						v-for="type in modelValue.slice(0, 2)"
						:key="type"
						class="ph-type-chip"
					>
						{{ type }}
						<span
							role="button"
							tabindex="0"
							:aria-label="__('Remove {0}', [type])"
							@click.stop="toggle(type)"
							@keydown.enter.stop="toggle(type)"
							>×</span
						>
					</span>
					<span v-if="modelValue.length > 2" class="ph-type-more"
						>+{{ modelValue.length - 2 }} {{ __("more") }}</span
					>
				</template>
				<span v-else class="ph-multiselect-placeholder">{{
					__("Select Document Type")
				}}</span>
			</span>
			<span
				class="ph-multiselect-chevron"
				:class="{ 'is-open': open }"
				aria-hidden="true"
				>⌄</span
			>
		</button>

		<Transition name="ph-menu">
			<div
				v-if="open"
				class="ph-multiselect-menu"
				role="listbox"
				aria-multiselectable="true"
				@keydown="navigateOptions"
			>
				<p v-if="error" class="ph-multiselect-error">
					{{ __("Could not load document types") }}
					<button type="button" @click.stop="emit('retry')">
						{{ __("Retry") }}
					</button>
				</p>
				<label class="ph-multiselect-search">
					<span aria-hidden="true">⌕</span>
					<input
						v-model="search"
						type="search"
						:placeholder="__('Search document types')"
						@keydown.esc="open = false"
					/>
				</label>
				<div class="ph-multiselect-options">
					<label
						v-for="type in visibleOptions"
						:key="type"
						class="ph-multiselect-option"
						role="option"
						:aria-selected="modelValue.includes(type)"
					>
						<input
							type="checkbox"
							:checked="modelValue.includes(type)"
							@change="toggle(type)"
						/>
						<span>{{ type }}</span>
						<i aria-hidden="true">✓</i>
					</label>
					<p
						v-if="!visibleOptions.length && !error"
						class="ph-multiselect-empty"
					>
						{{ __("No document types found") }}
					</p>
				</div>
			</div>
		</Transition>
	</div>
</template>
