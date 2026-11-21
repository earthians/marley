import { computed, reactive } from "vue";

export function useFilters() {
    const filters = reactive({ doctypes: [], from: null, to: null, day: null });
    const dateRange = computed(() =>
        filters.from && filters.to ? [filters.from, filters.to] : "",
    );

    function clear() {
        Object.assign(filters, { doctypes: [], from: null, to: null, day: null });
    }

    function setDay(day) {
        filters.day = day;
        filters.from = day;
        filters.to = day;
    }
    return { filters, dateRange, clear, setDay };
}