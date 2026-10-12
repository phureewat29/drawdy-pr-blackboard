/**
 * Wires in the extension's icon, made outside the repository: the listing
 * icon becomes assets/icon.png, with a copy in .github/assets beside the
 * README's other images, and its 64 px copy goes into
 * src/shared/app-icon.ts as a PNG data URI, which Drawdy's 20 px action
 * button draws. Swapping the icon is this one command.
 *
 * Usage: node scripts/icon.ts <listing.png> <64px.png>
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

const [listing, button] = process.argv.slice(2);
if (!listing || !button) {
    console.error("Usage: node scripts/icon.ts <listing.png> <64px.png>");
    process.exit(1);
}
pngOf(listing, (size) => size >= 256, "square, 256 px or more,");
const small = pngOf(button, (size) => size === 64, "64 px square");
copyFileSync(listing, join(ROOT, "assets/icon.png"));
copyFileSync(listing, join(ROOT, ".github/assets/icon.png"));
writeFileSync(
    join(ROOT, "src/shared/app-icon.ts"),
    `/**
 * PR Blackboard's icon on Drawdy's action button: the 64 px copy of
 * assets/icon.png in an SVG, \`size\` pixels square. Written by
 * \`npm run icon\`; don't edit.
 */
const ICON = "data:image/png;base64,${small.toString("base64")}";

export const appIcon = (size: number): string =>
    \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="\${size}" height="\${size}" aria-hidden="true"><image href="\${ICON}" width="64" height="64"/></svg>\`;
`
);
console.log(`wrote assets/icon.png, .github/assets/icon.png and src/shared/app-icon.ts (the button's copy, ${(small.length / 1024).toFixed(1)} KB)`);
