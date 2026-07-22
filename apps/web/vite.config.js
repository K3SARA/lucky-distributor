import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: false, // We already have manifest.webmanifest in public
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg}"],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true
  }
});
