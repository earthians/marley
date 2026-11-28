<script setup>
import { computed } from "vue";
import { sanitize } from "../utils/sanitize";
const props = defineProps({ markup: { type: String, default: "" } });
const safeMarkup = computed(() => sanitize(props.markup));
</script>
<template><div class="document-html" v-html="safeMarkup"></div></template>
