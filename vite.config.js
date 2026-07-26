import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    allowedHosts: true,
    watch: {
      ignored: [
        "**/node_modules/**",
        "**/dist/**",
        "**/test-artifacts/**",
        "**/playwright-report/**"
      ]
    }
  }
});
