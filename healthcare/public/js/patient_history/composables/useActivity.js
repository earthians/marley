import { computed, ref, watch } from "vue";

export function useActivity(patient, api) {
  const year = ref(new Date().getFullYear()), years = ref([]), activityFilter = ref("all");
  const days = ref([]), selectedDay = ref(null), loading = ref(false), error = ref(null);
  let requestId = 0;
  const filterTypes = computed(() => ({ all: [], encounters: ["Patient Encounter"], vitals: ["Vital Signs"], labs: ["Lab Test", "Observation"] })[activityFilter.value]);
  async function loadYears() {
    const id = ++requestId;
    try {
      years.value = (await api.getActivityYears(patient.value) || []).map(Number);
      if (id !== requestId) return;
      year.value = years.value[0] || new Date().getFullYear();
    } catch (e) { if (id === requestId) error.value = e; }
  }
  async function load() {
    if (!patient.value) { days.value = []; return; }
    const id = ++requestId; loading.value = true; error.value = null;
    try {
      const rows = await api.getActivitySummary({ patient: patient.value, from_date: `${year.value}-01-01`, to_date: `${year.value}-12-31`, document_types: filterTypes.value });
      if (id === requestId) days.value = rows || [];
    } catch (e) { if (id === requestId) { error.value = e; days.value = []; } }
    finally { if (id === requestId) loading.value = false; }
  }
  watch(patient, async value => { requestId++; days.value = []; selectedDay.value = null; years.value = []; if (value) { await loadYears(); await load(); } }, { immediate: true });
  watch([year, activityFilter], load);
  return { year, years, activityFilter, filterTypes, days, selectedDay, loading, error, load };
}
