import { computed, onBeforeUnmount, ref, watch } from "vue";

export function useFeed(patient, filters, dateRange, api) {
    const records = ref([]),
        total = ref(0),
        page = ref(1),
        pageSize = ref(20);
    const loading = ref(false),
        error = ref(null);
    let feedRequest = 0,
        countRequest = 0,
        feedTimer,
        countTimer;
    const totalPages = computed(() => Math.ceil(total.value / pageSize.value));
    const args = () => ({
        name: patient.value,
        document_types: filters.doctypes,
        date_range: dateRange.value,
    });
    async function loadFeed() {
        if (!patient.value) {
            records.value = [];
            return;
        }
        const id = ++feedRequest;
        loading.value = true;
        error.value = null;
        try {
            const result = await api.getFeed({
                ...args(),
                start: (page.value - 1) * pageSize.value,
                page_length: pageSize.value,
            });
            if (id === feedRequest) records.value = result || [];
        } catch (e) {
            if (id === feedRequest) {
                error.value = e;
                records.value = [];
            }
        } finally {
            if (id === feedRequest) loading.value = false;
        }
    }
    async function loadCount() {
        if (!patient.value) {
            total.value = 0;
            return;
        }
        const id = ++countRequest;
        try {
            const result = await api.getFeedCount(args());
            if (id === countRequest) total.value = Number(result || 0);
        } catch (e) {
            if (id === countRequest) error.value = e;
        }
    }

    function invalidate() {
        feedRequest++;
        countRequest++;
    }
    onBeforeUnmount(() => {
        clearTimeout(feedTimer);
        clearTimeout(countTimer);
        invalidate();
    });
    watch(
        [patient, () => JSON.stringify(filters), page, pageSize],
        (values, previous) => {
            clearTimeout(feedTimer);
            if (!previous || values[0] !== previous[0]) loadFeed();
            else {
                feedRequest++;
                feedTimer = setTimeout(loadFeed, 140);
            }
        }, { immediate: true },
    );
    watch(
        [patient, () => JSON.stringify(filters)],
        (values, previous) => {
            clearTimeout(countTimer);
            if (!previous || values[0] !== previous[0]) loadCount();
            else {
                countRequest++;
                countTimer = setTimeout(loadCount, 140);
            }
        }, { immediate: true },
    );
    watch([() => JSON.stringify(filters), pageSize], () => {
        if (page.value !== 1) page.value = 1;
    });
    return {
        records,
        total,
        page,
        pageSize,
        totalPages,
        loading,
        error,
        loadFeed,
        invalidate,
    };
}