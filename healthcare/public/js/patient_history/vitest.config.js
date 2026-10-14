import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: { environment: "jsdom", include: ["healthcare/public/js/patient_history/**/*.spec.js"] },
});
