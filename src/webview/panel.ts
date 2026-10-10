import type { PanelView, WebviewToDriver } from "../shared/protocol.ts";

export type PanelDeps = {
    post: (message: WebviewToDriver) => void;
    document: Document;
};

export type Panel = { show: (view: PanelView) => void };

/**
 * The panel UI. The driver owns the state and sends a whole view each time
 * it changes; the panel draws it and sends back what the reader asks for.
 *
 * Self-contained by design: the driver serializes this function into the
 * webview, so it may only use its parameters, browser globals and what it
 * defines itself.
 */
export const createPanel = ({ post, document: doc }: PanelDeps): Panel => {
    const byId = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
    const sections = { start: byId("start"), loading: byId("loading"), ready: byId("ready") };
    const startUrl = byId<HTMLInputElement>("start-url");
    let view: PanelView | null = null;
    /** The error the reader has typed past: it stays hidden until a new one arrives. */
    let dismissed: string | null = null;
    /** Open another was pressed: the field takes focus once the start view is back. */
    let focusField = false;

    const h = (tag: string, props: Record<string, string> = {}, ...kids: (Node | string | null)[]): HTMLElement => {
        const el = doc.createElement(tag);
        for (const [k, v] of Object.entries(props)) {
            if (k === "class") el.className = v;
            else el.setAttribute(k, v);
        }
        for (const kid of kids) if (kid !== null) el.append(kid);
        return el;
    };

    /** Text that may break at camel humps and after a slash, so long names and paths wrap at a word. */
    const breakable = (text: string): Node[] =>
        text
            .replace(/([a-z0-9])(?=[A-Z])/g, "$1\u0000")
            .replace(/\//g, "/\u0000")
            .split("\u0000")
            .flatMap((part, i) => (i > 0 ? [doc.createElement("wbr"), doc.createTextNode(part)] : [doc.createTextNode(part)]));

    /** A title as text and `<code>`, built as nodes: the panel has no Markdown parser and needs none. */
    const titleNodes = (title: readonly { text: string; code: boolean }[]) => title.map((s) => (s.code ? h("code", {}, s.text) : doc.createTextNode(s.text)));

    /** A pull request's tag: an example project's in its colour, any other repo's neutral. */
    const paintTag = (el: HTMLElement, tag: PanelView["tag"]) => {
        el.textContent = tag?.label ?? "";
        el.className = tag?.colour ? "tag hue" : "tag";
        if (tag?.colour) el.style.setProperty("--c", tag.colour);
        else el.style.removeProperty("--c");
    };

    /** The error under the start view's field; errors show nowhere else. */
    const showError = (v: PanelView) => {
        const el = byId("error");
        el.hidden = !v.error || v.error === dismissed;
        el.textContent = v.error ?? "";
    };

    /** A loading step's Lucide mark, from the markup's templates: the panel draws no SVG of its own. */
    const mark = (state: string) => (byId<HTMLTemplateElement>(`mark-${state}`).content.firstElementChild as Element).cloneNode(true);

    const renderLoading = (v: PanelView) => {
        paintTag(byId("loading-tag"), v.tag);
        byId("load-steps").replaceChildren(...v.loading.map((s) => h("li", { class: s.state }, mark(s.state), h("span", {}, s.label, s.note ? h("span", { class: "note" }, ` · ${s.note}`) : null))));
    };

    /**
     * The current card: its name and chip, Read all when the card hides
     * some, its path, and its links by kind, each name following its link.
     * The PR card's name and path would repeat the header above, so its row
     * names what Read all opens, `Description`, or says there is none: a
     * board lands at the overview, where the PR card is too small to read.
     */
    const renderCard = (v: PanelView) => {
        const card = v.card;
        const pr = card?.pin === "pr";
        byId("card").hidden = !card;
        if (!card) return;
        const name = byId("name");
        name.className = pr ? "about" : "mono";
        if (pr) name.replaceChildren(card.canReadAll ? "Description" : "No description provided.");
        else name.replaceChildren(...breakable(card.name), ...(card.status ? [h("span", { class: `status ${card.status}` }, card.status)] : []));
        byId("read-all").hidden = !card.canReadAll;
        const path = byId("path");
        path.hidden = pr;
        // No-break spaces keep `· 411–471` on the line with the path's end.
        path.replaceChildren(...breakable(card.where.replace(/ · /g, "\u00a0·\u00a0")));
        const links = byId("links");
        links.hidden = card.links.length === 0;
        links.replaceChildren(
            ...card.links.flatMap((row) =>
                row.chips.flatMap((c, i) => {
                    const button = h("button", { type: "button", class: "mono" }, ...breakable(c.name));
                    button.addEventListener("click", () => post({ type: "follow", link: c.link }));
                    return [h("span", { class: "kind" }, i === 0 ? row.word : ""), button];
                })
            )
        );
    };

    const renderReady = (v: PanelView) => {
        if (!v.pr) return;
        paintTag(byId("pr-tag"), v.tag);
        byId("pr-add").textContent = `+${v.pr.additions.toLocaleString("en-US")}`;
        byId("pr-del").textContent = `−${v.pr.deletions.toLocaleString("en-US")}`;
        const state = byId("pr-state");
        state.textContent = v.pr.state.charAt(0).toUpperCase() + v.pr.state.slice(1);
        state.className = `state ${v.pr.state}`;
        byId("pr-title").replaceChildren(...titleNodes(v.pr.title));
        byId("position").textContent = `${v.current >= 0 ? v.current + 1 : "–"} / ${v.total}`;
        (byId("previous") as HTMLButtonElement).disabled = !v.hasPrevious;
        (byId("next") as HTMLButtonElement).disabled = !v.hasNext;
        renderCard(v);
    };

    const show = (next: PanelView) => {
        if (next.error !== dismissed) dismissed = null;
        // Opening something clears the field; a failure comes back to the start view with the link kept.
        if (view?.phase === "loading" && next.phase === "ready" && !next.error) startUrl.value = "";
        view = next;
        sections.start.hidden = next.phase !== "start";
        sections.loading.hidden = next.phase !== "loading";
        sections.ready.hidden = next.phase !== "ready";
        if (next.phase === "start") showError(next);
        if (next.phase === "loading") renderLoading(next);
        if (next.phase === "ready") renderReady(next);
        if (next.phase === "start" && focusField) {
            focusField = false;
            startUrl.focus();
        }
    };

    const open = (url: string) => {
        if (!url.trim()) return;
        dismissed = null;
        post({ type: "open", url: url.trim() });
    };
    // A paste opens at once, and so does Enter. Only the driver decides what is a pull request.
    // No <form>: Drawdy's webview sandbox has no allow-forms, so a submit would be blocked.
    startUrl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") open(startUrl.value);
    });
    startUrl.addEventListener("paste", () => setTimeout(() => open(startUrl.value)));
    startUrl.addEventListener("input", () => {
        dismissed = view?.error ?? null;
        byId("error").hidden = true;
    });
    doc.querySelectorAll<HTMLButtonElement>(".prs button").forEach((button) => button.addEventListener("click", () => open(button.dataset.url ?? "")));
    byId("another").addEventListener("click", () => {
        focusField = true;
        post({ type: "start" });
    });
    const on = (id: string, message: WebviewToDriver) => byId(id).addEventListener("click", () => post(message));
    on("overview", { type: "overview" });
    on("previous", { type: "previous" });
    on("next", { type: "next" });
    on("read-all", { type: "read-all" });
    doc.addEventListener("keydown", (e) => {
        if (view?.phase !== "ready" || e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key === "Escape") {
            e.preventDefault();
            post({ type: "close" });
            return;
        }
        const message: WebviewToDriver | null = e.key === "ArrowRight" ? { type: "next" } : e.key === "ArrowLeft" ? { type: "previous" } : null;
        if (!message) return;
        e.preventDefault();
        post(message);
    });

    return { show };
};
