<template>
	<div class="w-full h-full">
		<div>
			<Tabs as="div" v-model="portal_tabs" :tabs="[
				{
					label: 'Appointments',
				}
			]">
				<template #tab-panel="{ tab }">
					<div v-if="tab.label == 'Appointments'">
						<div class="flex justify-end m-2">
							<Button
								variant="solid"
								:label="'Book'"
								@click="make_appointment_dialog = true"
							>
								<template #prefix>
									<FeatherIcon name="plus" class="h-4" />
								</template>
							</Button>
						</div>
						<div class="space-y-2">
							<!-- Appointment Grid -->
							<div
								class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-2
										max-h-[75vh] overflow-y-auto
										lg:max-h-none lg:overflow-visible"
								>
								<Card
									v-for="item in paginatedAppointments" :key="item.name"
									class="cursor-pointer rounded-xl shadow-sm border border-gray-200
										hover:shadow-md hover:scale-105 transition-transform duration-200
										p-4 bg-white min-w-0"
									@click="appointmentDetails(item)">
									<div class="flex items-center justify-between whitespace-nowrap">
										<h3 class="text-xs font-medium text-gray-500 truncate">{{ item.name }}</h3>
										<Badge :variant="'outline'"
											:theme="['Confirmed', 'Closed', 'Checked In'].includes(item.status) ? 'green' : 'orange'">
											{{ item.status }}
										</Badge>
									</div>

									<p class="mt-2 text-md font-semibold text-gray-800 truncate">
										{{ item.title }}
									</p>

									<p class="mt-1 text-xs text-gray-600 whitespace-nowrap">
										<FeatherIcon name="calendar" class="inline w-3 h-3 mr-1 text-gray-500" />
										{{ formatDate(item.appointment_date) }}
									</p>
									<p class="mt-1 text-xs text-gray-600 whitespace-nowrap">
										<FeatherIcon name="clock" class="inline w-3 h-3 mr-1 text-gray-500" />
										{{ item.appointment_time }} ({{ item.duration }} mins)
									</p>
								</Card>
							</div>

							<!-- Pagination -->
							<div class="flex justify-center items-center space-x-2">
								<Button variant="subtle" :disabled="currentPage === 1" @click="currentPage--">
									Prev
								</Button>

								<span class="text-sm text-gray-600">
									Page {{ currentPage }} of {{ totalPages }}
								</span>

								<Button variant="subtle" :disabled="currentPage === totalPages" @click="currentPage++">
									Next
								</Button>
							</div>
						</div>
					</div>
				</template>
			</Tabs>
		</div>
	</div>

	<BookAppointmentModel
		v-if="make_appointment_dialog"
		v-model="make_appointment_dialog"
		@appointment_booked="get_appointments.reload()"
	/>

	<Dialog v-model="appointment_details" :options="{
		size: '4xl',
	}">
		<template #body-title>
			<div>
				<h2 class="text-xl font-semibold text-gray-900">Appointment Details</h2>
			</div>
			<div class="py-2 flex items-center justify-between gap-2">
				<p class="text-sm text-gray-500">#{{ selectedAppointment.name }}</p>
				<Badge :variant="'outline'" size="sm"
					:theme="['Confirmed', 'Closed', 'Checked In'].includes(selectedAppointment.status) ? 'green' : 'orange'">
					{{ selectedAppointment.status }}
				</Badge>
			</div>
		</template>
		<template #body-content>
			<div class="p-2">
				<div class="rounded-xl shadow-sm p-4 bg-gray-50 space-y-6">
					<div class="flex items-start gap-6">
						<img v-if="selectedAppointment.practitioner_image" :src="selectedAppointment.practitioner_image"
							class="w-20 h-20 rounded-full object-cover border" />
						<div v-else
							class="w-20 h-20 rounded-full object-cover border flex items-center justify-center text-gray-700 text-2xl font-semibold">
							{{ selectedAppointment.practitioner_name.charAt(0).toUpperCase() }}
						</div>

						<div class="grid grid-cols-2 gap-6 flex-1">
							<div>
								<h3 class="text-gray-700 font-medium">Practitioner</h3>
								<p class="mt-1 text-lg font-semibold text-gray-900">{{
									selectedAppointment.practitioner_name }}</p>
								<p class="mt-1 text-sm text-gray-600">{{ selectedAppointment.department }}</p>
								<div class="mt-4">
									<h3 class="text-gray-700 font-medium">When</h3>
									<p class="mt-1 text-lg font-semibold text-gray-900">
										{{ formatDate(selectedAppointment.appointment_date) }}
									</p>
									<p class="mt-1 text-sm text-gray-600">
										{{ selectedAppointment.appointment_time }} ({{ selectedAppointment.duration }} mins)
									</p>
								</div>
								<div class="mt-4" v-if="selectedAppointment.encounter">
									<h3 class="text-gray-700 font-medium">Encounter ID</h3>
									<p class="mt-1 text-lg font-semibold text-gray-900">{{ selectedAppointment.encounter
										}}</p>
								</div>
							</div>

							<div>
								<h3 class="text-gray-700 font-medium">Patient</h3>
								<p class="mt-1 text-lg font-semibold text-gray-900">
									{{ selectedAppointment.patient_name }}
								</p>
								<p class="mt-1 text-sm text-gray-600">{{ selectedAppointment.patient_email }}</p>
								<p class="mt-1 text-sm text-gray-600">Sex: {{ selectedAppointment.patient_sex }}</p>
								<div class="mt-4">
									<div class="flex items-center justify-between">
										<h3 class="text-gray-700 font-medium">Fee</h3>
										<Badge :variant="'outline'"
											:theme="selectedAppointment.invoiced == 1 ? 'green' : 'red'">
											{{ selectedAppointment.invoiced ? 'Paid' : 'Unpaid' }}
										</Badge>
									</div>
									<p class="mt-1 text-lg font-semibold text-gray-900">
										{{ formatCurrency(selectedAppointment.paid_amount, selectedAppointment.default_currency) }}
									</p>
									<p class="mt-1 text-sm text-gray-600">{{ selectedAppointment.billing_item }}</p>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</template>
		<template #actions>
			<div class="flex justify-center gap-2" v-if="selectedAppointment.encounter">
				<Button :ref_for="true" theme="gray" size="md" label="print_encounter"
					@click="print('Patient Encounter', selectedAppointment.encounter)">
					<Tooltip :text="'Print Prescription'" placement="top">
						<slot name="icon">
							<FeatherIcon :name="'printer'" class="size-4 text-ink-white-7" />
						</slot>
					</Tooltip>
				</Button>
			</div>
		</template>
	</Dialog>

	<Dialog :options="{
		title: dialog_title,
		message: dialog_message,
		size: 'xl',
		icon: {
			name: 'alert-triangle',
			appearance: 'warning',
		},
		actions: [
			{
				label: 'OK',
				variant: 'solid',
			},
		],
	}" v-model="alert_dialog" @click="alert_dialog = false" />
</template>

<script setup>
import { ref, computed } from 'vue'
import BookAppointmentModel from '@/components/BookAppointmentModel.vue'
import { formatCurrency } from "@/utils/formatters"

import {
	createResource,
	Button,
	Tabs,
	Dialog,
	Badge,
	Tooltip
} from 'frappe-ui'

let appointment_details = ref(false);
let make_appointment_dialog = ref(false);
let alert_dialog = ref(false);

let appointments = ref([]);

const portal_tabs = ref(0);
const currentPage = ref(1);
const pageSize = 16;

const selectedAppointment = ref("");
let dialog_title = ref("");
let dialog_message = ref("");

let get_appointments = createResource({
	url: "/api/method/healthcare.healthcare.api.patient_portal.get_appointments",
	method: "GET",
	onSuccess(response) {
		if (response) {
			appointments.value = response;
		}
	},
	onError(error) {
		dialog_message = error.messages?.[0] || error;
		dialog_title = "Failed to load appointments";
		alert_dialog.value = true;
	}
});
get_appointments.fetch();

let set_logged_in_patient = createResource({
	url: "/api/method/healthcare.healthcare.api.patient_portal.get_logged_in_patient",
	method: "GET",
	onSuccess(response) {
		if (response) {
			localStorage.setItem("patient", JSON.stringify(response));
		}
	},
	onError(error) {
		dialog_message = error.messages?.[0] || error;
		dialog_title = "Failed to load appointments";
		alert_dialog.value = true;
	}
});
set_logged_in_patient.fetch();

function appointmentDetails(appointment) {
	selectedAppointment.value = appointment;
	appointment_details.value = true;
}

function print(doctype, docname) {
	const w = window.open(
		"/api/method/healthcare.healthcare.api.patient_portal.secure_print_pdf"
		+ "?doctype=" + encodeURIComponent(doctype)
		+ "&name=" + docname
		+ "&no_letterhead=0"
	);

	if (!w) {
		alert_dialog.value = true;
		dialog_title = "Please enable pop-ups";
		dialog_message = "Please enable pop-ups of your browser to print boarding pass";
		return;
	}
}

function formatDate(dateStr) {
	return new Date(dateStr).toLocaleDateString("en-IN", {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric"
	});
}

// Pagination logic
const totalPages = computed(() =>
	Math.ceil(appointments.value.length / pageSize)
);

const paginatedAppointments = computed(() => {
	const start = (currentPage.value - 1) * pageSize;
	return appointments.value.slice(start, start + pageSize);
});
</script>
