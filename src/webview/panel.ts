import type { Annotation, CodeCard, LoadStep, PanelView, PrCardView, StepRow, WebviewToDriver } from "../shared/protocol.ts";

export type PanelDeps = {
    post: (message: WebviewToDriver) => void;
    document: Document;
};

export type Panel = { show: (view: PanelView) => void };

/**
 * The panel UI. The driver owns the state and sends a whole view each time it changes; the panel draws it and sends
 * back what the reader asks for. Its own state is small: a held Rebuild, each PR's warnings open or shut, the field.
 *
 * Self-contained by design: the driver serializes this function into the webview, so it may only use its
 * parameters, browser globals and what it defines itself.
 */
export const createPanel = ({ post, document: doc }: PanelDeps): Panel => {
    const byId = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
    const startUrl = byId<HTMLInputElement>("start-url");
    let view: PanelView | null = null;
    /** The error the reader has typed past: it stays hidden until a new one arrives. */
    let dismissed: string | null = null;
    /** Home was pressed: the field takes focus once the start view is back. */
    let focusField = false;
    /** Rebuild pressed once on a PR that costs more than 2 requests: held, its cost on the line, until a second press starts it, or Esc or any other control lets it go. */
    let held = false;
    /** The description on show, drawn again only when it changes. */
    let description: string | null | undefined;
    /** Whether the PR card was current: its description scrolls to its top only when it becomes current. */
    let atDescription = false;
    /**
     * Whether each PR's warnings are open, by its tag, while the panel lives: on the loading view they start open, so
     * each comes into sight as it is found; at the PR card they start shut, one row that counts them.
     */
    const opened = { "load-notes": new Map<string, boolean>(), "pr-notes": new Map<string, boolean>() };
    const OPEN_AT_FIRST = { "load-notes": true, "pr-notes": false };
    /** What a screen reader hears of a step's or a row's state, after its words: the marks differ by shape too. */
    const STATE_WORDS: Record<string, string> = { todo: "to do", active: "under way", done: "done", warning: "done, with a warning", failed: "failed" };

    const h = (tag: string, props: Record<string, string> = {}, ...kids: (Node | string | null)[]): HTMLElement => {
        const el = doc.createElement(tag);
        for (const [k, v] of Object.entries(props)) {
            if (k === "class") el.className = v;
            else el.setAttribute(k, v);
        }
        for (const kid of kids) if (kid !== null) el.append(kid);
        return el;
    };

    const setText = (el: Element, text: string) => {
        if (el.textContent !== text) el.textContent = text;
    };

    /** Text that may break at camel humps and after a slash, so long names and paths wrap at a word. */
    const breakable = (text: string): Node[] =>
        text
            .replace(/([a-z0-9])(?=[A-Z])/g, "$1\u0000")
            .replace(/\//g, "/\u0000")
            .split("\u0000")
            .flatMap((part, i) => (i > 0 ? [doc.createElement("wbr"), doc.createTextNode(part)] : [doc.createTextNode(part)]));

    /** A Lucide mark from the markup's templates, `mark-done` for a step, `row-done` for a row: the panel draws no SVG of its own. */
    const mark = (id: string) => (byId<HTMLTemplateElement>(id).content.firstElementChild as Element).cloneNode(true);

    /**
     * Brings `list`'s children in line with `items`, by key: an element kept is changed in place, so a turning mark
     * keeps turning and nothing opens twice; a new one is made where it belongs, and one gone is removed.
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

    /** A PR's tag: an example project's in its colour, any other repo's neutral. */
    const paintTag = (el: HTMLElement, tag: PanelView["tag"]) => {
        el.textContent = tag?.label ?? "";
        el.className = tag?.colour ? "tag hue" : "tag";
        if (tag?.colour) el.style.setProperty("--c", tag.colour);
        else el.style.removeProperty("--c");
    };

    /** The start view: the error under its field, for a failed open; after Home, the field takes focus. */
    const renderStart = (v: PanelView) => {
        const error = byId("error");
        error.hidden = !v.error || v.error === dismissed;
        error.textContent = v.error ?? "";
        if (!focusField) return;
        focusField = false;
        startUrl.focus();
    };

    /** A changed file by its path, its folder muted. */
    const fileNodes = (path: string) => {
        const cut = path.lastIndexOf("/") + 1;
        return h("span", { class: "file", title: path }, h("bdi", {}, cut > 0 ? h("span", { class: "dir" }, path.slice(0, cut)) : null, path.slice(cut)));
    };

    /**
     * Cuts a path too long for its row at its start, whole folders at a time, `…/components/App.tsx`, keeping as many
     * of the file's folders as fit; a name too long on its own loses its start. Paths are monospace, so what fits is
     * about a count of characters, and the last character or two come off until the row holds it. With no layout, as
     * in a test's document, the path stays.
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

    type Row = StepRow | { more: number };

    const newRow = (row: Row) =>
        "more" in row ? h("li", { class: "more" }) : h("li", {}, mark(`row-${row.state}`), row.file ? fileNodes(row.label) : h("span", {}, row.label), h("span", { class: "sr" }));

    const paintRow = (li: HTMLElement, row: Row) => {
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
        const rows: Row[] = [...step.rows, ...(step.more ? [{ more: step.more }] : [])];
        sync(wrap.firstElementChild!, rows, (row) => ("more" in row ? "more" : row.label), newRow, paintRow);
        // Each path is fitted once, as its row first shows: a path never changes.
        for (const file of wrap.querySelectorAll<HTMLElement>(".file:not([data-fit])")) {
            file.dataset.fit = "";
            fitPath(file);
        }
    };

    const newStep = () => h("li", {}, h("span"), h("span", {}, h("span"), h("span", { class: "note" }), h("span", { class: "sr" })), h("span", { class: "load-meta" }));

    const paintStep = (li: HTMLElement, step: LoadStep) => {
        paintMark(li, "mark", step.state);
        const [label, note, state] = li.children[1].children;
        setText(label, step.label);
        setText(note, step.note ? ` · ${step.note}` : "");
        setText(state, `, ${STATE_WORDS[step.state]}`);
        setText(li.children[2], step.meta ?? "");
        paintRows(li, step);
    };

    /** Opens or shuts a frame of warnings: its row says which, and its list slides open or shut. */
    const setOpen = (group: Element, open: boolean) => {
        group.classList.toggle("open", open);
        group.firstElementChild!.setAttribute("aria-expanded", String(open));
    };

    /** A CI annotation: a warning's amber triangle or a failure's red disc, then the title and a plain detail line. */
    const newNote = (n: Annotation) =>
        h("div", { class: `annotation ${n.level}`, ...(n.level === "failure" ? { role: "alert" } : {}) }, mark(n.level === "failure" ? "mark-failed" : "mark-warning"), h("div", {}, h("p", { class: "title" }), h("p", { class: "detail" })));

    const paintNote = (el: HTMLElement, n: Annotation) => {
        const [title, detail] = el.children[1].children;
        setText(title, n.title);
        setText(detail, n.detail);
    };

    /** Annotations: the warnings share a frame under one row that counts them and opens or shuts them; a failure is never shut. */
    const paintNotes = (box: HTMLElement, notes: readonly Annotation[]) => {
        const at = box.id as keyof typeof opened;
        const [group, failures] = box.children as unknown as [HTMLElement, HTMLElement | undefined];
        const warnings = notes.filter((n) => n.level === "warning");
        group.hidden = warnings.length === 0;
        setText(group.querySelector(".summary > span")!, `${warnings.length.toLocaleString("en-US")} ${warnings.length === 1 ? "warning" : "warnings"}`);
        setOpen(group, opened[at].get(view?.tag?.label ?? "") ?? OPEN_AT_FIRST[at]);
        sync(group.querySelector(".warnings-list")!, warnings, (n) => n.title, newNote, paintNote);
        if (failures) sync(failures, notes.filter((n) => n.level === "failure"), (n) => n.title, newNote, paintNote);
    };

    /**
     * The loading view, as a CI job: the tag, the steps, then the annotations. A failed step keeps the view, with
     * Home and Try again under it; the status line tells a screen reader the step under way.
     */
    const renderLoading = (v: PanelView) => {
        paintTag(byId("loading-tag"), v.tag);
        sync(byId("load-steps"), v.loading, (s) => s.key, newStep, paintStep);
        paintNotes(byId("load-notes"), v.annotations);
        setText(byId("load-status"), v.loading.filter((s) => s.state === "active").map((s) => s.label).join(", "));
        byId("load-tools").hidden = !v.loading.some((s) => s.state === "failed");
    };

    /** The PR being read: its tag, its lines added and deleted, its state and its title, as text and `<code>`. */
    const renderPr = (tag: PanelView["tag"], pr: NonNullable<PanelView["pr"]>) => {
        paintTag(byId("pr-tag"), tag);
        byId("pr-add").textContent = `+${pr.additions.toLocaleString("en-US")}`;
        byId("pr-del").textContent = `−${pr.deletions.toLocaleString("en-US")}`;
        const state = byId("pr-state");
        state.textContent = pr.state.charAt(0).toUpperCase() + pr.state.slice(1);
        state.className = `state ${pr.state}`;
        byId("pr-title").replaceChildren(...pr.title.map((s) => (s.code ? h("code", {}, s.text) : doc.createTextNode(s.text))));
    };

    /**
     * At the PR card: who opened it and how big it is, what the board can't show, as the loading view said it, then
     * the whole description, which the driver sends rendered: every tag one it chose, all text escaped.
     */
    const renderPrCard = (card: PrCardView) => {
        byId("about").replaceChildren(...card.about.flatMap((line, i) => (i > 0 ? [h("br"), line] : [line])));
        paintNotes(byId("pr-notes"), card.warnings);
        const body = byId("pr-body");
        if (card.description !== description) {
            body.innerHTML = card.description ?? '<p class="none">No description provided.</p>';
            description = card.description;
        }
        if (!atDescription) body.scrollTop = 0;
        atDescription = true;
    };

    /** A link's name: it follows its link, in its string's colour when it has one. */
    const linkButton = (chip: CodeCard["links"][number]["chips"][number]) => {
        const button = h("button", { type: "button", class: "mono", ...(chip.colour === null ? {} : { style: `color: var(--string-${chip.colour})` }) }, ...breakable(chip.name));
        button.addEventListener("click", () => act({ type: "follow", link: chip.link }));
        return button;
    };

    /** At a code card: its name and chip, Read all when the card hides some, its path, and its links by kind. */
    const renderCodeCard = (card: CodeCard) => {
        byId("name").replaceChildren(...breakable(card.name), ...(card.status ? [h("span", { class: `status ${card.status}` }, card.status)] : []));
        byId("read-all").hidden = !card.canReadAll;
        // No-break spaces keep `· 411–471` on the line with the path's end.
        byId("path").replaceChildren(...breakable(card.where.replace(/ · /g, " · ")));
        const links = byId("links");
        links.hidden = card.links.length === 0;
        links.replaceChildren(...card.links.flatMap((row) => row.chips.flatMap((chip, i) => [h("span", { class: "kind" }, i === 0 ? row.word : ""), linkButton(chip)])));
    };

    const renderCard = (card: PanelView["card"]) => {
        byId("card").hidden = !card;
        const pr = card !== null && "about" in card;
        for (const id of ["card-head", "path", "links"]) byId(id).hidden = pr;
        for (const id of ["about", "pr-body"]) byId(id).hidden = !pr;
        byId("pr-notes").hidden = !pr || card.warnings.length === 0;
        if (pr) return renderPrCard(card);
        atDescription = false;
        if (card) renderCodeCard(card);
    };

    /** The toolbar's line, shown only when needed: a rebuild's step under way, a held Rebuild's cost, or an error from an action. */
    const renderLine = (v: PanelView) => {
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
    };

    /** Where the reader is: Description is marked while the PR card is current; the position counts code steps only, `–` elsewhere. */
    const renderPlace = (v: PanelView) => {
        const described = byId("description");
        if (v.card !== null && "about" in v.card) described.setAttribute("aria-current", "true");
        else described.removeAttribute("aria-current");
        byId("position").textContent = `${v.current >= 0 ? v.current + 1 : "–"} / ${v.total}`;
        byId<HTMLButtonElement>("previous").disabled = !v.hasPrevious;
        byId<HTMLButtonElement>("next").disabled = !v.hasNext;
    };

    const renderTools = (v: PanelView) => {
        renderLine(v);
        renderPlace(v);
    };

    /** The reading view: the PR, the current card, then the toolbar. */
    const renderReady = (v: PanelView) => {
        if (!v.pr) return;
        renderPr(v.tag, v.pr);
        renderCard(v.card);
        renderTools(v);
    };

    const RENDER = { start: renderStart, loading: renderLoading, ready: renderReady };

    const show = (next: PanelView) => {
        if (next.error !== dismissed) dismissed = null;
        // Opening something clears the field; a failure comes back to the start view with the link kept.
        if (view?.phase === "loading" && next.phase === "ready" && !next.error) startUrl.value = "";
        if (next.phase !== "ready") held = false;
        view = next;
        for (const phase of ["start", "loading", "ready"] as const) byId(phase).hidden = next.phase !== phase;
        RENDER[next.phase](next);
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

    const goHome = () => {
        focusField = true;
        act({ type: "start" });
    };

    /** A frame's row opens or shuts its warnings, and the panel keeps that for this PR while it lives. */
    const toggleNotes = (at: keyof typeof opened) => {
        release();
        const group = byId(at).firstElementChild!;
        const open = !group.classList.contains("open");
        opened[at].set(view?.tag?.label ?? "", open);
        setOpen(group, open);
    };

    /** Rebuild starts at once for the usual 2 requests; past that, the first press holds it and says the cost, the second starts it. */
    const pressRebuild = () => {
        if (view?.rebuildCost && !held) {
            held = true;
            renderTools(view);
            return;
        }
        held = false;
        if (view?.phase === "ready") renderTools(view);
        // Off at once, before the driver's next view says a rebuild runs: a second press must not ask again.
        byId<HTMLButtonElement>("rebuild").disabled = true;
        post({ type: "rebuild" });
    };

    const onKey = (e: KeyboardEvent) => {
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
    };

    const onClick = (id: string, handler: () => void) => byId(id).addEventListener("click", handler);

    // A paste opens at once, and so does Enter. Only the driver decides what is a PR.
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
    for (const id of ["home", "load-home"]) onClick(id, goHome);
    for (const at of ["load-notes", "pr-notes"] as const) byId(at).firstElementChild!.firstElementChild!.addEventListener("click", () => toggleNotes(at));
    // A failed open's Try again opens the same PR, by the tag it showed.
    onClick("retry", () => {
        if (view?.tag) open(view.tag.label);
    });
    onClick("rebuild", pressRebuild);
    onClick("overview", () => act({ type: "overview" }));
    onClick("description", () => {
        byId("pr-body").scrollTop = 0;
        act({ type: "description" });
    });
    onClick("previous", () => act({ type: "previous" }));
    onClick("next", () => act({ type: "next" }));
    onClick("read-all", () => act({ type: "read-all" }));
    doc.addEventListener("keydown", onKey);

    return { show };
};
