import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(dirname, "../../../..");
export default defineConfig({
  configFile: false,
  root: dirname,
  publicDir: false,
  plugins: [vue()],
  resolve: { alias: { "@": path.resolve(dirname, ".") } },
  build: {
    outDir: path.resolve(appRoot, "healthcare/public/patient_history"),
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: true,
    rollupOptions: {
      input: path.resolve(dirname, "main.js"),
      output: {
        format: "iife",
        name: "HealthcarePatientHistory",
        entryFileNames: "patient_history.js",
        assetFileNames: "patient_history.[ext]",
        inlineDynamicImports: true,
      },
    },
  },
});
