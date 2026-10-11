import { execFile } from "node:child_process";
import { defineConfig, type Plugin } from "vite";
import { drawdyExtension } from "./vite-plugin-drawdy";

/**
 * Runs `npm run worker` whenever a source changes, so the extension the dev
 * server builds never carries a parser worker older than its sources. The
 * script writes src/worker/script.ts only when it changed, and that write is
 * what rebuilds the extension with it.
 */
const parserWorker = (): Plugin => ({
    name: "parser-worker",
    configureServer(server) {
        let running = false;
        let again = false;
        const run = () => {
            if (running) return void (again = true);
            running = true;
            execFile(process.execPath, ["scripts/worker.ts"], { cwd: server.config.root }, (err, _out, stderr) => {
                running = false;
                if (err) server.config.logger.error(`[parser-worker] npm run worker failed: ${stderr || err.message}`);
                if (again) (again = false), run();
            });
        };
        server.watcher.on("all", (_event, file) => {
            if (file.includes("/src/") && !file.endsWith("/src/worker/script.ts")) run();
        });
    },
});

export default defineConfig({
    appType: "custom",
    server: {
        port: 5173,
        strictPort: true,
    },
    plugins: [drawdyExtension(), parserWorker()],
});
