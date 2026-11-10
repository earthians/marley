<script setup>
// A mark on a case whose patient has other cases that day, in any theatre: they are allowed,
// but the team should know the patient goes to theatre more than once. An icon, so a narrow
// card keeps its patient's name; the hover preview lists the other cases.
import SeveralIcon from "~icons/lucide/copy";

defineProps({
	cases: { type: Array, default: () => [] },
});
</script>

<template>
	<SeveralIcon
		v-if="cases?.length"
		class="size-3.5 shrink-0 text-ink-amber-7"
		:title="`${cases.length + 1} cases today. Also: ${cases.join(', ')}`"
	/>
</template>
