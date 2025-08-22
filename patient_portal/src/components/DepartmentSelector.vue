<template>
	<div class="flex flex-col h-[99%] animate-fade-in">
		<div class="flex items-center justify-between py-4">
			<h2 class="text-md font-semibold">Select a Department</h2>

			<!-- Pagination -->
			<div class="flex items-center gap-2">
				<Button size="sm" :disabled="page === 1" @click="$emit('update:page', page - 1)">
					<FeatherIcon name="chevron-left" class="size-5 text-ink-white-7" />
				</Button>
				<span class="text-sm text-gray-600">Page {{ page }} of {{ totalPages }}</span>
				<Button size="sm" :disabled="page === totalPages" @click="$emit('update:page', page + 1)">
					<FeatherIcon name="chevron-right" class="size-5 text-ink-white-7" />
				</Button>
			</div>
		</div>

		<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
			<Card v-for="dept in items" :key="dept.name"
				class="relative cursor-pointer rounded-xl border transition-transform duration-150 !p-3 bg-white
					!shadow-none drop-shadow-lg hover:drop-shadow-md"
				:class="selected === dept.department
					? '!border-gray-500 border-2'
					: 'border-gray-200 hover:scale-105'" @click="$emit('update:selected', dept.department)"
			>
				<div v-if="selected === dept.department"
					class="absolute top-2 right-2 bg-green-500 text-white rounded-full p-1 shadow-md z-20">
					<FeatherIcon name="check" class="w-4 h-4" />
				</div>
				<img v-if="dept.portal_image" :src="dept.portal_image"
					class="w-full h-32 object-cover rounded-t-xl bg-gray-100" />
				<div v-else
					class="w-full h-32 flex items-center justify-center rounded-t-xl text-gray-700 text-3xl font-semibold bg-gray-100">
					{{ dept.department.charAt(0).toUpperCase() }}
				</div>
				<div
					class="py-2 text-center font-medium text-base md:text-sm lg:text-base whitespace-nowrap overflow-hidden text-ellipsis">
					{{ dept.department }}
				</div>
			</Card>
		</div>
	</div>
</template>

<script setup>
import { Card, Button } from "frappe-ui";

defineProps({
	items: Array,
	selected: String,
	page: Number,
	totalPages: Number
});
</script>
