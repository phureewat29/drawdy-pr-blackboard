/**
 * What the forms of Clojure's own namespaces do with the code they are
 * given: which of their parts are code, which bind locals, which are names
 * or data. A name the tables don't give a form is a function's, whose
 * arguments are code; a head of no known meaning is `unknown` (`walk.ts`).
 */

/**
 * How a form reads the forms after its head: `call`, all code, binding
 * nothing; `skip`, none of them code (`ns`, `import`); `macro`, a macro the
 * code shows whose meaning the tables don't hold; `unknown`, a head of no
 * known meaning; the rest, the form of the special form or macro of that
 * name (`let`, `fn`, `case` …).
 */
export type Shape = "call" | "skip" | "macro" | "unknown" | "var" | "def" | "defmulti" | "defn" | "fn" | "defmethod" | "let" | "if-let" | "letfn" | "binding" | "for" | "case" | "try" | "as->" | "deftype" | "extend" | "proxy" | "thread" | "steps" | "this-as" | "are" | "comment";

/** `shape name name | shape name …` as a map from name to shape. */
const table = (groups: string): ReadonlyMap<string, Shape> => new Map(groups.split("|").flatMap((g) => g.trim().split(" ").slice(1).map((n) => [n, g.trim().split(" ")[0] as Shape] as const)));

/** The special forms, which the compiler reads before any local or var of the name: no name of theirs refers to a var. `.` and `letfn*` read their forms in ways the walk doesn't follow. */
export const SPECIAL = table("def def | let let* loop* | fn fn* | unknown letfn* . | skip quote case* import* deftype* reify* js* & ns* defrecord* | var var | try try | call if do recur throw monitor-enter monitor-exit set! catch finally new");

/** clojure.core's and cljs.core's macros whose forms aren't a function call's; any other name of theirs reads as one. */
export const CORE_MACROS = table(
    "def defonce defstruct goog-define | defmulti defmulti | defn defn defn- defmacro definline | defmethod defmethod | fn fn bound-fn | let let loop with-open with-local-vars dotimes when-let when-some when-first | if-let if-let if-some | letfn letfn | binding binding with-redefs | for for doseq | case case | as-> as-> | deftype deftype defrecord | extend reify extend-type extend-protocol specify specify! | proxy proxy | thread -> ->> | steps some-> some->> cond-> cond->> doto | this-as this-as | comment comment | skip ns import refer-clojure declare defprotocol definterface gen-class gen-interface memfn | unknown with-precision proxy-super simple-benchmark amap areduce .."
);

const FUNCTIONS = table("");
/** clojure.test's macros, those whose forms are a call's listed too: a name referred whole from it is its own. */
const TEST = table("def deftest deftest- | are are | this-as async | skip set-test | call is testing with-test with-test-out try-expr run-tests run-all-tests test-var use-fixtures");

/** Namespaces outside the repository whose macros the tables know, and whose other vars are functions; in ClojureScript `clojure.test` is `cljs.test`, and so on. */
export const LIBRARIES: ReadonlyMap<string, ReadonlyMap<string, Shape>> = new Map([
    ..."string set walk edn java.io data zip instant math datafy reflect java.shell tools.logging".split(" ").map((n) => [`clojure.${n}`, FUNCTIONS] as const),
    ["clojure.test", TEST],
    ["cljs.test", TEST],
    ["clojure.spec.alpha", table("def def fdef | skip keys keys*")],
    ["clojure.core.async", table("let go-loop | unknown alt! alt!!")],
    ["clojure.pprint", table("unknown pprint-logical-block print-length-loop")],
    ["clojure.repl", table("skip doc source dir")],
]);

/** The namespaces whose vars are Clojure's own. */
export const CORE_NS = new Set(["clojure.core", "cljs.core"]);

/** The def forms the units query lists, by head name, whatever its namespace: what each defines, and the form it reads. */
export const DEFINES: ReadonlyMap<string, [string, Shape]> = new Map(
    "defn fn defn|defn- fn defn|definline fn defn|defmacro macro defn|defmulti multi defmulti|def value def|defonce value def|defprotocol protocol skip|defrecord record deftype|deftype type deftype|definterface interface skip|deftest test def|defmethod method defmethod".split("|").map((e) => {
        const [name, kind, shape] = e.split(" ");
        return [name, [kind, shape as Shape]];
    })
);

/** The forms whose bodies run when a file loads, outside any function: a def inside one at the top level is the namespace's own. */
export const LOAD_TIME = new Set("let let* letfn when when-not when-let when-some if if-not if-let if-some do binding with-redefs locking".split(" "));
