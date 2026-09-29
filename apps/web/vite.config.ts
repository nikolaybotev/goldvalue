import preact from "@preact/preset-vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: process.env.VITE_BASE ?? "./",
  plugins: [preact()],
  build: { target: "safari16" },
  test: { include: ["test/**/*.test.ts"] },
});
