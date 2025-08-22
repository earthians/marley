<template>
	<div class="h-full w-full">
		<!-- Header -->
		<div class="flex justify-center gap-5 items-center mb-4">
			<button @click="prevMonth"
				class="text-gray-600 bg-blue-100 h-8 w-8 rounded-full hover:text-gray-800 flex items-center justify-center">
				&lt;
			</button>
			<div class="text-lg font-semibold">{{ monthYear }}</div>
			<button @click="nextMonth"
				class="text-gray-600 bg-blue-100 h-8 w-8 rounded-full hover:text-gray-800 flex items-center justify-center">
				&gt;
			</button>
		</div>

		<!-- Weekdays -->
		<div class="grid grid-cols-7 gap-0 text-center text-gray-600 text-sm mb-1 font-medium">
			<div v-for="w in ['Su','Mo','Tu','We','Th','Fr','Sa']" :key="w"
				:class="w==='Su'||w==='Sa' ? 'text-red-500' : ''">{{ w }}</div>
		</div>

		<!-- Days -->
		<div class="grid grid-cols-7 gap-0 text-center">
			<div v-for="blank in blanks" :key="'b-'+blank"></div>
			<div v-for="day in days" :key="day"
				:class="[
					'h-10 w-10 flex items-center justify-center transition-all rounded-full font-medium',
					isPast(day) ? 'text-gray-400 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-100',
					isToday(day) && activeDay!==day ? 'bg-blue-100 text-blue-700 font-semibold' : '',
					activeDay===day ? 'bg-black text-white shadow-md' : '',
				]"
				@click="!isPast(day) && selectDay(day)">
				{{ day }}
			</div>
		</div>
	</div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'

const currentMonth = ref(new Date().getMonth())
const currentYear = ref(new Date().getFullYear())
const today = ref(new Date())
const activeDay = ref(today.value.getDate())

const emit = defineEmits(["update:selectedDate"])

// Generate days in month
const days = computed(() => {
	const numDays = new Date(currentYear.value, currentMonth.value + 1, 0).getDate()
	return Array.from({ length: numDays }, (_, i) => i + 1)
})

// Blank spaces for first week alignment
const blanks = computed(() => {
	const startOfMonth = new Date(currentYear.value, currentMonth.value, 1)
	const startDay = startOfMonth.getDay()
	return startDay === 0 ? [] : Array(startDay).fill('')
})

const monthYear = computed(() => {
	return `${new Date(currentYear.value, currentMonth.value).toLocaleString('default',{ month: 'long' })} ${currentYear.value}`
})

const isToday = (day) => {
	const date = new Date(currentYear.value, currentMonth.value, day)
	return date.getDate() === today.value.getDate() &&
		date.getMonth() === today.value.getMonth() &&
		date.getFullYear() === today.value.getFullYear()
}

const isPast = (day) => {
	const date = new Date(currentYear.value, currentMonth.value, day)
	return date < today.value && !isToday(day)
}

function prevMonth() {
	activeDay.value = null
	emit("update:selectedDate", null)
	if (currentMonth.value === 0) {
		currentMonth.value = 11
		currentYear.value -= 1
	} else currentMonth.value--
}

function nextMonth() {
	activeDay.value = null
	emit("update:selectedDate", null)
	if (currentMonth.value === 11) {
		currentMonth.value = 0
		currentYear.value += 1
	} else currentMonth.value++
}

function selectDay(day) {
	activeDay.value = day
	emit("update:selectedDate", formatDate(day))
}

function formatDate(day) {
	const selectedDate = new Date(currentYear.value, currentMonth.value, day)
	const selected_year = selectedDate.getFullYear()
	const selected_month = String(selectedDate.getMonth() + 1).padStart(2, '0')
	const selected_day = String(selectedDate.getDate()).padStart(2, '0')
	return `${selected_year}-${selected_month}-${selected_day}`
}

// Select today on mount
onMounted(() => {
	selectDay(today.value.getDate())
})
</script>
