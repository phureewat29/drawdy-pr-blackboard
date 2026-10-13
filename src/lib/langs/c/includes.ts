/**
 * Which file an `#include` names. The board can't run the build, so it
 * reads the include folders the repository's build files write (`-I` flags
 * in a Makefile, CMake's and Meson's `include_directories`) in the C file's
 * folder and each folder above it; no folder is guessed from the layout.
 *
 * A quoted include is first the includer's own folder's file, as every
 * compiler looks there first. Else the file is the one found among the build
 * files' folders, when exactly one of them holds it; an angle include looks
 * there alone, as a compiler doesn't look beside the includer for one. Found
 * in several places, or a quoted one found nowhere, an include is unknown:
 * the resolver then reads it as a header it couldn't read. Where a build file
 * writes an include folder the board can't place (a variable it doesn't
 * set), the search can't be trusted: only the includer's own folder is. A
 * standard or system header (`<stdio.h>`, `<sys/types.h>`), and an angle
 * include found nowhere in a conditional's branch (a platform's header, an
 * optional library's: `#ifdef USE_LIBSSH2` / `#include <libssh2.h>`), is
 * outside the repository: never read, and never a place a repository's name
 * comes from (`reserved.ts`). An angle include found nowhere outside any
 * branch may be the repository's, through a folder the build files don't
 * show: unknown.
 *
 * The build files (`build.ts`) also write macros (`-D`, CMake's compile
 * definitions), which the resolver reads as defined in each unit they build.
 */

/** Headers of the C library, POSIX and common platforms and libraries, never looked for in the repository. */
const SYSTEM = /^(?:sys|netinet|netinet6|arpa|net|linux|asm|asm-generic|bits|gnu|mach|machine|mach-o|libkern|os|dispatch|xlocale|secure|malloc|CoreFoundation|CoreServices|Security|SystemConfiguration|IOKit|CommonCrypto|openssl|windows|winrt|android|valgrind|sanitizer|systemd|kernel|readline|editline)\/|^(?:assert|complex|ctype|errno|fenv|float|inttypes|iso646|limits|locale|math|setjmp|signal|stdalign|stdarg|stdatomic|stdbit|stdbool|stdckdint|stddef|stdint|stdio|stdlib|stdnoreturn|string|strings|tgmath|threads|time|uchar|wchar|wctype|unistd|fcntl|pthread|pthread_np|dirent|dlfcn|poll|sched|semaphore|syslog|termios|termio|utime|utmp|glob|fnmatch|grp|pwd|netdb|ifaddrs|regex|spawn|libgen|langinfo|iconv|nl_types|search|ucontext|execinfo|malloc|malloc_np|alloca|memory|io|direct|process|share|conio|windows|winsock|winsock2|ws2tcpip|ws2ipdef|wincrypt|winbase|windef|winnt|winerror|winreg|winioctl|winapifamily|wtypes|processenv|iphlpapi|mstcpip|mswsock|bcrypt|ntsecapi|schannel|security|sspi|shlwapi|shlobj|shellapi|tlhelp32|psapi|dbghelp|objbase|versionhelpers|sdkddkver|_mingw|BaseTsd|tchar|intrin|intrinsics|x86intrin|immintrin|mmintrin|xmmintrin|emmintrin|pmmintrin|tmmintrin|smmintrin|nmmintrin|wmmintrin|ammintrin|lsxintrin|lasxintrin|s390intrin|altivec|arm_neon|arm_sve|arm_acle|arm_fp16|riscv_vector|cpuid|cet|endian|byteswap|features|err|getopt|paths|resolv|libintl|link|elf|ftw|mntent|shadow|crypt|unwind|libunwind|libproc|Availability|AvailabilityMacros|TargetConditionals|ConditionalMacros)\.h$/;

/** A path with `.` and `..` segments folded, or null when it leaves the repository. */
export const normalize = (path: string): string | null => {
    const out: string[] = [];
    for (const seg of path.split("/")) {
        if (seg === "" || seg === ".") continue;
        if (seg === "..") {
            if (out.length === 0) return null;
            out.pop();
        } else out.push(seg);
    }
    return out.join("/");
};

export const dirOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const join = (dir: string, rel: string) => normalize(dir ? `${dir}/${rel}` : rel);

/** A unit's include search: the build files' include folders, and whether one of them couldn't be placed. */
export type Search = { dirs: readonly string[]; open: boolean };
export const NO_SEARCH: Search = { dirs: [], open: false };

/** Where an include may be: the includer's folder's file (a quoted include's first try), then the build files' folders, each tried; none past an open search. */
export const candidatesOf = (from: string, spec: string, angle: boolean, search: Search = NO_SEARCH): { own: string | null; others: string[] } | "system" => {
    if (!spec || /^\/|^[A-Za-z]:/.test(spec)) return "system";
    const own = angle ? null : join(dirOf(from), spec);
    // A system header, quoted or not, is looked for in the includer's folder alone, where a quoted one would be found first.
    if (SYSTEM.test(spec)) return own ? { own, others: [] } : "system";
    if (search.open) return { own, others: [] };
    const others = new Set<string>();
    for (const d of search.dirs) {
        const c = join(d, spec);
        if (c && c !== own) others.add(c);
    }
    return { own, others: [...others] };
};

/** An include outside the repository; `lenient` where only its place in a conditional's branch says so. */
export type Resolved = { kind: "file"; path: string } | { kind: "system"; lenient?: true } | { kind: "unknown"; why: string };

/** The file an include names, given what the reads learned of which paths exist (undefined: never asked). */
export const resolveInclude = (from: string, spec: string, angle: boolean, exists: (path: string) => boolean | undefined, search: Search = NO_SEARCH, conditional = false): Resolved => {
    const c = candidatesOf(from, spec, angle, search);
    if (c === "system") return { kind: "system" };
    if (c.own) {
        const own = exists(c.own);
        if (own === true) return { kind: "file", path: c.own };
        if (own === undefined) return { kind: "unknown", why: "not asked" };
    }
    if (SYSTEM.test(spec)) return { kind: "system" };
    if (search.open) return { kind: "unknown", why: "an include folder the build files don't place" };
    const found: string[] = [];
    for (const p of c.others) {
        const e = exists(p);
        if (e === undefined) return { kind: "unknown", why: "not asked" };
        if (e) found.push(p);
    }
    if (found.length === 1) return { kind: "file", path: found[0] };
    if (found.length > 1) return { kind: "unknown", why: "found in several folders" };
    // An angle include found nowhere, in a branch only some builds compile, where build files give the folders: a platform's or an optional library's header.
    return angle && conditional && search.dirs.length > 0 ? { kind: "system", lenient: true } : { kind: "unknown", why: "not found" };
};
