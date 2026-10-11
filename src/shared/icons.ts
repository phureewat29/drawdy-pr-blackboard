/**
 * Every icon the panel and Read all draw, from Lucide 1.53.0 (lucide.dev,
 * ISC licence), inlined: each is its SVG's inner markup on Lucide's 24-unit
 * grid, drawn with a 2-unit stroke. The extension's own icon is a picture
 * (`app-icon.ts`).
 */
const LUCIDE = {
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    "chevron-left": '<path d="m15 18-6-6 6-6"/>',
    "chevron-right": '<path d="m9 18 6-6-6-6"/>',
    circle: '<circle cx="12" cy="12" r="10"/>',
    "loader-circle": '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
    "circle-check": '<circle cx="12" cy="12" r="10"/><path d="m16 9-5.5 5.5L8 12"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
} as const;

export type IconName = keyof typeof LUCIDE;

/** A Lucide icon as an inline SVG, `size` px square, stroked in `colour` (the text colour by default). */
export const icon = (name: IconName, size: number, colour = "currentColor"): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${colour}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${LUCIDE[name]}</svg>`;
