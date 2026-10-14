import { computed, ref, watch } from "vue";
export function useVitals(patient, api) {
    const data = ref([]),
        metric = ref("bp"),
        range = ref("all");
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
        range.value = "all";
        if (!value) return;
        loading.value = true;
        try {
            const vitals = await api.getVitals(value);
            if (id !== requestId) return;
            data.value = (vitals || [])
                .slice()
                .sort(
                    (a, b) =>
                    new Date(`${a.signs_date} ${a.signs_time || "00:00"}`) -
                    new Date(`${b.signs_date} ${b.signs_time || "00:00"}`),
                );
            const latest = data.value.at(-1);
            if (
                latest &&
                Date.now() - new Date(latest.signs_date).getTime() > 183 * 86400000
            )
                range.value = "all";
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
                series: [{
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
                series: [{
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
                series: [{
                    key: "temperature",
                    label: __("Temperature"),
                    unit: "°C",
                    color: "var(--ph-chart-systolic-from)",
                    band: [36.1, 37.2],
                }, ],
                range: [35, 40],
            },
            bmi: {
                title: __("BMI"),
                series: [{
                    key: "bmi",
                    label: "BMI",
                    unit: "kg/m²",
                    color: "var(--ph-chart-systolic-from)",
                    band: [18.5, 24.9],
                }, ],
                range: [15, 40],
            },
        })[metric.value],
    );
    return { data, metric, range, loading, error, config, load };
}