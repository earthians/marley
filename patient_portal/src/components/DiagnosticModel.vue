<template>
	<div class="py-4 relative min-h-[80vh] flex flex-col">
		<div
			v-if="paginatedOrders.length"
			class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-2 overflow-y-auto"
		>
			<Card
				v-for="item in paginatedOrders"
				:key="item.order_name"
				class="cursor-pointer rounded-xl border border-gray-200 transition-transform
					hover:scale-105 duration-200 hover:drop-shadow-md p-2 bg-white
					min-w-0 !shadow-none drop-shadow-xl h-auto"
				@click="orderDetails(item)"
			>
				<div class="flex items-center justify-between whitespace-nowrap">
					<h3 class="text-xs font-medium text-gray-500 truncate"># {{ item.order_name }}</h3>
					<Badge v-if="item.diagnostic_report_status" :variant="'outline'"
						:theme="item.diagnostic_report_status == 'Approved' ? 'green' : 'orange'">
						{{ item.diagnostic_report_status }}
					</Badge>
				</div>

				<p class="mt-2 text-md text-gray-800 truncate">
					Tests: {{ item.tests.length }}
				</p>

				<p v-if="item.ref_practitioner" class="mt-1 text-xs text-gray-600 whitespace-nowrap truncate">
					Practitioner: {{ item.ref_practitioner }}
				</p>
				<p v-if="item.diagnostic_report" class="mt-1 text-xs text-gray-600 whitespace-nowrap truncate">
					# {{ item.diagnostic_report }}
				</p>

				<p class="mt-1 text-xs text-gray-600 whitespace-nowrap">
					<FeatherIcon name="calendar" class="inline w-3 h-3 mr-1 text-gray-500" />
					{{ formatDate(item.order_date) }}
				</p>
			</Card>
		</div>

		<div
			v-else
			class="flex flex-col items-center justify-center flex-grow text-center p-6"
		>
			<FeatherIcon name="file-text" class="w-12 h-12 text-gray-400 mb-3" />
			<h2 class="text-lg font-semibold text-gray-700">No Records Found</h2>
			<p class="text-sm text-gray-500">Looks like you don’t have any orders yet.</p>
		</div>

		<div v-if="paginatedOrders.length" class="flex justify-center items-center space-x-2 mt-auto pt-2">
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

	<Dialog v-model="orders_details" :options="{
		size: '6xl',
	}">
		<template #body-title>
			<div>
				<h2 class="text-xl font-semibold text-gray-900">Test Details</h2>
			</div>
			<div class="py-2 flex items-center justify-between gap-2">
				<p class="text-sm text-gray-500"># {{ selectedOrder.order_name }}</p>
				<Badge v-if="selectedOrder.diagnostic_report_status" :variant="'outline'"
					:theme="selectedOrder.diagnostic_report_status == 'Approved' ? 'green' : 'orange'">
					{{ selectedOrder.diagnostic_report_status }}
				</Badge>
			</div>
		</template>
		<template #body-content>
			<div class="p-4 bg-white rounded-xl shadow-md border space-y-4">
				<div class="flex items-center gap-4">
					<!-- Patient Photo -->
					<img v-if="selectedOrder.patient_image" 
						:src="selectedOrder.patient_image"
						class="w-16 h-16 rounded-full object-cover border" />
					<div v-else
						class="w-16 h-16 rounded-full flex items-center justify-center bg-gray-100 text-gray-600 font-bold text-xl">
						{{ selectedOrder.patient_name?.charAt(0)?.toUpperCase() }}
					</div>

					<!-- Patient Info -->
					<div class="flex-1">
						<h2 class="text-lg font-semibold text-gray-900">{{ selectedOrder.patient_name }}</h2>
						<p class="text-sm text-gray-600">Ordered by: {{ selectedOrder.ref_practitioner }}</p>
					</div>

					<!-- Order Status -->
					<Button v-if="selectedOrder.invoice" :ref_for="true" theme="gray" size="sm"
						@click="print('Sales Invoice', selectedOrder.invoice)">
						<Tooltip :text="'Print Invoice'" placement="top">
							<slot name="icon">
								<FeatherIcon :name="'printer'" class="size-3 text-ink-white-7" />
							</slot>
						</Tooltip>
					</Button>
				</div>

				<div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-600 mt-4">
					<p><span class="font-medium text-gray-700">Order #:</span>
						{{ selectedOrder.order_name }}
						<Badge :variant="'outline'" size="sm" :theme="getStatusColor(selectedOrder.billing_status)">
							{{ selectedOrder.billing_status }}
						</Badge>
					</p>
					<p><span class="font-medium text-gray-700">Collection Point:</span> {{ selectedOrder.collection_point || '-' }}</p>
					<p v-if="selectedOrder.order_date">
						<span class="font-medium text-gray-700">Order Date:</span> {{ formatDate(selectedOrder.order_date) }}
					</p>
				</div>
			</div>

			<!-- Test Report Section -->
			<div class="mt-6">
				<div class="flex items-center justify-between gap-2 py-2">
					<h3 class="text-lg font-semibold text-gray-900">Test Report Details</h3>
					<Button v-if="selectedOrder.diagnostic_report_status && selectedOrder.diagnostic_report_status != 'Open'" :ref_for="true" theme="gray" size="sm"
						@click="print('Diagnostic Report', selectedOrder.diagnostic_report)">
						<Tooltip :text="'Print Report'" placement="top">
							<slot name="icon">
								<FeatherIcon :name="'printer'" class="size-3 text-ink-white-7" />
							</slot>
						</Tooltip>
					</Button>
				</div>
				<div class="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
					<div v-for="(order, index) in selectedOrder.tests" :key="index"
						class="bg-white rounded-xl shadow-md border overflow-hidden">

						<!-- Test Header -->
						 <div v-if="!order.children || order.children.length == 0" class="px-4 py-3 bg-gray-50">
							<div class="flex items-center gap-2">
								<p class="font-medium text-gray-800 py-2">{{ order.observation_template }}</p>
								<Badge v-if="order.observation_status" :variant="'outline'" size="sm"
									:theme="getStatusColor(order.observation_status)">
									{{ order.observation_status || "Pending" }}
								</Badge>
							</div>
							<div class="divide-y divide-gray-200 border border-gray-200 rounded-lg">
								<div class="grid grid-cols-3 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700">
									<div>Test</div>
									<div>Result</div>
									<div>Reference</div>
								</div>

								<div class="grid grid-cols-3 px-3 py-2 text-sm">
									<div>
										<p class="font-medium text-gray-800">{{ order.observation_template }}</p>
										<p v-if="order.collection_date_time">
											<span class="text-gray-700 text-xs">Collected On:</span> {{ formatDateTime(order.collection_date_time) }}
										</p>
									</div>
									<div class="font-semibold flex items-center">
										<div v-if="order.result" class="font-semibold">
											{{ order.result || '-' }} {{ order.uom }}
										</div>
									</div>
									<div v-html="order.reference" class="text-gray-600 flex items-center"></div>
								</div>
							</div>
						</div>
						<div v-if="order.children && order.children.length > 0" class="px-4 py-3 bg-gray-50">
							<div class="flex items-center gap-2">
								<p class="font-medium text-gray-800 py-2">{{ order.observation_template }}</p>
								<Badge v-if="order.observation_status" :variant="'outline'" size="sm"
									:theme="getStatusColor(order.observation_status)">
									{{ order.observation_status || "Pending" }}
								</Badge>
							</div>
							<div class="divide-y divide-gray-200 border border-gray-200 rounded-lg">
								<div class="grid grid-cols-3 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700">
									<div>Test</div>
									<div>Result</div>
									<div>Reference</div>
								</div>

								<div v-for="(comp, i) in order.children" :key="i"
									class="grid grid-cols-3 px-3 py-2 text-sm">
									<div>
										<div class="flex items-center gap-2">
											<p class="font-medium text-gray-800">{{ comp.observation_template }}</p>
											<Badge v-if="comp.observation_status" :variant="'outline'" size="sm"
												:theme="getStatusColor(comp.observation_status)">
												{{ comp.observation_status || "Pending" }}
											</Badge>
										</div>
										<p v-if="comp.collection_date_time">
											<span class="text-gray-700 text-xs">Collected On:</span> {{ formatDateTime(comp.collection_date_time) }}
										</p>
									</div>
									<div class="font-semibold flex items-center">
										<div v-if="comp.result" class="font-semibold">
											{{ comp.result || '-' }} {{ comp.uom }}
										</div>
									</div>
									<div v-html="comp.reference" class="text-gray-600 flex items-center"></div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</template>
	</Dialog>
</template>

<script setup>
import { ref, computed } from 'vue';

import {
	createResource,
	Card,
	Button,
	Badge,
	Dialog
} from 'frappe-ui'

let orders_details = ref(false);

let orders = ref([]);

const currentPage = ref(1);
const pageSize = 16;

const selectedOrder = ref("");

let get_appointments = createResource({
	url: "/api/method/healthcare.healthcare.api.patient_portal.get_orders",
	method: "GET",
	onSuccess(response) {
		if (response) {
			orders.value = response;
		}
	}
});
get_appointments.fetch();

function orderDetails(order) {
	selectedOrder.value = order;
	orders_details.value = true;
}

function formatDate(dateStr) {
	return new Date(dateStr).toLocaleDateString("en-IN", {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric"
	});
}

function formatDateTime(dateStr) {
	return new Date(dateStr).toLocaleString("en-IN", {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false
	});
}

// Pagination logic
const totalPages = computed(() =>
	Math.ceil(orders.value.length / pageSize)
);

const paginatedOrders = computed(() => {
	const start = (currentPage.value - 1) * pageSize;
	return orders.value.slice(start, start + pageSize);
});

function print(doctype, docname) {
	let get_print_format = createResource({
		url: "/api/method/healthcare.healthcare.api.patient_portal.get_print_format",
		method: "POST",
		makeParams() {
			return {
				doctype: doctype,
				name: Array.isArray(docname)
					? docname[0]
					: docname
			}
		},
		onSuccess(response) {
			if (response) {
				const with_letterhead = response.letter_head ? 1 : 0;
				const print_format = response.print_format;
				const doc_names = Array.isArray(docname)
					? JSON.stringify(docname)
					: JSON.stringify([docname]);
				const letterhead = response.letter_head;

				let pdf_options = JSON.stringify({
					"page-size": "A4",
					"margin-top": doctype == "Diagnostic Report" ? "30mm" : "50mm",
					"margin-bottom": doctype == "Diagnostic Report" ? "30mm" : "50mm",
					"margin-left": doctype=="Diagnostic Report" ? "1mm" : "5mm",
					"margin-right": doctype=="Diagnostic Report" ? "1mm" : "5mm",
				});

				const w = window.open(
					"/api/method/frappe.utils.print_format.download_multi_pdf?" +
						"doctype=" +
						encodeURIComponent(doctype) +
						"&name=" +
						encodeURIComponent(doc_names) +
						"&format=" +
						encodeURIComponent(print_format) +
						"&no_letterhead=" +
						(with_letterhead ? "0" : "1") +
						"&letterhead=" +
						encodeURIComponent(letterhead) +
						"&options=" +
						encodeURIComponent(pdf_options)
				);

				if (!w) {
					alert("Please enable pop-ups");
					return;
				}
			}
		}
	});
	get_print_format.fetch();
}

const getStatusColor = (status) => {
	switch (status) {
		case "Collected":
		case "Completed":
		case "Paid":
		case "Approved":
			return "green"
		case "Pending":
		case "In Progress":
		case "Open":
		case "Partly Paid":
		case "Not Approved":
			return "orange"
		case "Rejected":
		case "Cancelled":
		case "Unpaid":
			return "red"
		default:
			return "gray"
	}
}
</script>
