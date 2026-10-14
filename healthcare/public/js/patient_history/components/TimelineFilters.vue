<script setup>
import { onMounted, ref } from "vue";
import MultiSelect from "./MultiSelect.vue";
import DateRangePicker from "./DateRangePicker.vue";
const props = defineProps({
	filters: { type: Object, required: true },
	api: { type: Object, required: true },
});
const emit = defineEmits(["clear"]);
const options = ref([]),
	loadError = ref(false);
async function loadOptions() {
	loadError.value = false;
	try {
		options.value = (await props.api.getDoctypes()) || [];
	} catch {
		loadError.value = true;
	}
}
onMounted(loadOptions);
function doctypeChanged(types) {
	if (props.filters.day) {
		props.filters.day = null;
		props.filters.from = null;
		props.filters.to = null;
	}
}
function clearDay() {
	if (
		props.filters.day &&
		(props.filters.from !== props.filters.day ||
			props.filters.to !== props.filters.day)
	)
		props.filters.day = null;
}
function clearAll() {
	emit("clear");
}
</script>
<template>
	<div class="ph-filters ph-filter-toolbar">
		<div class="ph-filter-field">
			<label>{{ __("Document Type") }}</label
			><MultiSelect
				v-model="filters.doctypes"
				:options="options"
				:error="loadError"
				@update:model-value="doctypeChanged"
				@retry="loadOptions"
			/>
		</div>
		<div class="ph-filter-field">
			<label for="ph-date-range">{{ __("Date Range") }}</label>
			<DateRangePicker
				input-id="ph-date-range"
				v-model:from="filters.from"
				v-model:to="filters.to"
				@change="clearDay"
			/>
		</div>
		<button
			type="button"
			class="ph-clear-filters"
			:disabled="
				!filters.doctypes.length && !filters.from && !filters.to && !filters.day
			"
			@click="clearAll"
		>
			{{ __("Clear") }}
		</button>
	</div>
	<div v-if="filters.day" class="ph-active-filters">
		<span class="ph-selected-date-chip"
			>{{ __("Showing records for") }}
			{{ moment(filters.day).format("DD MMM YYYY") }}
			<button
				type="button"
				:aria-label="__('Clear selected date')"
				@click="
					filters.day = null;
					filters.from = null;
					filters.to = null;
				"
			>
				×
			</button></span
		>
	</div>
</template>
