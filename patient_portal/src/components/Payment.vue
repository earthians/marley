<template>
	<div class="h-full flex flex-col justify-center items-center px-2">
		<!-- Header -->
		<div class="text-center space-y-1">
			<h2 class="text-2xl font-bold text-gray-900">Pay Your Bill</h2>
			<p class="py-4 text-sm text-gray-500">Details of fees</p>
		</div>

		<!-- Fees Cards -->
		<div class="py-2 space-y-4 w-full max-w-md">
			<!-- Consultation Fee -->
			<Card class="p-5 rounded-xl shadow-sm">
				<div class="flex justify-between items-center">
					<div>
						<h3 class="text-base font-semibold text-gray-800">Consultation Fee</h3>
						<p class="py-2 text-sm text-gray-500">Consultation with {{ practitioner }}</p>
					</div>
					<div class="text-lg font-bold text-green-600">
						{{ formatCurrency(consultationFee, currency) }}
					</div>
				</div>
			</Card>

			<!-- Registration Fee -->
			<Card v-if="registrationFee > 0" class="p-5 rounded-xl shadow-sm">
				<div class="flex justify-between items-center">
					<div>
						<h3 class="text-base font-semibold text-gray-800">Registration Fee</h3>
						<p class="text-sm text-gray-500">One-time registration for new patients</p>
					</div>
					<div class="text-lg font-bold text-blue-600">
						{{ formatCurrency(registrationFee, currency) }}
					</div>
				</div>
			</Card>

			<!-- Divider + Total -->
			<div class="border-t py-4 flex justify-between items-center">
				<span class="text-lg font-semibold text-gray-800">Total</span>
				<span class="text-xl font-bold text-gray-900">
					{{ formatCurrency(totalAmount, currency) }}
				</span>
			</div>

			<!-- Error Message -->
			<ErrorMessage v-if="error" class="mt-2" :message="error" />
		</div>
	</div>
</template>

<script setup>
import { computed } from 'vue'
import { Card, ErrorMessage } from 'frappe-ui'
import { formatCurrency } from "@/utils/formatters"

const practitioner = defineModel('practitioner')
const consultationFee = defineModel('consultationFee')
const registrationFee = defineModel('registrationFee')
const error = defineModel('error')
const currency = defineModel('currency')

const totalAmount = computed(() => {
	return (consultationFee.value || 0) + (registrationFee.value || 0)
})
</script>
