<script setup>
import { computed, ref, watch } from "vue";
const props = defineProps({
	patientName: { type: String, default: "" },
	api: { type: Object, required: true },
});
const patient = ref(null),
	details = ref(null),
	expanded = ref(false);
let requestId = 0;
watch(
	() => props.patientName,
	async name => {
		const id = ++requestId;
		patient.value = null;
		details.value = null;
		if (!name) return;
		try {
			const [record, detail] = await Promise.all([
				props.api.getPatient(name),
				props.api.getPatientDetail(name),
			]);
			if (id === requestId) {
				patient.value = record;
				details.value = detail;
			}
		} catch {
			if (id === requestId) {
				patient.value = null;
				details.value = null;
			}
		}
	},
	{ immediate: true },
);
const fullName = computed(
	() => patient.value?.patient_name || patient.value?.name || "",
);
const initials = computed(
	() =>
		fullName.value
			.split(/\s+/)
			.slice(0, 2)
			.map(part => part[0])
			.join("")
			.toUpperCase() || "P",
);
const years = computed(() =>
	patient.value?.dob ? moment().diff(patient.value.dob, "years") : null,
);
const expandedFields = computed(() => [
	[__("Occupation"), details.value?.occupation],
	[__("Blood Group"), details.value?.blood_group || patient.value?.blood_group],
	[
		__("Primary Doctor"),
		patient.value?.primary_doctor || patient.value?.primary_practitioner,
	],
	[__("Contact"), patient.value?.mobile],
	[__("Surgical History"), details.value?.surgical_history],
]);
function items(value) {
	return String(value || "")
		.split(/[\n,;]/)
		.map(item => item.trim())
		.filter(Boolean);
}
function toggle() {
	expanded.value = !expanded.value;
}
</script>
<template>
	<section
		v-if="patient"
		class="ph-card ph-patient-card"
		:class="{ 'is-expanded': expanded }"
		aria-label="Patient summary"
	>
		<div
			class="ph-patient-identity"
			role="button"
			tabindex="0"
			:aria-expanded="expanded"
			:aria-controls="`ph-patient-expanded-${patient.name}`"
			:aria-label="
				expanded ? __('Collapse patient details') : __('Expand patient details')
			"
			@click="toggle"
			@keydown.enter.prevent="toggle"
			@keydown.space.prevent="toggle"
		>
			<div class="ph-patient-avatar" :class="{ 'has-image': patient.image }">
				<span class="ph-avatar-initials">{{ initials }}</span
				><img
					v-if="patient.image"
					:src="patient.image"
					:alt="fullName"
					@error="$event.target.remove()"
				/><i></i>
			</div>
			<div class="ph-identity-copy">
				<h2>
					{{ fullName }} <span class="ph-status">{{ __("Active") }}</span>
				</h2>
				<p>
					{{ patient.sex
					}}<template v-if="years !== null"
						>, {{ years }} {{ __("yrs") }}</template
					>
					· {{ __("Blood Group") }}: {{ patient.blood_group || "—"
					}}<template v-if="patient.creation">
						· {{ __("Registered") }}
						{{ moment(patient.creation).format("MMM YYYY") }}</template
					>
				</p>
			</div>
			<span
				class="ph-collapse-patient"
				:class="{ 'is-expanded': expanded }"
				aria-hidden="true"
				><svg class="ph-chevron" viewBox="0 0 20 20">
					<path
						d="m5 7.5 5 5 5-5"
						fill="none"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round"
					/></svg
			></span>
		</div>
		<Transition name="ph-patient-details">
			<div
				v-if="expanded"
				:id="`ph-patient-expanded-${patient.name}`"
				class="ph-patient-expanded"
			>
				<div class="ph-expanded-actions">
					<a
						href="#"
						@click.stop.prevent="
							frappe.set_route('Form', 'Patient', patient.name)
						"
						>{{ __("View full profile") }}</a
					>
				</div>
				<div class="ph-patient-details">
					<div v-for="field in expandedFields" :key="field[0]">
						<span>{{ field[0] }}</span
						><strong>{{
							String(field[1] || "—").replaceAll("\n", ", ")
						}}</strong>
					</div>
				</div>
				<div class="ph-patient-row-three">
					<div>
						<span class="ph-label">{{
							__("Clinical Alerts & Allergies")
						}}</span>
						<div class="ph-chips">
							<span
								v-for="(item, index) in items(details?.allergies)"
								:key="item"
								class="ph-chip"
								:class="index ? 'is-warning' : 'is-alert'"
								>{{ item }}</span
							><span v-if="!items(details?.allergies).length">—</span>
						</div>
					</div>
					<div>
						<span class="ph-label">{{ __("Current Medication") }}</span>
						<div class="ph-chips">
							<span
								v-for="item in items(details?.medication)"
								:key="item"
								class="ph-chip"
								>{{ item }}</span
							><span v-if="!items(details?.medication).length">—</span>
						</div>
					</div>
					<div>
						<span class="ph-label">{{
							__("Medical History & Lifestyle")
						}}</span>
						<div class="ph-chips">
							<span
								v-for="item in items(details?.medical_history)"
								:key="item"
								class="ph-chip"
								>{{ item }}</span
							><span class="ph-lifestyle">{{
								[
									details?.alcohol_past_use &&
										`${__("Alcohol")}: ${details.alcohol_past_use}`,
									details?.tobacco_current_use &&
										`${__("Tobacco")}: ${details.tobacco_current_use}`,
								]
									.filter(Boolean)
									.join(" · ") || "—"
							}}</span>
						</div>
					</div>
				</div>
			</div>
		</Transition>
	</section>
</template>
