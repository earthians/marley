import { computed, onBeforeUnmount, onMounted, ref } from "vue";
export function useBreakpoint() {
  const width = ref(12);
  function update() { width.value = window.matchMedia("(min-width: 1024px)").matches ? 12 : window.matchMedia("(min-width: 640px)").matches ? 6 : 3; }
  onMounted(() => { update(); window.addEventListener("resize", update); });
  onBeforeUnmount(() => window.removeEventListener("resize", update));
  return { monthWindow: computed(() => width.value) };
}
