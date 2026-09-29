import preact from "@preact/preset-vite";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";
import { workboxOptions } from "./pwa.config.ts";

export default defineConfig({
  base: process.env.VITE_BASE ?? "./",
  // Only the e2e build points this elsewhere (synthetic data, see scripts/build-e2e.mjs).
  publicDir: process.env.GV_PUBLIC_DIR ?? "public",
  plugins: [
    preact(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: false,
      workbox: workboxOptions,
      // The service worker exists only in built output (vite preview and production).
      devOptions: { enabled: false },
    }),
  ],
  build: { target: "safari16" },
  test: { include: ["test/**/*.test.ts"] },
});
