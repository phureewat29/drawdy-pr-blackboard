import type { DriverCommandIssuer, ModuleStyling } from "@drawdy/driver-protocol";
import type { Ddp } from "../driver/ddp.ts";
import { catmullRomSpline } from "../lib/curve.ts";
import { pathRect, type Rect } from "../lib/layout.ts";

type Stored = { schema: any; rect: Rect };

/** Handlers for a kv-storage that keeps what it is given, Blobs included, as Drawdy's IndexedDB does. */
export const keptStorage = (kept = new Map<string, unknown>()): Record<string, (req: any) => unknown> => ({
    "command:kv-storage:get": (req) => (kept.has(req.key) ? { got: kept.get(req.key) } : {}),
    "command:kv-storage:set": (req) => void kept.set(req.key, req.payload),
});

/**
 * A stand-in for Drawdy's host: it keeps the elements added to it, works out where bound strings run (through their
 * bend points), answers rect queries, and keeps a camera that `fly-to-rect` moves. Every call is recorded; any
 * command it doesn't know fails.
 */
export const fakeHost = (screen = { width: 1600, height: 1000 }, extra: Record<string, (req: any) => unknown> = {}) => {
    const elements = new Map<string, Stored>();
    const calls: { type: string; req: any }[] = [];
    const camera = { x: 0, y: 0, zoom: 1 };

    /** Where an arrow's points are now: `[start, end, ...bend]`, as Drawdy reports them. */
    const pointsOf = (e: any): [number, number][] => [...ends(e), ...(e.bend ?? [])];
    const curve = (e: any) => {
        const [start, end, ...bend] = pointsOf(e).map(([x, y]) => ({ x, y }));
        return catmullRomSpline([start, ...bend, end], 20);
    };
    const rectOf = (e: any): Rect => {
        if (e.type === "arrow" || e.type === "line") return pathRect(curve(e));
        return { x: e.x ?? e.position?.[0] ?? 0, y: e.y ?? e.position?.[1] ?? 0, width: e.width ?? 200, height: e.height ?? 40 };
    };
    const anchor = (binding: any): [number, number] | null => {
        const target = elements.get(binding.drawdyElementId);
        if (!target) return null;
        const r = target.rect;
        return [r.x + r.width * binding.anchorX, r.y + r.height * binding.anchorY];
    };
    const ends = (e: any): [[number, number], [number, number]] => [
        e.startBinding ? (anchor(e.startBinding) ?? [0, 0]) : e.from,
        e.endBinding ? (anchor(e.endBinding) ?? [0, 0]) : e.to,
    ];
    const add = (schema: any) => elements.set(schema.drawdyElementId, { schema, rect: rectOf(schema) });
    const viewport = (): Rect => ({ x: -camera.x / camera.zoom, y: -camera.y / camera.zoom, width: screen.width / camera.zoom, height: screen.height / camera.zoom });
    const intersects = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

    const handlers: Record<string, (req: any) => unknown> = {
        "command:scene:add-drawdy-elements": (req) => {
            for (const e of req.elements) add(e);
            return undefined;
        },
        "command:scene:remove-drawdy-elements": (req) => {
            const existing = req.drawdyElementIds.filter((id: string) => elements.has(id));
            for (const id of existing) elements.delete(id);
            return { removed: existing.length };
        },
        "command:scene:element-rects": (req) => ({
            rects: req.drawdyElementIds.filter((id: string) => elements.has(id)).map((id: string) => ({ drawdyElementId: id, rect: elements.get(id)!.rect })),
        }),
        "command:scene:get-drawdy-elements": (req) => ({
            drawdyElements: [...elements]
                .filter(([id]) => !req.drawdyElementIds || req.drawdyElementIds.includes(id))
                .map(([id, e]) => {
                    const out: any = { id, meta: e.schema.meta, ...e.rect };
                    if (e.schema.type === "arrow") {
                        const live = (b: any) => (b && elements.has(b.drawdyElementId) ? b : undefined);
                        Object.assign(out, rectOf(e.schema));
                        out.points = pointsOf(e.schema);
                        out.startBinding = live(e.schema.startBinding);
                        out.endBinding = live(e.schema.endBinding);
                    }
                    return out;
                }),
        }),
        "command:scene:query-rect": (req) => ({
            drawdyElements: [...elements].filter(([, e]) => intersects(e.schema.type === "arrow" ? rectOf(e.schema) : e.rect, req.rect)).map(([id, e]) => ({ id, ...e.rect })),
        }),
        "command:scene:clear-selection": () => undefined,
        "command:dom:window-size": () => screen,
        "command:dom:upsert-floating-element": () => ({ created: true }),
        "command:dom:update-floating-element": () => undefined,
        "command:dom:remove-floating-element": () => ({ removed: true }),
        "command:subscription:remove": () => ({ removed: true }),
        "command:camera:get-viewport-rect": () => ({ rect: viewport() }),
        "command:camera:get-info": () => ({ ...camera }),
        "command:camera:canvas-to-screen": (req) => ({ x: camera.x + req.x * camera.zoom, y: camera.y + req.y * camera.zoom }),
        "command:camera:fly-to-rect": (req) => {
            camera.zoom = Math.min(req.zoom, screen.width / req.rect.width, screen.height / req.rect.height);
            camera.x = -req.rect.x * camera.zoom;
            camera.y = -req.rect.y * camera.zoom;
            return undefined;
        },
    };

    const call = async (type: string, req?: unknown) => {
        calls.push({ type, req });
        const handler = extra[type] ?? handlers[type] ?? (type.startsWith("subscription:") ? () => ({ subscriptionId: type }) : null);
        if (!handler) throw new Error(`unexpected command ${type}`);
        return handler(req);
    };
    const ddp = { driverId: "test", call, tryCall: (type: string, req?: unknown) => call(type, req).catch(() => null) } as unknown as Ddp;
    /** Drawdy's command channel over this host, as a driver's `activate` gets it: a command that throws answers with a protocol error. */
    const issueCommand = (async (request: { type: string; req?: unknown }) => {
        try {
            return { ...request, res: { value: await call(request.type, request.req) } };
        } catch (err) {
            const type = (err as { cause?: { type?: string } })?.cause?.type ?? "runtime";
            return { ...request, res: { error: { type, message: err instanceof Error ? err.message : String(err) } } };
        }
    }) as unknown as DriverCommandIssuer;
    /** Where a string runs now, as Drawdy draws it. */
    const pathOf = (id: string) => curve(elements.get(id)!.schema);
    const styling = { theme: "dark", primary: "#c5f601", foreground: "#fff", border: "#333", surface: "#222", surface2: "#2a2a2a" } as ModuleStyling;
    return { ddp, issueCommand, calls, elements, camera, screen, styling, add, pathOf, remove: (id: string) => elements.delete(id) };
};
