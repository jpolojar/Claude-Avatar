import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

const webRoot = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig(({ mode }) => {
  // Read the API port from the project's .env (server-side only; nothing here reaches the browser).
  const env = loadEnv(mode, projectRoot, "AVATAR_");
  const apiPort = env.AVATAR_PORT || "3001";

  return {
    root: webRoot,
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": { target: `http://127.0.0.1:${apiPort}` },
      },
    },
    build: {
      outDir: "../dist/web",
      emptyOutDir: true,
    },
  };
});
