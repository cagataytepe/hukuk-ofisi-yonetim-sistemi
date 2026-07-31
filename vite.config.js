import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    allowedHosts: [".vercel.run", ".v0.dev", ".vusercontent.net", "localhost", "127.0.0.1"],
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
