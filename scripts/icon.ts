/**
 * Wires in the extension's icon, made outside the repository: the 512 px
 * master becomes .github/assets/icon.png, the 256 px copy the marketplace
 * lists (Drawdy refuses one over 256 KB) .github/assets/icon-256.png, and
 * the 64 px copy goes into
 * src/shared/app-icon.ts as a PNG data URI, which Drawdy's 20 px action
 * button draws. Swapping the icon is this one command.
 *
 * Usage: node scripts/icon.ts <512px.png> <256px.png> <64px.png>
 */

import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

/** A PNG's bytes, checked to be a square PNG of a size `ok` takes. */
const pngOf = (path: string, ok: (size: number) => boolean, wanted: string): Buffer => {
    const png = readFileSync(path);
    const size = png.readUInt32BE(16);
    if (png.toString("latin1", 1, 4) !== "PNG" || png.readUInt32BE(20) !== size || !ok(size)) throw new Error(`${path} should be a ${wanted} PNG`);
    return png;
};

const [master, listing, button] = process.argv.slice(2);
if (!master || !listing || !button) {
    console.error("Usage: node scripts/icon.ts <512px.png> <256px.png> <64px.png>");
    process.exit(1);
}
pngOf(master, (size) => size === 512, "512 px square");
if (pngOf(listing, (size) => size === 256, "256 px square").length > 256 * 1024) throw new Error(`${listing} is over Drawdy's 256 KB limit`);
const small = pngOf(button, (size) => size === 64, "64 px square");
copyFileSync(master, join(ROOT, ".github/assets/icon.png"));
copyFileSync(listing, join(ROOT, ".github/assets/icon-256.png"));
writeFileSync(
    join(ROOT, "src/shared/app-icon.ts"),
    `/**
 * PR Blackboard's icon on Drawdy's action button: the 64 px copy of
 * .github/assets/icon.png in an SVG, \`size\` pixels square. Written by
 * \`npm run icon\`; don't edit.
 */
const ICON = "data:image/png;base64,${small.toString("base64")}";

export const appIcon = (size: number): string =>
    \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="\${size}" height="\${size}" aria-hidden="true"><image href="\${ICON}" width="64" height="64"/></svg>\`;
`
);
console.log(`wrote .github/assets/icon.png, .github/assets/icon-256.png and src/shared/app-icon.ts (the button's copy, ${(small.length / 1024).toFixed(1)} KB)`);
