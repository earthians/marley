<script setup>
import { ref, watch } from "vue";
import RecordBody from "./RecordBody.vue";
const props = defineProps({
	record: { type: Object, required: true },
	initiallyExpanded: Boolean,
	api: { type: Object, required: true },
});
const expanded = ref(Boolean(props.initiallyExpanded));
const loading = ref(false),
	markup = ref(""),
	fetched = ref(false),
	loadError = ref("");

async function loadRecord() {
	if (fetched.value || loading.value) return;
	loading.value = true;
	loadError.value = "";
	try {
		const response = await props.api.renderDocAsHtml(
			props.record.reference_doctype,
			props.record.reference_name,
		);
		markup.value = response?.html || "";
	} catch {
		loadError.value = __("Could not load this record.");
	} finally {
		fetched.value = true;
		loading.value = false;
	}
}

watch(
	() => props.record.name,
	() => {
		expanded.value = Boolean(props.initiallyExpanded);
		loading.value = false;
		markup.value = "";
		fetched.value = false;
		loadError.value = "";
		if (expanded.value) loadRecord();
	},
	{ immediate: true },
);

async function toggle() {
	expanded.value = !expanded.value;
	if (expanded.value) await loadRecord();
}

async function retryLoad() {
	fetched.value = false;
	await loadRecord();
}
const initials = (
	props.record.practitioner_name ||
	props.record.owner ||
	__("Care team")
)
	.split(/\s+/)
	.slice(0, 2)
	.map(part => part[0])
	.join("")
	.toUpperCase();
const typeColors = {
	"Patient Encounter": "sky",
	"Vital Signs": "emerald",
	Observation: "amber",
	"Clinical Procedure": "indigo",
	"Lab Test": "teal",
	"Therapy Session": "violet",
	"Inpatient Medication Order": "rose",
	"Discharge Summary": "slate",
};
function typeColor(type) {
	return typeColors[type] || "slate";
}
function openDocument() {
	frappe.set_route(
		"Form",
		props.record.reference_doctype,
		props.record.reference_name,
	);
}
</script>
<template>
	<article class="ph-record" :class="typeColor(record.reference_doctype)">
		<div class="ph-record-node">{{ initials[0] || "•" }}</div>
		<div class="ph-record-card">
			<header class="ph-record-header">
				<span class="ph-type-tag">{{ record.reference_doctype }}</span
				><button class="ph-record-id" type="button" @click="openDocument">
					{{ record.reference_name }} ↗</button
				><time>{{
					moment(record.communication_date).format("DD MMM YYYY, hh:mm A")
				}}</time>
			</header>
			<div class="ph-practitioner">
				<span class="ph-practitioner-avatar">{{ initials }}</span
				><strong>{{
					record.practitioner_name || record.owner || __("Care team")
				}}</strong
				><span v-if="record.department" class="ph-department">{{
					record.department
				}}</span>
			</div>
			<div class="ph-record-summary">
				{{ record.summary || record.subject || __("Clinical record") }}
			</div>
			<Transition name="ph-record-details">
				<section
					v-if="expanded"
					class="ph-record-details"
					:aria-label="__('Record details')"
					aria-live="polite"
				>
					<header class="ph-record-details-heading">
						<span class="ph-record-details-icon" aria-hidden="true"
							><svg
								width="16"
								height="16"
								viewBox="0 0 20 20"
								fill="none"
							>
								<path
									d="M5.5 2.75h6l3.25 3.3v10.2H5.5z"
									stroke="currentColor"
									stroke-width="1.35"
									stroke-linejoin="round"
								/>
								<path
									d="M11.5 2.9v3.4h3M7.8 9.4h4.8M7.8 12h4.8M7.8 14.6h3.2"
									stroke="currentColor"
									stroke-width="1.25"
									stroke-linecap="round"
								/></svg
						></span>
						<div>
							<strong>{{ __("Record details") }}</strong
							><small
								>{{ record.reference_doctype }} ·
								{{ record.reference_name }}</small
							>
						</div>
					</header>
					<p v-if="loading" class="ph-record-details-message">
						{{ __("Loading record details…") }}
					</p>
					<div v-else-if="fetched && markup">
						<RecordBody :markup="markup" />
					</div>
					<div v-else-if="loadError" class="ph-record-details-error">
						<span>{{ loadError }}</span
						><button type="button" @click="retryLoad">
							{{ __("Try again") }}
						</button>
					</div>
					<p v-else-if="fetched" class="ph-record-details-message">
						{{ __("No additional details are available for this record.") }}
					</p>
				</section>
			</Transition>
			<footer class="ph-record-actions">
				<button
					type="button"
					class="ph-toggle-record"
					:class="{ 'is-expanded': expanded }"
					:aria-expanded="expanded"
					@click="toggle"
				>
					<span>{{ expanded ? __("Show less") : __("Show more") }}</span
					><svg
						class="ph-toggle-chevron"
						viewBox="0 0 20 20"
						aria-hidden="true"
					>
						<path
							d="m5 7.5 5 5 5-5"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg></button
				><button
					type="button"
					class="btn btn-default btn-xs ph-open-document"
					@click="openDocument"
				>
					{{ __("Open Document") }}
				</button>
			</footer>
		</div>
	</article>
</template>
