import type { Annotation, LoadStep, PanelView, StepRow, WebviewToDriver } from "../shared/protocol.ts";

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

    /** A Lucide mark from the markup's templates, `mark-done` for a step, `row-done` for a row: the panel draws no SVG of its own. */
    const mark = (id: string) => (byId<HTMLTemplateElement>(id).content.firstElementChild as Element).cloneNode(true);

    /** What a screen reader hears of a step's or a row's state, after its words: the marks differ by shape too. */
    const STATE_WORDS: Record<string, string> = { todo: "to do", active: "under way", done: "done", warning: "done, with a warning", failed: "failed" };

    const setText = (el: Element, text: string) => {
        if (el.textContent !== text) el.textContent = text;
    };

    /**
     * Brings `list`'s children in line with `items`, by key: an element kept
     * is changed in place, so a turning mark keeps turning and nothing opens
     * twice; a new one is made where it belongs, and one gone is removed.
     */
    const sync = <T,>(list: Element, items: readonly T[], key: (item: T) => string, make: (item: T) => HTMLElement, paint: (el: HTMLElement, item: T) => void) => {
        const keys = new Set(items.map(key));
        for (const el of [...list.children] as HTMLElement[]) if (!keys.has(el.dataset.key ?? "")) el.remove();
        let next = list.firstElementChild;
        for (const item of items) {
            const k = key(item);
            let el = ([...list.children] as HTMLElement[]).find((c) => c.dataset.key === k);
            if (!el) {
                el = make(item);
                el.dataset.key = k;
            }
            if (el === next) next = el.nextElementSibling;
            else list.insertBefore(el, next);
            paint(el, item);
        }
    };

    /** A step's or a row's mark, swapped only when its state changes. */
    const paintMark = (el: HTMLElement, prefix: string, state: string) => {
        if (el.dataset.state === state) return;
        el.dataset.state = state;
        el.classList.remove("todo", "active", "done", "warning", "failed");
        el.classList.add(state);
        el.firstElementChild!.replaceWith(mark(`${prefix}-${state}`));
    };

    /** A changed file by its path, its folder muted. */
    const fileNodes = (path: string) => {
        const cut = path.lastIndexOf("/") + 1;
        return h("span", { class: "file", title: path }, h("bdi", {}, cut > 0 ? h("span", { class: "dir" }, path.slice(0, cut)) : null, path.slice(cut)));
    };

    /**
     * Cuts a path too long for its row at its start, whole folders at a
     * time, `…/components/App.tsx`, keeping as many of the file's folders as
     * fit; a name too long on its own loses its start. Paths are monospace,
     * so what fits is about a count of characters, and the last character
     * or two come off until the row holds it. With no layout, as in a test's
     * document, the path stays.
     */
    const fitPath = (file: HTMLElement) => {
        const over = () => file.scrollWidth > file.clientWidth;
        if (!over()) return;
        const dir = file.querySelector(".dir");
        const name = file.firstElementChild!.lastChild!;
        const folders = (dir?.textContent ?? "").split("/").filter(Boolean);
        const named = name.textContent!;
        const fits = Math.floor(file.clientWidth / (file.scrollWidth / ((dir?.textContent ?? "").length + named.length)));
        let keep = folders.length;
        let room = fits;
        const show = () => {
            while (keep > 0 && 2 + folders.slice(-keep).join("/").length + 1 + named.length > room) keep--;
            const whole = keep > 0 || named.length + (dir ? 2 : 0) <= room;
            if (dir) dir.textContent = keep > 0 ? `…/${folders.slice(-keep).join("/")}/` : whole ? "…/" : "";
            name.textContent = whole ? named : `…${named.slice(-Math.max(1, room - 1))}`;
        };
        show();
        for (let tries = 0; over() && tries < 4; tries++) {
            room--;
            show();
        }
    };

    const paintRow = (li: HTMLElement, row: StepRow | { more: number }) => {
        if ("more" in row) return setText(li, `and ${row.more.toLocaleString("en-US")} more`);
        paintMark(li, "row", row.state);
        setText(li.lastElementChild!, `, ${STATE_WORDS[row.state]}`);
    };

    /** Folds a step's rows away as it ends: at once when they haven't opened yet, a step that ran a moment only, or when motion is reduced. */
    const closeRows = (wrap: HTMLElement) => {
        const young = Date.now() - Number(wrap.dataset.at) < 400;
        if (young || doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return wrap.remove();
        wrap.classList.add("closing");
        wrap.addEventListener("animationend", () => wrap.remove(), { once: true });
        setTimeout(() => wrap.remove(), 400);
    };

    /** A step's rows, while the driver sends them: at most 10, then a plain row saying how many more. */
    const paintRows = (li: HTMLElement, step: LoadStep) => {
        let wrap = li.querySelector<HTMLElement>(":scope > .rows-wrap:not(.closing)");
        if (!step.rows?.length) {
            if (wrap) closeRows(wrap);
            return;
        }
        if (!wrap) {
            wrap = h("div", { class: "rows-wrap" }, h("ul", { class: "rows" }));
            wrap.dataset.at = String(Date.now());
            li.append(wrap);
        }
        const items: (StepRow | { more: number })[] = [...step.rows, ...(step.more ? [{ more: step.more }] : [])];
        sync(
            wrap.firstElementChild!,
            items,
            (row) => ("more" in row ? "more" : row.label),
            (row) => ("more" in row ? h("li", { class: "more" }) : h("li", {}, mark(`row-${row.state}`), row.file ? fileNodes(row.label) : h("span", {}, row.label), h("span", { class: "sr" }))),
            paintRow
        );
        // Each path is fitted once, as its row first shows: a path never changes.
        for (const file of wrap.querySelectorAll<HTMLElement>(".file:not([data-fit])")) {
            file.dataset.fit = "";
            fitPath(file);
        }
    };

    const paintStep = (li: HTMLElement, step: LoadStep) => {
        paintMark(li, "mark", step.state);
        const [label, note, state] = li.children[1].children;
        setText(label, step.label);
        setText(note, step.note ? ` · ${step.note}` : "");
        setText(state, `, ${STATE_WORDS[step.state]}`);
        setText(li.children[2], step.meta ?? "");
        paintRows(li, step);
    };

    /** CI annotations: a warning's amber triangle, or a failure's red disc, then the title and a plain detail line; the warnings in one frame. */
    const paintNotes = (box: HTMLElement, notes: readonly Annotation[]) => {
        for (const [i, level] of (["warning", "failure"] as const).entries()) {
            const group = box.children[i];
            if (group)
                sync(
                    group,
                    notes.filter((n) => n.level === level),
                    (n) => n.title,
                    () => h("div", { class: `annotation ${level}`, ...(level === "failure" ? { role: "alert" } : {}) }, mark(level === "failure" ? "mark-failed" : "mark-warning"), h("div", {}, h("p", { class: "title" }), h("p", { class: "detail" }))),
                    (el, n) => {
                        const [title, detail] = el.children[1].children;
                        setText(title, n.title);
                        setText(detail, n.detail);
                    }
                );
        }
    };

    /**
     * The loading view, as a CI job: the tag, the steps, then the
     * annotations. A failed step keeps the view, with Home and Try again
     * under it; the status line tells a screen reader the step under way.
     */
    const renderLoading = (v: PanelView) => {
        paintTag(byId("loading-tag"), v.tag);
        sync(
            byId("load-steps"),
            v.loading,
            (s) => s.key,
            () => h("li", {}, h("span"), h("span", {}, h("span"), h("span", { class: "note" }), h("span", { class: "sr" })), h("span", { class: "load-meta" })),
            paintStep
        );
        paintNotes(byId("load-notes"), v.annotations);
        setText(byId("load-status"), v.loading.filter((s) => s.state === "active").map((s) => s.label).join(", "));
        byId("load-tools").hidden = !v.loading.some((s) => s.state === "failed");
    };

    /**
     * The current card. At the PR card: who opened it and how big it is,
     * what the board can't show, as the loading view said it, then the
     * whole description, which the driver sends rendered: every tag one it
     * chose, all text escaped. At a code card: its name and chip, Read all
     * when the card hides some, its path, and its links by kind, each name
     * following its link, in its line's colour when it has one.
     */
    const renderCard = (v: PanelView) => {
        const card = v.card;
        byId("card").hidden = !card;
        const pr = card !== null && "about" in card;
        for (const id of ["card-head", "path", "links"]) byId(id).hidden = pr;
        for (const id of ["about", "pr-body"]) byId(id).hidden = !pr;
        byId("pr-notes").hidden = !pr || card.warnings.length === 0;
        if (card && "about" in card) {
            byId("about").replaceChildren(...card.about.flatMap((line, i) => (i > 0 ? [h("br"), line] : [line])));
            paintNotes(byId("pr-notes"), card.warnings);
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
        if (busy) line.replaceChildren(mark("mark-active"), h("span", {}, v.rebuilding ?? ""));
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
    for (const id of ["home", "load-home"])
        byId(id).addEventListener("click", () => {
            focusField = true;
            act({ type: "start" });
        });
    // A failed open's Try again opens the same PR, by the tag it showed.
    byId("retry").addEventListener("click", () => {
        if (view?.tag) open(view.tag.label);
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
