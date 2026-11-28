<script setup>
import { computed } from "vue";
const props = defineProps({ page: Number, pageSize: Number, total: Number });
const emit = defineEmits(["update:page", "update:pageSize"]);
const pages = computed(() => Math.ceil(props.total / props.pageSize));
const numbers = computed(() =>
	[
		...new Set(
			[1, props.page - 1, props.page, props.page + 1, pages.value].filter(
				value => value > 0 && value <= pages.value,
			),
		),
	].sort((a, b) => a - b),
);
</script>
<template>
	<div v-if="total" class="ph-pagination">
		<label
			>{{ __("Page size:") }}
			<select
				:value="pageSize"
				@change="emit('update:pageSize', Number($event.target.value))"
			>
				<option :value="20">20</option>
				<option :value="50">50</option>
				<option :value="100">100</option>
			</select></label
		>
		<div class="ph-page-buttons">
			<button
				type="button"
				:disabled="page <= 1"
				@click="emit('update:page', page - 1)"
			>
				{{ __("Previous") }}</button
			><template v-for="(value, index) in numbers" :key="value"
				><span v-if="index && value - numbers[index - 1] > 1">…</span
				><button
					type="button"
					:class="{ 'is-active': page === value }"
					:aria-current="page === value ? 'page' : undefined"
					@click="emit('update:page', value)"
				>
					{{ value }}
				</button></template
			><button
				type="button"
				:disabled="page >= pages"
				@click="emit('update:page', page + 1)"
			>
				{{ __("Next") }}
			</button>
		</div>
		<div class="ph-pagination-count">
			{{
				__("Showing {0}–{1} of {2} records", [
					total ? (page - 1) * pageSize + 1 : 0,
					Math.min(page * pageSize, total),
					total,
				])
			}}
		</div>
	</div>
</template>
