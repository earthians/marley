<script setup>
import SeveralIcon from "~icons/lucide/copy";

defineProps({
	cases: { type: Array, default: () => [] },
});
</script>

<template>
	<SeveralIcon
		v-if="cases?.length"
		class="size-3.5 shrink-0 text-ink-amber-7"
		:title="__('{0} cases today. Also: {1}', [cases.length + 1, cases.join(', ')])"
	/>
</template>
