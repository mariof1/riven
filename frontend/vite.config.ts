import tailwindcss from "@tailwindcss/vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

export default defineConfig({
    plugins: [tailwindcss(), sveltekit()],
    define: {
        __APP_VERSION__: JSON.stringify(pkg.version)
    },
    build: {
        rollupOptions: {
            onwarn(warning, warn) {
                const message = typeof warning === "string" ? warning : warning.message;
                const id = typeof warning === "object" && warning ? (warning as any).id : undefined;

                // Known noisy third-party warning from svelte-tel-input's published bundle.
                if (
                    typeof id === "string" &&
                    id.includes("svelte-tel-input") &&
                    typeof message === "string" &&
                    (message.includes("Can't resolve original location") ||
                        message.includes("annotation that Rollup cannot interpret"))
                ) {
                    return;
                }

                // Noise from @vinejs/vine bundling in browser context.
                if (typeof message === "string" && message.includes('Module "node:dns/promises"')) {
                    return;
                }

                warn(warning);
            }
        }
    }
});
