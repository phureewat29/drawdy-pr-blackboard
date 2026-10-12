/**
 * The JDK's types as Java's resolver knows them, read once from `jdk.ts`: a
 * supertype that is neither read nor listed there may hold any member.
 */

import { once } from "../../fp.ts";
import { JDK_ALIASES, JDK_EXPORTS, JDK_PACKAGES, JDK_TYPES } from "./jdk.ts";
import type { Access } from "./nodes.ts";

/** A JDK type, as far as names need it: its members and what it extends. */
export type Lib = {
    fqn: string;
    iface: boolean;
    supers: readonly string[];
    /** Whether its members are listed: false for a type the table holds for its supertypes alone. */
    members: boolean;
    /** `params`: each parameter's type as written in the table, a varargs one as its array (`java.lang.String[]`), a type variable `?`. */
    methods: readonly { name: string; n: number; varargs: boolean; access: Access; isStatic: boolean; abstract: boolean; key: string | null; params: readonly string[] }[];
    fields: ReadonlySet<string>;
    types: ReadonlySet<string>;
};

/** A line of `JDK_TYPES`. */
const libOf = (line: string): Lib => {
    const [fqn, kind, supers, methods, fields, types] = line
        .replace(/!([0-9a-z]+)/g, (_, n: string) => JDK_ALIASES[parseInt(n, 36)])
        .replace(/@([0-9a-z]+)\./g, (_, n: string) => `${JDK_PACKAGES[parseInt(n, 36)]}.`)
        .split("|");
    return {
        fqn,
        iface: kind.toLowerCase() === "i",
        supers: supers ? supers.split(",") : [],
        members: kind === "i" || kind === "c",
        methods: (methods ? methods.split(" ") : []).map((m) => {
            const flags = m.split(":");
            const sig = flags.pop()!;
            const list = sig.slice(sig.indexOf("(") + 1, -1);
            const varargs = list.endsWith("...");
            const written = list ? list.replace(/\.\.\.$/, "").split(",") : [];
            const params = written.map((p, i) => (varargs && i === written.length - 1 && p !== "?" ? `${p}[]` : p));
            const key = params.includes("?") ? null : params.join(",");
            return { name: sig.slice(0, sig.indexOf("(")), n: params.length, varargs, access: flags.includes("p") ? "protected" : "public", isStatic: flags.includes("s"), abstract: flags.includes("a"), key, params };
        }),
        fields: new Set(fields ? fields.split(" ") : []),
        types: new Set(types ? types.split(" ") : []),
    };
};

const libs = once(
    (): ReadonlyMap<string, Lib> =>
        new Map(
            JDK_TYPES.split("\n").map((line) => {
                const l = libOf(line);
                return [l.fqn, l];
            })
        )
);

/** A JDK type known, by name: `java.util.Map.Entry`. */
export const libNamed = (fqn: string): Lib | undefined => libs().get(fqn);

export const OBJECT = (): Lib => libNamed("java.lang.Object")!;

/** What an interface with no superinterface declares: Object's public methods, abstract (JLS 9.2). */
export const INTERFACE_OBJECT = once((): Lib => ({ ...OBJECT(), iface: true, methods: OBJECT().methods.filter((m) => m.access === "public").map((m) => ({ ...m, abstract: true })) }));

const exportedPackages = once(
    (): ReadonlySet<string> =>
        new Set(
            JDK_EXPORTS.split("\n").flatMap((line) => {
                const [around, names] = line.split("|");
                return names.split(" ").map((n) => `${around}.${n}`);
            })
        )
);

/**
 * Whether a package is the JDK's: java.* or one its modules export
 * (`JDK_EXPORTS`). A build takes such a package's types from the JDK
 * whatever a source root holds (netty's stubs of `com.sun.nio.sctp`).
 */
export const jdkPackage = (pkg: string): boolean => /^java(\.|$)/.test(pkg) || exportedPackages().has(pkg);

/**
 * java.lang's types since Java 8: one of these names is java.lang's once
 * every root the file sees is known to hold no type of the name in its
 * package.
 */
export const JAVA_LANG: ReadonlySet<string> = new Set(
    "AbstractMethodError Appendable ArithmeticException ArrayIndexOutOfBoundsException ArrayStoreException AssertionError AutoCloseable Boolean BootstrapMethodError Byte Character CharSequence Class ClassCastException ClassCircularityError ClassFormatError ClassLoader ClassNotFoundException ClassValue CloneNotSupportedException Cloneable Comparable Deprecated Double Enum EnumConstantNotPresentException Error Exception ExceptionInInitializerError Float FunctionalInterface IllegalAccessError IllegalAccessException IllegalArgumentException IllegalCallerException IllegalMonitorStateException IllegalStateException IllegalThreadStateException IncompatibleClassChangeError IndexOutOfBoundsException InheritableThreadLocal InstantiationError InstantiationException Integer InternalError InterruptedException Iterable LayerInstantiationException LinkageError Long Math NegativeArraySizeException NoClassDefFoundError NoSuchFieldError NoSuchFieldException NoSuchMethodError NoSuchMethodException NullPointerException Number NumberFormatException Object OutOfMemoryError Override Readable ReflectiveOperationException Runnable Runtime RuntimeException SafeVarargs SecurityException Short StackOverflowError StackTraceElement StackWalker StrictMath String StringBuffer StringBuilder StringIndexOutOfBoundsException SuppressWarnings System Thread ThreadDeath ThreadGroup ThreadLocal Throwable TypeNotPresentException UnknownError UnsatisfiedLinkError UnsupportedClassVersionError UnsupportedOperationException VerifyError VirtualMachineError Void".split(" ")
);
