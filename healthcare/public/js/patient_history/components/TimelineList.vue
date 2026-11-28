<script setup>
import TimelineRecord from "./TimelineRecord.vue";
const props = defineProps({
	groups: { type: Array, default: () => [] },
	page: Number,
	api: { type: Object, required: true },
});
</script>
<template>
	<div class="ph-feed">
		<div v-for="group in groups" :key="group.date">
			<div class="ph-date-marker">
				<i></i>
				<strong>
					{{ moment(group.date).format("DD MMM YYYY") }}
					<template v-if="moment(group.date).isSame(moment(), 'day')">
						· {{ __("Today") }}</template
					>
					<template
						v-else-if="
							moment(group.date).isSame(
								moment().subtract(1, 'day'),
								'day',
							)
						"
					>
						· {{ __("Yesterday") }}</template
					>
				</strong>
			</div>
			<TimelineRecord
				v-for="record in group.records"
				:key="record.name || record.reference_name"
				:record="record"
				:api="api"
			/>
		</div>
	</div>
</template>
