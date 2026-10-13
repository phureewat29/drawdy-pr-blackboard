/**
 * Where a Kotlin file is built: its Gradle module and source set, read from
 * its path. Gradle's layout (`<module>/src/<set>/kotlin/…`) and the flat
 * multiplatform one (`<module>/<platform>/src/…`, `…/test/…`) name both; a
 * file in neither has no source set the linker knows.
 *
 * Which source sets see which is the build's (each set's `dependsOn` edges),
 * and the board reads no build. So a declaration counts as a candidate of a
 * name unless its source set surely can't be seen from the name's: a main
 * set never sees a test set; common code never sees a platform's or a group's
 * set of its module; one platform's set never sees another platform's. A
 * candidate the build doesn't see, picked while the name means a declaration
 * not read, is out of reach; dropping one the build sees could pick a less
 * specific overload, so only what surely isn't seen is dropped.
 */

export type Root = {
    /** The folder the package folders start in. */
    dir: string;
    module: string;
    /** The source set, as Gradle names it: `commonMain`, `jvmTest`, `main`. */
    set: string;
};

/** The platform folders of the flat layout (ktor's `common/src`, `jvm/test`). */
const FLAT = /^(.*?)\/(common|jvm|jvmAndPosix|posix|nix|darwin|desktop|linux\w*|windows|mingw\w*|macos\w*|ios\w*|tvos\w*|watchos\w*|js|wasmJs|wasmWasi|web|jsAndWasmShared|nonJvm|nonDarwinPosix|android\w*|native\w*|apple\w*)\/(src|test)\//;

export const rootOf = (path: string): Root | null => {
    const g = /^(?:(.*?)\/)?src\/([A-Za-z0-9]+)\/(kotlin|java)\//.exec(path);
    if (g) return { dir: g[0].slice(0, -1), module: g[1] ?? "", set: g[2] };
    const f = FLAT.exec(path);
    if (f) return { dir: f[0].slice(0, -1), module: f[1], set: `${f[2]}${f[3] === "src" ? "Main" : "Test"}` };
    return null;
};

const isTest = (set: string) => /Test$|^test$/.test(set);
/** A set's name without `Main` or `Test`: its platform or group. */
const groupOf = (set: string) => (set === "main" || set === "test" ? "" : set.replace(/(Main|Test)$/, ""));

/** The leaf platforms Kotlin's targets name their sets by; a set named so holds one platform's code. */
const LEAF = /^(jvm|android\w*|js|wasmJs|wasmWasi|(ios|macos|tvos|watchos|linux|mingw|androidNative)(X64|X86|Arm64|Arm32|SimulatorArm64|Arm32Hfp|Mips32|Mipsel32)?)$/;

/** Whether a set holds one platform's code (`jvmMain`), naming the platform; "" for a set of a module with one platform (`main`). */
const leafOf = (set: string): string | null => {
    const g = groupOf(set);
    if (g === "") return "";
    return LEAF.test(g) ? g.replace(/^android\w*$/, "android") : null;
};

/**
 * Whether code in one file surely can't see the declarations of another,
 * by their source sets: a test's from main code; a platform's or a group's
 * from its module's common code; another platform's set, in its module or
 * another one; another module's test set.
 */
export const unseen = (from: string, to: string): boolean => {
    if (from === to) return false;
    const a = rootOf(from);
    const b = rootOf(to);
    if (!a || !b || a.dir === b.dir) return false;
    if (isTest(b.set) && !isTest(a.set)) return true;
    const ga = groupOf(a.set);
    const gb = groupOf(b.set);
    if (a.module === b.module) {
        if (ga === "common" && gb !== "common") return true;
        // A platform's set and another's (jvmMain and jsMain, jvmTest and jsMain).
        const la = leafOf(a.set);
        const lb = leafOf(b.set);
        if (la && lb && la !== lb) return true;
        // A group's code never sees a platform's.
        if (la === null && lb) return true;
        return false;
    }
    if (isTest(b.set)) return true;
    const la = leafOf(a.set);
    const lb = leafOf(b.set);
    return !!(la && lb && la !== lb);
};

/** Whether a source set is a module's common code (`commonMain`, `commonTest`, the flat layout's `common`). */
export const commonSet = (set: string): boolean => groupOf(set) === "common";
