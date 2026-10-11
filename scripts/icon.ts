/**
 * Renders assets/icon.png (the marketplace listing icon) from the same SVG
 * artwork the extension draws on its button, with `rsvg-convert` from librsvg.
 *
 * Usage: node scripts/icon.ts
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appIcon } from "../src/shared/app-icon.ts";

const ROOT = join(import.meta.dirname, "..");
const svg = join(mkdtempSync(join(tmpdir(), "pr-blackboard-icon-")), "icon.svg");
writeFileSync(svg, appIcon(512));
execFileSync("rsvg-convert", ["-w", "256", "-h", "256", "-o", join(ROOT, "assets/icon.png"), svg]);
console.log("wrote assets/icon.png");
