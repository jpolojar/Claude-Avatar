// Development entry point (npm run dev): the API on AVATAR_PORT, Vite serves the pages.
import { startServer } from "./app.js";
import { config } from "./config.js";

await startServer({ port: config.port });
