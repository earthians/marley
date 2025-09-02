<template>
	<Dialog v-if="show && !minimized" v-model="show" :options="{
		size: '6xl',
	}" :disable-outside-click-to-close="true">
		<template #body-title>
			<h3 class="text-ink-gray-8">Book an Appointment</h3>
		</template>
		<template #body-content>
			<div class="flex flex-col h-[65vh] border-b">
				<div class="m-4" v-if="!success">
					<Progress
						size="lg"
						:value="progressCount"
						:intervals="true"
						:interval-count="intervalCount"
					/>
				</div>

				<div class="flex-1 overflow-y-auto px-2 py-2 animate-fade-in">
					<!-- Department Selection -->
					<DepartmentSelector
						v-if="departments.length > 1 && !show_practitioners"
						:items="paginatedDepartments"
						:selected="selectedDepartment"
						:page="deptPage"
						:totalPages="totalDeptPages"
						@update:selected="selectedDepartment = $event"
						@update:page="deptPage = $event"
					/>

					<!-- Practitioner Selection -->
					<PractitionerSelector
						v-if="(show_practitioners || departments.length == 1) && !show_calendar && !booked"
						:items="paginatedPractitioners"
						:selected="selectedPractitioner"
						:page="practitionerPage"
						:totalPages="totalPractitionerPages"
						@update:selected="selectedPractitioner = $event"
						@update:page="practitionerPage = $event"
					/>

					<!-- Booking View -->
					<div
						v-if="show_calendar && !booked"
						class="grid gap-1 animate-fade-in h-[99%] grid-cols-1 md:grid-cols-3 lg:grid-cols-3 border border-gray-200 rounded-md"
					>
						<div class="flex flex-col items-center justify-center h-full min-h-[350px] border-r">
							<div class="w-28 h-28 mb-3">
								<img
									v-if="selectedPractitioner.image"
									:src="selectedPractitioner.image"
									class="w-full h-full rounded-full object-cover bg-gray-100"
								/>
								<div
									v-else
									class="w-full h-full rounded-full flex items-center justify-center text-gray-700 text-3xl font-semibold bg-gray-100"
									>
									{{ selectedPractitioner.practitioner_name.charAt(0).toUpperCase() }}
								</div>
							</div>
							<div class="font-semibold text-lg">{{ selectedPractitioner.practitioner_name }}</div>
							<div class="text-sm text-gray-500">{{ selectedPractitioner.department }}</div>
							<div class="text-sm text-gray-500">{{ selectedPractitioner.designation }}</div>

							<div class="flex items-center w-full py-5">
								<div class="flex-grow border-t border-gray-200"></div>
								<span class="mx-3 text-xs text-gray-400 uppercase tracking-wider">For Patient</span>
								<div class="flex-grow border-t border-gray-200"></div>
							</div>

							<div class="flex items-center justify-center w-full py-4">
								<FormControl
									v-model="selectedPatient"
									type="autocomplete"
									:options="patientOptions"
									:placeholder="'Choose a patient'"
									size="lg"
									:disabled="patientOptions.length == 1"
								/>
							</div>
						</div>

						<div class="py-2 flex items-center justify-center h-full min-h-[350px] border-r">
							<div class="flex items-center justify-center">
								<Calendar v-model:selectedDate="selectedDate" class="max-w-md scale-110" />
							</div>
						</div>

						<div class="flex flex-col items-center justify-center h-full min-h-[350px]">
							<div class="flex flex-col items-center justify-center w-full max-w-md">
								<div v-if="slots && slots.length > 0" class="flex flex-col items-center py-3 px-4">
									<h3 class="text-md font-semibold mb-3 text-center">Available Slots</h3>
									<div class="flex justify-center mb-2 w-full">
										<Select
											:options="timezones"
											v-model="selectedTimezone"
											class="border border-gray-300 rounded-md px-2 py-1 text-sm w-full max-w-xs"
										/>
									</div>
								</div>

								<div v-else class="flex items-center justify-center text-gray-500 text-sm h-24">
									No slots available
								</div>

								<!-- Scrollable slots list -->
								<div v-if="slots && slots.length > 0" class="overflow-y-auto max-h-80 px-4 py-2 w-full">
									<div v-for="(group, label) in groupedSlots" :key="label">
										<div v-if="group && group.length > 0" class="mb-4">
											<h4 class="text-sm font-medium text-gray-600 mb-2">{{ label }}</h4>
											<div class="grid grid-cols-4 sm:grid-cols-3 md:grid-cols-4 gap-2">
												<Button
													v-for="slot in group"
													:key="slot.slot"
													size="md"
													:label="slot.formattedTime"
													:class="[
														selectedSlot?.slot == slot.slot
														? 'bg-surface-gray-5 text-white'
														: 'bg-surface-white hover:bg-surface-gray-4 border shadow-sm',
														'rounded-lg shadow-sm'
													]"
													@click="selectedSlot = slot"
												/>
											</div>
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>
					<div v-if="(booked && !success) && !show_calendar" class="flex flex-col h-[99%] animate-fade-in items-center justify-center">
						<Payment
							v-model:practitioner="selectedPractitioner.practitioner_name"
							v-model:consultationFee="consultationFee"
							v-model:error="createRazorpayOrder.error"
							v-model:currency="currency"
							class="w-full h-full max-w-sm" 
							@payment_success="() => success = true"
						/>
					</div>
					<div v-if="success" class="flex flex-col items-center justify-center h-[99%] text-center space-y-4 animate-fade-in">
						<FeatherIcon name="check-circle" class="text-green-500 w-20 h-20" />
						<h2 class="text-xl font-semibold text-gray-800">Payment Successful</h2>
						<p class="text-gray-600">Your appointment with {{ selectedPractitioner.practitioner_name }} has been confirmed.</p>
					</div>
				</div>
				<div class="min-h-[10px]">
					<ErrorMessage v-if="error" :message="error" />
				</div>
			</div>
		</template>
		<template #actions>
			<div class="flex justify-center gap-2 ">
				<Button
					v-if="!success"
					:disabled="!(show_practitioners || show_calendar || booked)"
					size="md"
					variant="subtle"
					@click="goToPrevious()"
				>
					Previous
				</Button>
				<Button
					v-if="!show_calendar && !booked && !success"
					:disabled="!((selectedDepartment && !show_practitioners) || (selectedPractitioner && show_practitioners && !show_calendar && !booked))"
					size="md"
					variant="solid"
					@click="goToNext()"
				>
					Next
				</Button>
				<Button
					v-if="show_calendar && !booked && !success"
					:disabled="!(show_calendar && selectedSlot)"
					size="md"
					variant="solid"
					:loading="bookingLoading"
					@click="bookSlot()"
				>
					Book
				</Button>
				<Button
					v-if="booked && !success"
					size="md"
					variant="solid"
					:loading="createRazorpayOrder.loading"
					@click="createOrder"
				>
					Pay
				</Button>
				<Button
					v-if="success"
					size="md"
					variant="solid"
					@click="reload_appointments"
				>
					Close
				</Button>
			</div>
		</template>
	</Dialog>

	<Dialog 
		:options="{
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
		}"
		v-model="alert_dialog"
		@click="alert_dialog = false"
	/>
</template>

<script setup>
import {
	createResource,
	Button,
	Dialog,
	Progress,
	Select,
	FormControl,
	ErrorMessage
} from 'frappe-ui'
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import DepartmentSelector from '@/components/DepartmentSelector.vue'
import PractitionerSelector from '@/components/PractitionerSelector.vue'
import Calendar from '@/components/Calendar.vue'
import Payment from '@/components/Payment.vue'

const show = defineModel();
const selectedTimezone = ref(Intl.DateTimeFormat().resolvedOptions().timeZone)

let departments = ref([]);
let practitioners = ref([]);
let slots = ref([]);
const patientOptions = ref([])
const selectedPatient = ref(JSON.parse(localStorage.getItem("patient")) || {})
const selectedDepartment = ref(null);
const selectedPractitioner = ref(null);
const selectedDate = ref(null);
let selectedSlot = ref(null);
let practitioner = ref(null);
let appointment = ref(null);

let alert_dialog = ref(false);
let show_calendar = ref(false);
let show_practitioners = ref(false);
let booked = ref(false);
let success = ref(false);
const minimized = ref(false);
let bookingLoading = ref(false);

let dialog_title = ref("");
let dialog_message = ref("");
let error = ref("");

let currentStep = ref(1)
let intervalCount = ref(2);
const currency = ref("")

onMounted(() => {
	error.value = null;
	fetchDepartments.fetch();
	let get_patients = createResource({
		url: "/api/method/healthcare.healthcare.api.patient_portal.get_patients",
		method: "GET",
		onSuccess(response) {
			if (response && response.length > 0) {
				patientOptions.value = response;
				if (response.length == 1) {
					selectedPatient.value = response[0];
				}
			}
		},
	});

	get_patients.fetch();
});

const deptPage = ref(1);
const practitionerPage = ref(1);
const itemsPerPage = 8;
const consultationFee = ref(0)
const registrationFee = ref(0)

let healthcareSettings = ref({});
let getHealthcareSettings = createResource({
	url: "/api/method/healthcare.healthcare.api.patient_portal.get_settings",
	method: "GET",
	onSuccess(response) {
		if (response) {
			healthcareSettings.value = response
		}
	},
});
getHealthcareSettings.fetch();

let totalFee = computed(() => consultationFee.value + (registrationFee.value > 0 ? registrationFee.value : 0))

const razorpayCheckoutJS = ref(null);

const totalDeptPages = computed(() => Math.ceil(departments.value.length / itemsPerPage));
const totalPractitionerPages = computed(() => Math.ceil(practitioners.value.length / itemsPerPage));

const paginatedDepartments = computed(() => {
	const start = (deptPage.value - 1) * itemsPerPage
	return departments.value.slice(start, start + itemsPerPage)
});

const paginatedPractitioners = computed(() => {
	const start = (practitionerPage.value - 1) * itemsPerPage
	return practitioners.value.slice(start, start + itemsPerPage)
});

let fetchDepartments = createResource({
	url: "/api/method/healthcare.healthcare.api.patient_portal.get_departments",
	method: "GET",
	onSuccess(response) {
		if (response) {
			departments.value = response;
			if (response.length == 1) {
				selectedDepartment.value = response[0].department
				fetchPractitioners(selectedDepartment.value);
				show_practitioners.value = true;
			}
		}
	},
	onError(e) {
		error.value = e.messages?.[0] || e;
		// dialog_message = error.messages?.[0] || error;
		// dialog_title = "Failed to load Departments";
		// alert_dialog.value = true;
	}
});

watch([() => departments.value.length, () => healthcareSettings.value.collect_payment], ([deptLength, collectPayment]) => {
	if (deptLength > 1 && collectPayment) {
		intervalCount.value = 4
	} else if (deptLength > 1 && !collectPayment) {
		intervalCount.value = 3
	} else if (deptLength === 1 && collectPayment) {
		intervalCount.value = 3
	} else {
		intervalCount.value = 2
	}
})

const progressCount = computed(() => (currentStep.value / intervalCount.value) * 100)

function fetchPractitioners(deptName) {
	error.value = null;
	let get_practitioners = createResource({
		url: "/api/method/healthcare.healthcare.api.patient_portal.get_practitioners",
		method: "GET",
		makeParams() {
			return {
				department: deptName,
			};
		},
		onSuccess(response) {
			if (response) {
				practitioners.value = response;
			}
		},
		onError(e) {
			error.value = e.messages?.[0] || e;
			// dialog_message = error.messages?.[0] || error;
			// dialog_title = "Failed to load Practitioners";
			// alert_dialog.value = true;
		}
	});

	get_practitioners.fetch();
}

function fetchSlots(date) {
	error.value = null;
	let get_practitioners = createResource({
		url: "/api/method/healthcare.healthcare.api.patient_portal.get_slots",
		method: "GET",
		makeParams() {
			return {
				practitioner: selectedPractitioner.value?.name || null,
				date: date
			};
		},
		onSuccess(response) {
			if (response) {
				slots.value = response;
			}
		},
		onError(e) {
			error.value = e.messages?.[0] || e;
			// dialog_message = error.messages?.[0] || error;
			// dialog_title = "Failed to load Slotes";
			// alert_dialog.value = true;
		}
	});
	get_practitioners.fetch();
}

function get_fees(pract, date) {
	error.value = null;
	let get_fee_for_pract = createResource({
		url: "/api/method/healthcare.healthcare.api.patient_portal.get_fees",
		method: "GET",
		makeParams() {
			return {
				practitioner: pract || null,
				date: date
			};
		},
		onSuccess(response) {
			if (response) {
				currency.value = response.default_currency;
				consultationFee.value = response?.details?.practitioner_charge || 0;
				totalFee.value = consultationFee.value + (registrationFee.value > 0 ? registrationFee.value : 0);
			}
		},
		onError(e) {
			error.value = e.messages?.[0] || e;
		}
	});
	get_fee_for_pract.fetch();
}

async function bookSlot() {
	error.value = null;
	if (selectedSlot.value.slot) {
		const bookAppointment = createResource({
			url: "/api/method/healthcare.healthcare.api.patient_portal.make_appointment",
			method: "POST",
			makeParams() {
				return {
					practitioner: selectedPractitioner.value?.name,
					patient: selectedPatient.value?.value || null,
					date: selectedDate.value,
					slot: selectedSlot.value.slot,
				};
			},
			onSuccess(response) {
				if (response){
					appointment.value = response;
					if (show_calendar.value && !booked.value) {
						show_calendar.value = false
						booked.value = true
						currentStep.value = intervalCount.value
						if (!healthcareSettings.value.collect_payment) {
							success.value = true
						}
					}
				}
			},
			onError(e) {
				error.value = e.messages?.[0] || e;
			}
		});

		try {
			bookingLoading.value = true;
			await bookAppointment.submit();
		} finally {
			bookingLoading.value = false;
		}
	}
}

function goToNext() {
	error.value = null;
	if (selectedDepartment.value && !selectedPractitioner.value) {
		show_practitioners.value = true
		fetchPractitioners(selectedDepartment.value)
		currentStep.value = 2
	} else if (selectedPractitioner.value) {
		show_calendar.value = true
		currentStep.value = departments.value.length > 1 ? 3 : 2
	}
}

function goToPrevious() {
	error.value = null;
	if (show_practitioners.value && !show_calendar.value && !booked.value) {
		selectedDepartment.value = null
		selectedPractitioner.value = null
		show_practitioners.value = false
		currentStep.value = 1
		fetchDepartments.fetch()
	} else if (show_calendar.value && !booked.value) {
		show_calendar.value = false
		show_practitioners.value = true
		selectedDate.value = null
		slots.value = []
		currentStep.value = departments.value.length > 1 ? 2 : 1
	} else if (booked.value) {
		show_calendar.value = true
		booked.value = false
		currentStep.value = intervalCount.value - 1
	}
};

watch(selectedDate, async (date) => {
	selectedSlot.value = null;
	if (date) {
		await fetchSlots(date);
	} else {
		slots.value = [];
	}
	get_fees(selectedPractitioner.value?.name, date)
});

watch(selectedTimezone, async (timezone) => {
	selectedSlot.value = null;
	if (timezone && selectedDate.value) {
		await fetchSlots(selectedDate.value);
	} else {
		slots.value = [];
	}
});

// Group slots by time of day
const groupedSlots = computed(() => {
	let groups = { "Morning": [], "Afternoon": [], "Evening": [] }

	if (!slots.value || !selectedTimezone.value) {
		return groups;
	}

	slots.value.forEach(slot => {
		const [hour, minute] = slot.split(':').map(Number);
		const now = new Date();
		const serverTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);

		// Convert the server time to the user's selected timezone
		const userTime = new Date(serverTime.toLocaleString('en-US', { timeZone: selectedTimezone.value }));
		const userHour = userTime.getHours();
		const userminute = String(userTime.getMinutes()).padStart(2, '0');

		const formattedTime = `${userHour}:${userminute}`;
		const slotes_with_formatted = {"formattedTime": formattedTime, "slot": slot}
		// Push the original slot time to the appropriate group based on the converted time
		if (userHour < 12) groups.Morning.push(slotes_with_formatted);
		else if (userHour < 17) groups.Afternoon.push(slotes_with_formatted);
		else groups.Evening.push(slotes_with_formatted);
	});

	return groups;
});

const timezones = Intl.supportedValuesOf("timeZone")

const days = computed(() => {
	const startOfMonth = new Date(currentYear.value, currentMonth.value, 1)
	const endOfMonth = new Date(currentYear.value, currentMonth.value + 1, 0)
	const startDay = startOfMonth.getDay()
	const totalDays = endOfMonth.getDate()

	return [...Array(startDay).fill(''), ...Array.from({length: totalDays}, (_,i)=>i+1)]
})

const emit = defineEmits(['appointment_booked'])

function reload_appointments() {
	show.value = false;
	emit('appointment_booked')
}

onMounted(() => {
	razorpayCheckoutJS.value = document.createElement("script");
	razorpayCheckoutJS.value.setAttribute(
		"src",
		"https://checkout.razorpay.com/v1/checkout.js"
	);
	razorpayCheckoutJS.value.async = true;
	document.head.appendChild(razorpayCheckoutJS.value);
});

onBeforeUnmount(() => {
	razorpayCheckoutJS.value?.remove();
});

function createOrder() {
	createRazorpayOrder.submit({
		fee: totalFee.value,
		appointment: appointment.value
	});
}

const createRazorpayOrder = createResource({
	url: "/api/method/healthcare.healthcare.doctype.healthcare_settings.healthcare_settings.create_razorpay_order",
	params: {
		fee: totalFee.value,
		appointment: appointment.value
	},
	onSuccess: data => processOrder(data),
});

const handlePaymentFailed = createResource({
	url: "healthcare.healthcare.doctype.razorpay_payment_record.razorpay_payment_record.handle_razorpay_payment_failed",
	onSuccess: () => {
		console.log("Payment Failed.");
	}
});

const PaymentSuccess = createResource({
	url: "healthcare.healthcare.doctype.razorpay_payment_record.razorpay_payment_record.handle_razorpay_payment_success",
	onSuccess: () => {
		console.log("Payment Success.");
	}
});

function processOrder(data) {
	minimized.value = true;
	const options = {
		key: data.key_id,
		order_id: data.order_id,
		prefill: { email: data.user },
		handler: handlePaymentSuccess,
		theme: { color: '#171717' },
	};

	const rzp = new Razorpay(options);

	// Opens the payment checkout frame
	rzp.open();

	// Attach failure handler
	rzp.on("payment.failed", handlePaymentFailure);
}

function handlePaymentFailure(response) {
	handlePaymentFailed.submit({ response });
}

function handlePaymentSuccess(response) {
	if (response) {
		PaymentSuccess.submit({ response });
	}
	minimized.value = false;
	success.value = true;
	emit("payment_success");	
}
</script>
