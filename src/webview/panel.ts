import type { PanelView, WebviewToDriver } from "../shared/protocol.ts";

export type PanelDeps = {
    post: (message: WebviewToDriver) => void;
    document: Document;
};

export type Panel = { show: (view: PanelView) => void };

/**
 * The panel UI. The driver owns the state and sends a whole view each time
 * it changes; the panel draws it and sends back what the reader asks for.
 * The one state of its own is a held Rebuild (`held`).
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
    /** Home was pressed: the field takes focus once the start view is back. */
    let focusField = false;
    /** Rebuild pressed once on a pull request that costs more than 2 requests: held down, its cost on the line, until a second press starts it, or Esc or any other control lets it go. */
    let held = false;
    /** The description on show, so it is drawn again only when it changes, and whether the PR card was current, so it scrolls to its top only when the PR card becomes current. */
    let description: string | null | undefined;
    let atDescription = false;

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

    /** The error under the start view's field, for a failed open. */
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
     * The current card. At the PR card: who opened it and how big it is,
     * then the whole description, which the driver sends rendered: every
     * tag one it chose, all text escaped. At a code card: its name and chip,
     * Read all when the card hides some, its path, and its links by kind,
     * each name following its link, in its string's colour when it has one.
     */
    const renderCard = (v: PanelView) => {
        const card = v.card;
        byId("card").hidden = !card;
        const pr = card !== null && "about" in card;
        for (const id of ["card-head", "path", "links"]) byId(id).hidden = pr;
        for (const id of ["about", "pr-body"]) byId(id).hidden = !pr;
        if (card && "about" in card) {
            byId("about").replaceChildren(...card.about.flatMap((line, i) => (i > 0 ? [h("br"), line] : [line])));
            const body = byId("pr-body");
            if (card.description !== description) {
                body.innerHTML = card.description ?? '<p class="none">No description provided.</p>';
                description = card.description;
            }
            if (!atDescription) body.scrollTop = 0;
            atDescription = true;
            return;
        }
        atDescription = false;
        if (!card) return;
        byId("name").replaceChildren(...breakable(card.name), ...(card.status ? [h("span", { class: `status ${card.status}` }, card.status)] : []));
        byId("read-all").hidden = !card.canReadAll;
        // No-break spaces keep `· 411–471` on the line with the path's end.
        byId("path").replaceChildren(...breakable(card.where.replace(/ · /g, " · ")));
        const links = byId("links");
        links.hidden = card.links.length === 0;
        links.replaceChildren(
            ...card.links.flatMap((row) =>
                row.chips.flatMap((c, i) => {
                    const button = h("button", { type: "button", class: "mono", ...(c.colour === null ? {} : { style: `color: var(--string-${c.colour})` }) }, ...breakable(c.name));
                    button.addEventListener("click", () => act({ type: "follow", link: c.link }));
                    return [h("span", { class: "kind" }, i === 0 ? row.word : ""), button];
                })
            )
        );
    };

    /**
     * The toolbar: its line, shown only when needed (a rebuild's step under
     * way, a held Rebuild's cost, or an error from an action in the reading
     * view), then the buttons. Description is marked while the PR card is
     * current; the position counts code steps only, `–` elsewhere.
     */
    const renderTools = (v: PanelView) => {
        const busy = v.rebuilding !== null;
        if (busy || !v.rebuildCost) held = false;
        const line = byId("tools-line");
        if (busy) line.replaceChildren(mark("active"), h("span", {}, v.rebuilding ?? ""));
        else if (held && v.rebuildCost)
            line.replaceChildren(
                h("span", {}, `Rebuilding reads ${v.rebuildCost.files.toLocaleString("en-US")} files: ${v.rebuildCost.requests} of 60 GitHub requests. Press Rebuild again to start.`)
            );
        line.hidden = !busy && !held;
        line.classList.toggle("busy", busy);
        const error = byId("tools-error");
        error.hidden = busy || held || !v.error;
        error.textContent = v.error ?? "";
        const rebuild = byId<HTMLButtonElement>("rebuild");
        rebuild.disabled = busy;
        rebuild.classList.toggle("armed", held);
        const described = byId("description");
        if (v.card !== null && "about" in v.card) described.setAttribute("aria-current", "true");
        else described.removeAttribute("aria-current");
        byId("position").textContent = `${v.current >= 0 ? v.current + 1 : "–"} / ${v.total}`;
        byId<HTMLButtonElement>("previous").disabled = !v.hasPrevious;
        byId<HTMLButtonElement>("next").disabled = !v.hasNext;
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
        renderCard(v);
        renderTools(v);
    };

    const show = (next: PanelView) => {
        if (next.error !== dismissed) dismissed = null;
        // Opening something clears the field; a failure comes back to the start view with the link kept.
        if (view?.phase === "loading" && next.phase === "ready" && !next.error) startUrl.value = "";
        if (next.phase !== "ready") held = false;
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

    /** Lets a held Rebuild go, as Esc and every other control do. */
    const release = () => {
        if (!held) return;
        held = false;
        if (view?.phase === "ready") renderTools(view);
    };

    /** A control's message to the driver: any control but Rebuild lets a held Rebuild go. */
    const act = (message: WebviewToDriver) => {
        release();
        post(message);
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

    const on = (id: string, message: WebviewToDriver) => byId(id).addEventListener("click", () => act(message));
    byId("home").addEventListener("click", () => {
        focusField = true;
        act({ type: "start" });
    });
    // Rebuild starts at once for the usual 2 requests; past that, the first press holds it and says the cost, the second starts it.
    byId("rebuild").addEventListener("click", () => {
        if (!view?.rebuildCost || held) {
            held = false;
            if (view?.phase === "ready") renderTools(view);
            // Off at once, before the driver's next view says a rebuild runs: a second press must not ask again.
            byId<HTMLButtonElement>("rebuild").disabled = true;
            post({ type: "rebuild" });
            return;
        }
        held = true;
        renderTools(view);
    });
    on("overview", { type: "overview" });
    byId("description").addEventListener("click", () => {
        byId("pr-body").scrollTop = 0;
        act({ type: "description" });
    });
    on("previous", { type: "previous" });
    on("next", { type: "next" });
    on("read-all", { type: "read-all" });
    doc.addEventListener("keydown", (e) => {
        if (view?.phase !== "ready" || e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key === "Escape") {
            e.preventDefault();
            act({ type: "close" });
            return;
        }
        const message: WebviewToDriver | null = e.key === "ArrowRight" ? { type: "next" } : e.key === "ArrowLeft" ? { type: "previous" } : null;
        // In the description or the links, ← and → scroll what has focus: a wide code block or table, sideways.
        if (!message || (e.target instanceof Element && e.target.closest(".scroll"))) return;
        e.preventDefault();
        act(message);
    });

    return { show };
};
