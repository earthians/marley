<script setup>
import { computed, inject, reactive, ref, toRef, watch } from "vue";
import { useFilters } from "./composables/useFilters";
import { useFeed } from "./composables/useFeed";
import { useActivity } from "./composables/useActivity";
import { useVitals } from "./composables/useVitals";
import PatientSummary from "./components/PatientSummary.vue";
import ActivityCalendar from "./components/ActivityCalendar.vue";
import TimelineFilters from "./components/TimelineFilters.vue";
import TimelineList from "./components/TimelineList.vue";
import Pagination from "./components/Pagination.vue";
import VitalTrends from "./components/VitalTrends.vue";
const context = inject("patientHistory");
const api = context.api;
const patientName = toRef(context, "patient");
const { filters, dateRange, clear, setDay } = useFilters();
const feed = useFeed(patientName, filters, dateRange, api);
const activity = useActivity(patientName, api);
const vitals = reactive(useVitals(patientName, api));
const insightsExpanded = ref(false);
const title = computed(() => __("Patient History"));
const grouped = computed(() => {
	const groups = [];
	for (const record of feed.records.value) {
		const date = moment(record.communication_date).format("YYYY-MM-DD");
		let group = groups.at(-1);
		if (!group || group.date !== date) groups.push((group = { date, records: [] }));
		group.records.push(record);
	}
	return groups;
});
watch(patientName, () => {
	clear();
	feed.page.value = 1;
	feed.pageSize.value = 20;
	activity.selectedDay.value = null;
	activity.activityFilter.value = "all";
});
function selectDay(day, doctype) {
	if (day === filters.day && !doctype) {
		filters.day = null;
		filters.from = null;
		filters.to = null;
		return;
	}
	const summary = activity.days.value.find(row => row.date === day);
	if (!summary?.total) {
		setDay(day);
		feed.invalidate();
		feed.records.value = [];
		feed.total.value = 0;
		return;
	}
	setDay(day);
	if (doctype) filters.doctypes = [doctype];
}
function clearFilters() {
	clear();
}
function changeActivityYear(value) {
	activity.year.value = value;
	clear();
}
</script>
<template>
	<main class="ph-page">
		<header class="ph-page-header">
			<div>
				<div class="ph-breadcrumb">
					{{ __("Healthcare") }} <span>/</span> <strong>{{ title }}</strong>
				</div>
				<div class="ph-title-line">
					<h1>{{ title }}</h1>
					<code class="ph-title-id">{{ patientName }}</code>
				</div>
			</div>
		</header>
		<PatientSummary :patient-name="patientName" :api="api" />
		<template v-if="patientName">
			<section class="ph-insights-group">
				<button
					type="button"
					class="ph-insights-toggle"
					:aria-expanded="insightsExpanded"
					aria-controls="ph-insights-content"
					@click="insightsExpanded = !insightsExpanded"
				>
					<span>{{ __("Clinical Activity & Vital Trends") }}</span>
					<svg
						:class="{ 'is-collapsed': !insightsExpanded }"
						viewBox="0 0 20 20"
						aria-hidden="true"
					>
						<path d="m5 7.5 5 5 5-5" />
					</svg>
				</button>
				<Transition name="ph-insights">
					<div
						v-show="insightsExpanded"
						id="ph-insights-content"
						class="ph-insights-content"
					>
						<ActivityCalendar
							:years="activity.years.value"
							:year="activity.year.value"
							:filter="activity.activityFilter.value"
							:days="activity.days.value"
							:selected="filters.day"
							:loading="activity.loading.value"
							@update:year="changeActivityYear"
							@update:filter="activity.activityFilter.value = $event"
							@select-day="selectDay"
						/>
						<VitalTrends :state="vitals" />
					</div>
				</Transition>
			</section>
			<section class="ph-card ph-timeline-card">
				<TimelineFilters :filters="filters" :api="api" @clear="clearFilters" />
				<div class="patient_documents_list" :aria-busy="feed.loading.value">
					<div
						v-if="feed.loading.value && !feed.records.value.length"
						class="ph-feed-skeleton"
						aria-label="Loading records"
					>
						<i></i><i></i><i></i>
					</div>
					<div v-else-if="feed.error.value" class="ph-empty-feed">
						<p>{{ __("Could not load patient records") }}</p>
						<button type="button" @click="feed.loadFeed">
							{{ __("Retry") }}
						</button>
					</div>
					<div v-else-if="!feed.records.value.length" class="ph-empty-feed">
						<p>
							{{
								filters.day
									? __("No records on {0}", [
											moment(filters.day).format(
												"dddd, DD MMM YYYY",
											),
										])
									: __("No records for this filter")
							}}
						</p>
						<button
							type="button"
							class="btn btn-default btn-sm"
							@click="clearFilters"
						>
							{{ __("Clear") }}
						</button>
					</div>
					<TimelineList
						v-else
						:groups="grouped"
						:page="feed.page.value"
						:api="api"
					/>
				</div>
				<Pagination
					v-model:page="feed.page.value"
					v-model:page-size="feed.pageSize.value"
					:total="feed.total.value"
				/></section
		></template>
		<div v-else class="ph-card ph-empty-feed">
			{{ __("Select a patient to view history") }}
		</div>
	</main>
</template>
