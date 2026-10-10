import type { Rect } from "../lib/layout.ts";
import { VIEW, type Camera, type Screen } from "../lib/view.ts";
import type { Ddp } from "./ddp.ts";

/** The window's size, or a common laptop screen when Drawdy can't say. */
export const screenOf = async (ddp: Ddp): Promise<Screen> => (await ddp.tryCall("command:dom:window-size")) ?? { width: 1280, height: 800 };

export const viewportOf = async (ddp: Ddp): Promise<Rect | null> => (await ddp.tryCall("command:camera:get-viewport-rect"))?.rect ?? null;

/** One flight to a camera worked out by `lib/view.ts`. */
export const fly = (ddp: Ddp, camera: Camera, durationMs: number = VIEW.flightMs) =>
    ddp.tryCall("command:camera:fly-to-rect", { rect: camera.rect, flyDurationMs: durationMs, zoom: camera.zoom });
