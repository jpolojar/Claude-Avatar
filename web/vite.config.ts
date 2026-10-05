import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";

const webRoot = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * Serves the voice activity detector's model, audio worklet and ONNX runtime
 * straight from node_modules at /vad-assets/. They cannot live in public/:
 * onnxruntime loads its .mjs with a dynamic import, which Vite tags with
 * "?import" and refuses to serve from the public directory.
 */
function vadAssets(): Plugin {
  const files: Record<string, string> = {
    "vad.worklet.bundle.min.js": "node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js",
    "silero_vad_v5.onnx": "node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx",
    "ort-wasm-simd-threaded.mjs": "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs",
    "ort-wasm-simd-threaded.wasm": "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
  };
  const types: Record<string, string> = {
    js: "text/javascript",
    mjs: "text/javascript",
    wasm: "application/wasm",
    onnx: "application/octet-stream",
  };
  return {
    name: "vad-assets",
    configureServer(server) {
      // Registered before Vite's own middlewares, so "?import" never reaches them.
      server.middlewares.use("/vad-assets", (req, res, next) => {
        const name = (req.url ?? "").split("?")[0]!.replace(/^\/+/, "");
        const file = files[name];
        if (!file) return next();
        res.setHeader("Content-Type", types[name.split(".").at(-1)!] ?? "application/octet-stream");
        createReadStream(`${projectRoot}/${file}`).on("error", next).pipe(res);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Read the API port from the project's .env (server-side only; nothing here reaches the browser).
  const env = loadEnv(mode, projectRoot, "AVATAR_");
  const apiPort = env.AVATAR_PORT || "3001";

  return {
    root: webRoot,
    plugins: [vadAssets()],
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
      rollupOptions: {
        input: {
          main: `${webRoot}/index.html`,
          widget: `${webRoot}/widget.html`,
          settings: `${webRoot}/settings.html`,
        },
      },
    },
  };
});
