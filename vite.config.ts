import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@proxyshard/shardx-ui-kit/icons": path.resolve(__dirname, "./ui-kit/dist/icons/index.js"),
      "@proxyshard/shardx-ui-kit/styles.css": path.resolve(__dirname, "./ui-kit/dist/styles.css"),
      "@proxyshard/shardx-ui-kit/tokens.css": path.resolve(__dirname, "./ui-kit/dist/tokens.css"),
      "@proxyshard/shardx-ui-kit": path.resolve(__dirname, "./ui-kit/dist/index.js"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    // Bind the literal IPv4 loopback (not `false`, which lets Node resolve
    // `localhost` to `::1` on Windows and listen IPv6-only — then Tauri's
    // health-check hangs forever at "Waiting for your frontend dev server to
    // start"). Must match devUrl in tauri.conf.json.
    host: host || "127.0.0.1",
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5000",
        changeOrigin: true,
        secure: false,
      },
    },
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
