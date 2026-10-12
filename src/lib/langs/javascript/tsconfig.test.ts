import { describe, expect, it } from "@jest/globals";
import { tsconfigs } from "./tsconfig.ts";

describe("tsconfigs", () => {
    it("gives a file the `paths` of the nearest config above it, joined to its `baseUrl`, and the typings a config names one by one", async () => {
        const repo: Record<string, string> = {
            "tsconfig.json": '{ "compilerOptions": { "baseUrl": ".", "paths": { "@lib/*": ["lib/*"] } }, "files": ["types/env.d.ts"], "include": ["src/**/*", "types/global.d.ts"] }',
        };
        const asked: string[] = [];
        const configs = tsconfigs(async (path) => {
            asked.push(path);
            return repo[path] ?? null;
        });
        await configs.mappingsFor("src");
        const paths = await configs.settle();
        expect(paths("src/app.ts")).toEqual([{ pattern: "@lib/*", targets: ["lib/*"] }]);
        expect(asked).toEqual(["src/tsconfig.json", "src/jsconfig.json", "tsconfig.json"]);
        expect([...configs.typings].sort()).toEqual(["types/env.d.ts", "types/global.d.ts"]);
    });
});
