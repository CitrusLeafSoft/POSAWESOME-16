import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// Frappe serves the built bundle from /assets/posawesome/posawesome/ and the HTML
// entry from /posawesome (see posawesome/www/posawesome.html).
export default defineConfig({
	plugins: [
		vue(),
		tailwindcss(),
		VitePWA({
			registerType: "prompt",
			injectRegister: null,
			manifest: {
				name: "POS Awesome",
				short_name: "POS Awesome",
				description: "A modern point of sale for ERPNext",
				start_url: "/posawesome",
				scope: "/posawesome",
				display: "standalone",
				orientation: "any",
				background_color: "#0b1220",
				theme_color: "#0b1220",
				icons: [
					{ src: "/assets/posawesome/posawesome/icon-192.png", sizes: "192x192", type: "image/png" },
					{
						src: "/assets/posawesome/posawesome/icon-512.png",
						sizes: "512x512",
						type: "image/png",
						purpose: "any maskable",
					},
				],
			},
			workbox: {
				globPatterns: ["**/*.{js,css,woff2}"],
				// The shell is cached; every /api call falls through to the network and is
				// handled by our own offline queue instead of by workbox.
				navigateFallback: null,
				navigateFallbackDenylist: [/^\/api/, /^\/app/, /^\/assets/],
				runtimeCaching: [
					{
						urlPattern: /\/files\/.*\.(?:png|jpg|jpeg|svg|gif|webp|avif)$/,
						handler: "CacheFirst",
						options: {
							cacheName: "posa-item-images",
							expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 30 },
						},
					},
				],
			},
		}),
	],
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	server: {
		port: 8080,
		host: "0.0.0.0",
		proxy: {
			"^/(api|app|assets|files|private)": {
				target: "http://127.0.0.1:8000",
				changeOrigin: true,
			},
		},
	},
	build: {
		outDir: "../posawesome/public/posawesome",
		emptyOutDir: true,
		target: "es2022",
		chunkSizeWarningLimit: 900,
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (!id.includes("node_modules")) return;
					if (id.includes("/vue/") || id.includes("@vue/") || id.includes("vue-router") || id.includes("/pinia/"))
						return "vendor-vue";
					if (id.includes("motion")) return "vendor-motion";
					if (id.includes("lucide")) return "vendor-icons";
					if (id.includes("dexie")) return "vendor-db";
				},
			},
		},
	},
});
