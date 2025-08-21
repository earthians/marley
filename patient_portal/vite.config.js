import path from 'path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import frappeui from 'frappe-ui/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    frappeui({
      frappeProxy: true,
      lucideIcons: true,
      jinjaBootData: true,
      buildConfig: {
        indexHtmlPath: '../healthcare/www/patient_portal.html',
        emptyOutDir: true,
        sourcemap: true,
      },
    }),
    vue(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // interactjs: 'interactjs/dist/interact.min.js',
    },
  },
  build: {
    manifest: true,
    outDir: path.resolve(__dirname, "../healthcare/public/patient_portal/assets"),
		emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "src/patient_portal.js"),
    },
		target: "es2015",
		sourcemap: true,
  },
  optimizeDeps: {
    include: [
      'frappe-ui > feather-icons',
      "tailwind.config.js",
      'engine.io-client',
      // 'highlight.js',
      // 'lowlight',
      // 'interactjs'
    ],
  },
  server: {
    sourcemapIgnoreList: () => false,
  },
  // define: {
  //   __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  // },
  // worker: {
	// 	format: "es",
	// },
  base: "/assets/healthcare/patient_portal/assets/"
})