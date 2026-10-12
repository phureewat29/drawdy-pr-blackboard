/**
 * Rust's method probe: `x.f()` tries x's type by value, then `&`, then
 * `&mut`, and a trait's `f` found at an earlier step wins. An inherent method
 * links only when no trait method of its name, in the files or the standard
 * library, takes `self` in a mode that comes first for x (`self` in a
 * `&self` method is a `&` reference, in a `&mut self` one a `&mut`; any other
 * receiver may be either, or a value).
 */

import type { GFile } from "../../anyfacts.ts";
import type { Typing } from "../../anylink.ts";
import { child, namedChildren, textOf, type Flat } from "../../syntax.ts";

/** How a method takes `self`: by value, `&self`, `&mut self`, or as another type (`self: Box<Self>`). */
type Mode = "value" | "ref" | "mut" | "other";

/** A function's receiver mode, or null when it takes no `self`. */
const modeOf = (t: Flat, fn: number): Mode | null => {
    for (const p of namedChildren(t, child(t, fn, "parameters"))) {
        if (t.type[p] === "self_parameter") {
            let ref = false;
            let mut = false;
            for (let c = t.first[p]; c >= 0; c = t.next[c]) {
                if (t.type[c] === "&") ref = true;
                else if (t.type[c] === "mutable_specifier") mut = true;
            }
            return ref ? (mut ? "mut" : "ref") : "value";
        }
        if (t.type[p] !== "parameter" || !namedChildren(t, p).some((c) => t.type[c] === "self")) continue;
        // `self: Self`, `self: &Self`, `self: &mut Self`; any other type (`Box<Self>`, `Pin<&mut Self>`) is another step of the probe.
        const type = child(t, p, "type");
        if (type >= 0 && textOf(t, type) === "Self") return "value";
        if (type >= 0 && t.type[type] === "reference_type" && textOf(t, child(t, type, "type")) === "Self") return namedChildren(t, type).some((c) => t.type[c] === "mutable_specifier") ? "mut" : "ref";
        return "other";
    }
    return null;
};

/**
 * The standard library's trait methods by how they take `self`. By value:
 * Into, IntoIterator, TryInto and IntoFuture, Iterator's adapters,
 * consumers and comparisons, Read's and BufRead's adapters, Ord's max, min
 * and clamp, the operator traits. `&mut self`: io's Write, Read, BufRead
 * and Seek, Iterator's and DoubleEndedIterator's stepping methods, Hasher,
 * fmt::Write, Extend, the `*Assign` operators, DerefMut, AsMut, BorrowMut,
 * IndexMut, Clone::clone_from. `&self`: Clone, ToString, ToOwned, Display
 * and Debug, PartialEq, PartialOrd, Ord::cmp, Hash, Deref, AsRef, Borrow,
 * Index, ExactSizeIterator, Error, Any, Hasher::finish.
 */
const STD_MODES: Record<"value" | "mut" | "ref", string> = {
    value:
        "into into_iter try_into into_future map filter filter_map flat_map flatten take skip take_while skip_while map_while step_by chain zip enumerate peekable rev cloned copied cycle fuse inspect scan count last sum product fold rfold reduce try_reduce for_each collect try_collect collect_into partition is_partitioned unzip max min max_by max_by_key min_by min_by_key clamp cmp partial_cmp eq ne lt le gt ge cmp_by partial_cmp_by eq_by is_sorted is_sorted_by is_sorted_by_key array_chunks map_windows intersperse intersperse_with bytes lines split add sub mul div rem neg not bitand bitor bitxor shl shr",
    mut: "write write_all write_vectored write_all_vectored write_fmt flush by_ref read read_vectored read_to_end read_to_string read_exact read_buf read_buf_exact fill_buf consume read_until read_line skip_until has_data_left seek rewind stream_position stream_len seek_relative next nth all any find find_map position rposition try_fold try_for_each try_find advance_by next_chunk next_back nth_back rfind try_rfold advance_back_by write_u8 write_u16 write_u32 write_u64 write_u128 write_usize write_i8 write_i16 write_i32 write_i64 write_i128 write_isize write_length_prefix write_str write_char extend extend_one extend_reserve add_assign sub_assign mul_assign div_assign rem_assign bitand_assign bitor_assign bitxor_assign shl_assign shr_assign deref_mut as_mut borrow_mut index_mut clone_from call_mut",
    ref: "clone to_string to_owned fmt eq ne partial_cmp lt le gt ge cmp hash deref as_ref borrow index size_hint len is_empty source description cause type_id finish build_hasher hash_one call provide",
};

/** The receiver modes trait methods give each name: the standard library's, and those of the traits and trait impls among the files. */
export const traitModes = (files: readonly GFile[]): ReadonlyMap<string, ReadonlySet<string>> => {
    const out = new Map<string, Set<string>>();
    const add = (name: string, mode: Mode) => {
        const modes = out.get(name);
        if (modes) modes.add(mode);
        else out.set(name, new Set([mode]));
    };
    for (const [mode, names] of Object.entries(STD_MODES)) for (const name of names.split(" ")) add(name, mode as Mode);
    for (const f of files) {
        const t = f.flat;
        for (let n = 0; n < t.count; n++) {
            if (t.type[n] !== "function_item" && t.type[n] !== "function_signature_item") continue;
            const list = t.parent[n];
            const owner = list >= 0 && t.type[list] === "declaration_list" ? t.parent[list] : -1;
            if (owner < 0 || !(t.type[owner] === "trait_item" || (t.type[owner] === "impl_item" && child(t, owner, "trait") >= 0))) continue;
            const mode = modeOf(t, n);
            if (mode) add(textOf(t, child(t, n, "name")), mode);
        }
    }
    return out;
};

const ALL: readonly Mode[] = ["value", "ref", "mut"];

/**
 * For a receiver of a mode, or any (a value, `&` or `&mut`), and an
 * inherent method of a mode: the trait modes the probe tries first. It tries
 * the receiver's type by value, then `&`, then `&mut`, then the same after
 * each deref, an inherent method before a trait's at each step. A receiver
 * that is another type (`Box<Self>`, `&&T`) meets traits implemented for that
 * type before x's own methods: any mode comes first.
 */
const FIRST: Record<"value" | "ref" | "mut" | "any" | "other", Record<"value" | "ref" | "mut", readonly Mode[]>> = {
    value: { value: [], ref: ["value"], mut: ["value", "ref"] },
    ref: { value: ["ref"], ref: [], mut: ["ref", "value"] },
    mut: { value: ["mut"], ref: ["mut", "value"], mut: [] },
    any: { value: ["ref", "mut"], ref: ["value", "mut"], mut: ["value", "ref"] },
    other: { value: ALL, ref: ALL, mut: ALL },
};

/** The receiver mode a declared type gives: `&T`, `&mut T`, `T`; two `&`s or a raw pointer are another type; anything else may be any. */
const typeMode = (t: Flat, type: number): keyof typeof FIRST => {
    switch (t.type[type]) {
        case "reference_type": {
            const inner = child(t, type, "type");
            if (inner >= 0 && t.type[inner] === "reference_type") return "other";
            return namedChildren(t, type).some((c) => t.type[c] === "mutable_specifier") ? "mut" : "ref";
        }
        case "type_identifier":
        case "scoped_type_identifier":
        case "generic_type":
            return "value";
        case "pointer_type":
            return "other";
        default:
            return "any";
    }
};

/** What a receiver is: `self` in the method it's written in takes that method's mode, a name its declared type's; any other may be any. */
const receiverKind = (t: Flat, n: number, declared: number): keyof typeof FIRST => {
    if (n >= 0 && (t.type[n] === "self" || (t.type[n] === "identifier" && textOf(t, n) === "self"))) {
        let fn = t.parent[n];
        while (fn >= 0 && t.type[fn] !== "function_item") fn = t.parent[fn];
        return (fn >= 0 ? modeOf(t, fn) : null) ?? "any";
    }
    return declared >= 0 ? typeMode(t, declared) : "any";
};

/** Whether a trait method of the name whose mode the probe tries first wins; one taking `self` as another type might. */
export const shadowed: NonNullable<Typing["shadowed"]> = (call, receiver, declared, method, unitNode, modes) => {
    const mode = modeOf(method, unitNode);
    if (mode === null) return false;
    if (mode === "other" || modes.has("other")) return modes.size > 0;
    return FIRST[receiverKind(call, receiver, declared)][mode].some((m) => modes.has(m));
};
