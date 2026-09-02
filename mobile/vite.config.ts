import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** The phone app. Built into mobile/dist, which the sync server serves. */
export default defineConfig({
  root: "mobile",
  // Absolute, because the service worker and manifest both reference "/".
  base: "/",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 1421,
    strictPort: true,
    // Reachable from a phone on the same network during development.
    host: true,
  },
});
