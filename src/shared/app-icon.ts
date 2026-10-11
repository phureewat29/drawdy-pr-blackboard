import { iconPaths } from "./icons.ts";

/**
 * PR Blackboard's icon: Lucide `presentation`, a board on a stand, in lime on
 * a dark rounded tile. The same artwork as assets/icon.png; Drawdy shows it
 * on the sidebar button and in the panel's title bar. The glyph spans 320
 * of the tile's 512, so its 2-unit stroke is 27 wide, about 1 px at 20 px.
 */
const ARTWORK = `<defs><linearGradient id="bb-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#232327"/><stop offset="1" stop-color="#151518"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="url(#bb-bg)"/><rect x="3" y="3" width="506" height="506" rx="109" fill="none" stroke="#33333a" stroke-width="6"/><g transform="translate(96 96) scale(13.333)" fill="none" stroke="#c5f601" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconPaths("presentation")}</g>`;

/** The icon as a standalone SVG, `size` pixels square. */
export const appIcon = (size: number): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}" aria-hidden="true">${ARTWORK}</svg>`;
