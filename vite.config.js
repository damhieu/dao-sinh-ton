import { defineConfig } from "vite";

export default defineConfig({
  // relative URLs so the build also works under a sub-path (GitHub Pages: /dao-sinh-ton/)
  base: "./",
  server: { host: "127.0.0.1", port: 5180, strictPort: true },
  build: { target: "es2022", chunkSizeWarningLimit: 2500 },
});
