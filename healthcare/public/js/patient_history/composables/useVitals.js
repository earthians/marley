import { computed, ref, watch } from "vue";
import { temperatureInCelsius, vitalTime } from "../utils/format";
export function useVitals(patient, api) {
	const data = ref([]),
		metric = ref("bp"),
		range = ref("6");
	const loading = ref(false),
		error = ref(null);
	let requestId = 0;
	async function load() {
		const value = patient.value;
		const id = ++requestId;
		data.value = [];
		error.value = null;
		loading.value = false;
		metric.value = "bp";
		range.value = "6";
		if (!value) return;
		loading.value = true;
		try {
			const vitals = await api.getVitals(value);
			if (id !== requestId) return;
			data.value = (vitals || [])
				.map(row => ({
					...row,
					bmi: Number(row.bmi) > 0 ? row.bmi : null,
					temperature: temperatureInCelsius(row.temperature),
				}))
				.sort((a, b) => vitalTime(a) - vitalTime(b));
		} catch (e) {
			if (id === requestId) error.value = e;
		} finally {
			if (id === requestId) loading.value = false;
		}
	}
	watch(patient, load, { immediate: true });
	const config = computed(
		() =>
			({
				bp: {
					title: __("Blood Pressure"),
					series: [
						{
							key: "bp_systolic",
							label: __("Systolic"),
							unit: "mmHg",
							color: "var(--ph-chart-systolic-from)",
							band: [80, 120],
						},
						{
							key: "bp_diastolic",
							label: __("Diastolic"),
							unit: "mmHg",
							color: "var(--ph-chart-diastolic)",
							band: [60, 80],
							dashed: true,
						},
					],
					range: [60, 160],
				},
				pulse_rate: {
					title: __("Pulse & Respiration"),
					series: [
						{
							key: "pulse",
							label: __("Pulse"),
							unit: __("bpm"),
							color: "var(--ph-chart-systolic-from)",
							band: [60, 100],
						},
						{
							key: "respiratory_rate",
							label: __("Respiratory rate"),
							unit: "/min",
							color: "var(--ph-chart-diastolic)",
							band: [12, 20],
							dashed: true,
						},
					],
					range: [40, 140],
				},
				temperature: {
					title: __("Temperature"),
					series: [
						{
							key: "temperature",
							label: __("Temperature"),
							unit: "°C",
							color: "var(--ph-chart-systolic-from)",
							band: [36.1, 37.2],
						},
					],
					range: [35, 40],
				},
				bmi: {
					title: __("BMI"),
					series: [
						{
							key: "bmi",
							label: "BMI",
							unit: "kg/m²",
							color: "var(--ph-chart-systolic-from)",
							band: [18.5, 24.9],
						},
					],
					range: [15, 40],
				},
			})[metric.value],
	);
	return { data, metric, range, loading, error, config, load };
}
