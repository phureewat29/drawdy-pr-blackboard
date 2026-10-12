/** Boxes and points in canvas units. */

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type TextSpot = { x: number; y: number; text: string; fontSize: number; width: number; height: number };

export const right = (r: Rect): number => r.x + r.width;
export const bottom = (r: Rect): number => r.y + r.height;
export const topMiddle = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y });
export const bottomMiddle = (r: Rect): Point => ({ x: r.x + r.width / 2, y: bottom(r) });

export const overlaps = (a: Rect, b: Rect): boolean => a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);

export const union = (rects: readonly Rect[]): Rect => {
    const x = Math.min(...rects.map((r) => r.x));
    const y = Math.min(...rects.map((r) => r.y));
    return {
        x,
        y,
        width: Math.max(...rects.map(right)) - x,
        height: Math.max(...rects.map(bottom)) - y,
    };
};

export const textRect = (t: TextSpot): Rect => ({ x: t.x, y: t.y, width: t.width, height: t.height });

/** Every placed box but those of `ids`. */
export const othersThan = (placed: ReadonlyMap<string, Rect>, ...ids: string[]): Rect[] => [...placed].filter(([id]) => !ids.includes(id)).map(([, r]) => r);

/** The box a polyline spans. */
export const pathRect = (path: readonly Point[]): Rect => union(path.map((p) => ({ x: p.x, y: p.y, width: 0, height: 0 })));
