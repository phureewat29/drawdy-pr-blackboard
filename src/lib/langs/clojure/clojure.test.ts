import { describe, expect, it } from "@jest/globals";
import { testParse } from "../../../test/parser.ts";
import { isGeneric, type GFile } from "../../anyfacts.ts";
import { highlightLine } from "../../highlight.ts";
import { resolveAny } from "../../anylink.ts";
import { rulesOf } from "../../linking.ts";
import { CLOJURE } from "./index.ts";

/** Every reference that resolves, as `path:line ref card`; every path not given is known missing, but those in `unknown`, which the reads never asked about. */
const links = async (files: Record<string, string>, unknown: string[] = []): Promise<string[]> => {
    const parsed: GFile[] = [];
    for (const [path, text] of Object.entries(files)) {
        const f = await testParse(path, text);
        if (f && isGeneric(f)) parsed.push(f);
    }
    const exists = (path: string) => (path in files ? true : unknown.includes(path) ? undefined : false);
    const refs = resolveAny(parsed, (f) => rulesOf(f.path)!.resolver, (path) => files[path], exists);
    const labels = new Map(parsed.flatMap((f) => [...f.labels]));
    return refs.flatMap((r) => r.units.map((u) => `${r.path}:${r.line} ${r.ref} ${labels.get(u.id)}`)).sort();
};

const cards = async (path: string, text: string) => {
    const f = await testParse(path, text);
    return f ? f.units.map((u) => `${u.nameLine} ${f.labels!.get(u.id)}`) : null;
};

const DB = "(ns app.db)\n(defn find-items [db] db)\n(defn- secret [] 1)\n(defmacro with-db [db & body] `(do ~@body))\n";

describe("Clojure units", () => {
    it("are the def forms the units query lists, by head name, at the top level, in a reader conditional's branch, or in a form load time runs", async () => {
        const text = [
            "(ns app.a)",
            "(defn f [x] x)",
            "(def ^:private v 1)",
            "(defrecord Rec [a])",
            "(defprotocol Store (fetch [this]))",
            "(defmulti area :shape)",
            "(defmethod area :circle [c] 1)",
            "(mu/defn g :- :int [x :- :int] x)",
            "#?(:clj (defn h [] 1))",
            "(let [k 1] (defn nested [] k))",
            "(comment (defn scratch [] 1))",
            "(s/def ::spec int?)",
        ].join("\n");
        expect(await cards("src/app/a.cljc", text)).toEqual(["2 f()", "3 v", "4 record Rec", "5 protocol Store", "6 area()", "7 area :circle", "8 g()", "9 h()", "10 nested()"]);
    });

    it("parse a file with a raw NUL character in a string", async () => {
        expect(await cards("src/app/a.clj", '(ns app.a)\n(defn f [] "a\u0000b")\n(defn g [] (f))\n')).toEqual(["2 f()", "3 g()"]);
    });
});

describe("Clojure's own vars", () => {
    it("link a name to the namespace's one def above it, a `declare`d one to its def, and a call in the def itself", async () => {
        const found = await links({ "src/app/a.clj": "(ns app.a)\n(declare later)\n(defn helper [x] (helper x))\n(defn run [] (helper 1) (later))\n(defn later [] 2)\n" });
        expect(found).toEqual(["src/app/a.clj:3 call helper()", "src/app/a.clj:4 call helper()", "src/app/a.clj:4 call later()"]);
    });

    it("link nothing to a def below its use, defined twice, or that a form of unknown meaning may define again", async () => {
        const found = await links({
            "src/app/a.clj": "(ns app.a (:require [app.settings :refer [defsetting]]))\n(defn run [] (later) (twice) (setting))\n(defn later [] 1)\n(defn twice [] 1)\n(defn twice [] 2)\n(defn setting [] 1)\n(defsetting setting :default 1)\n(defn after [] (twice) (setting))\n",
        });
        expect(found).toEqual([]);
    });

    it("leave a name a local binds: let, fn, loop, for, letfn, catch, destructuring, `#(%)`, a record's fields", async () => {
        const text = [
            "(ns app.a)",
            "(defn x [] 1)",
            "(defn y [] 2)",
            "(defn r1 [] (let [x 1 y (x)] (y)))",
            "(defn r2 [x] (x))",
            "(defn r3 [{:keys [x y] :or {y (x)}}] (x) (y))",
            "(defn r4 [] (for [x [1] :let [y x]] (y)) (doseq [[x & y] []] (x)) (loop [x 1] (x)))",
            "(defn r5 [] (letfn [(x [] (y)) (y [] 1)] (x)) (try 1 (catch Exception x (x))) #(% x))",
            "(defrecord R [x] Object (toString [_] (x)))",
            "(defn r6 [] (as-> 1 x (x)) (fn y [] (y)) (dotimes [x 3] (x)))",
        ].join("\n");
        expect(await links({ "src/app/a.clj": text })).toEqual(["src/app/a.clj:8 value x()"]);
    });

    it("read every special form before a var of its name: a function named `def` is never `(def …)`", async () => {
        const found = await links({ "src/app/a.clj": "(ns app.a\n  (:refer-clojure :exclude [def]))\n(defn def [k v] [k v])\n(def x 1)\n(defn run [] x)\n" });
        expect(found).toEqual(["src/app/a.clj:5 value x"]);
    });
});

describe("Clojure's namespaces", () => {
    it("link `alias/f`, a `:refer`, a whole name the `ns` form requires, and `#'alias/private`", async () => {
        const found = await links({
            "src/app/db.clj": DB,
            "src/app/core.clj": "(ns app.core\n  (:require [app.db :as db :refer [find-items]]))\n(defn run [x] (db/find-items x) (find-items x) (app.db/find-items x) (#'db/secret))\n",
        });
        expect(found).toEqual(["src/app/core.clj:2 import find-items()", "src/app/core.clj:3 call find-items()", "src/app/core.clj:3 call find-items()", "src/app/core.clj:3 call find-items()", "src/app/core.clj:3 value secret()"]);
    });

    it("link nothing through a whole name no `ns` form requires, a namespace not read, a file of another namespace, or an odd `ns` form", async () => {
        expect(await links({ "src/app/db.clj": DB, "src/app/core.clj": "(ns app.core)\n(defn run [x] (app.db/find-items x))\n" })).toEqual([]);
        expect(await links({ "src/app/core.clj": "(ns app.core (:require [app.db :as db]))\n(defn run [x] (db/find-items x))\n" }, ["src/app/db.clj"])).toEqual([]);
        expect(await links({ "src/app/db.clj": "(ns app.other)\n(defn find-items [x] x)\n", "src/app/core.clj": "(ns app.core (:require [app.db :as db]))\n(defn run [x] (db/find-items x))\n" })).toEqual([]);
        expect(await links({ "src/app/a.clj": "(ns app.a (:load \"b\"))\n(defn f [] 1)\n(defn g [] (f))\n" })).toEqual([]);
    });

    it("link `:refer :all` and `:use` to the one namespace giving the name, a renamed var by its new name only, never an excluded or private one", async () => {
        const found = await links({
            "src/app/db.clj": DB,
            "src/app/util.clj": "(ns app.util)\n(defn helper [] 1)\n",
            "src/app/core.clj": "(ns app.core\n  (:require [app.db :refer :all])\n  (:use [app.util :rename {helper h}]))\n(defn run [] (find-items 1) (h) (helper) (secret))\n",
        });
        expect(found).toEqual(["src/app/core.clj:4 call find-items()", "src/app/core.clj:4 call helper()"]);
    });

    it("find a namespace in the file's own root, or from a test root in the main one, only when one root holds it; `.clj` before `.cljc` in Clojure", async () => {
        const test = "(ns app.db-test (:require [app.db :as db]))\n(defn t [] (db/find-items 1))\n";
        expect(await links({ "src/app/db.clj": DB, "test/app/db_test.clj": test })).toEqual(["test/app/db_test.clj:2 call find-items()"]);
        expect(await links({ "src/app/db.clj": DB, "test/app/db.clj": DB, "test/app/db_test.clj": test })).toEqual([]);
        expect(await links({ "src/app/db.cljc": DB, "test/app/db_test.clj": test }, ["src/app/db.clj"])).toEqual([]);
        expect(await links({ "src/app/db.cljc": DB, "src/app/db.clj": "(ns app.db)\n(defn find-items [x] x)\n", "test/app/db_test.clj": test })).toEqual(["test/app/db_test.clj:2 call find-items()"]);
        // Another module's root is no root the file sees.
        expect(await links({ "common/src/app/db.clj": DB, "backend/src/app/core.clj": "(ns app.core (:require [app.db :as db]))\n(defn run [] (db/find-items 1))\n" })).toEqual([]);
    });
});

describe("Clojure's macros and forms", () => {
    it("link no unqualified name inside a form whose head may be a macro of unknown meaning; `alias/f` there still links", async () => {
        const found = await links({
            "src/app/db.clj": DB,
            "src/app/core.clj": "(ns app.core (:require [app.db :as db] [toucan2.core :as t2]))\n(defn helper [] 1)\n(defn run []\n  (db/with-db 1 (helper) (db/find-items 1))\n  (t2/select (helper))\n  (-> 1 (db/with-db) helper))\n",
        });
        expect(found).toEqual(["src/app/core.clj:4 call find-items()", "src/app/core.clj:4 call with-db()", "src/app/core.clj:6 call with-db()"]);
    });

    it("read the standard namespaces' forms: clojure.test's `is` and `testing` are code, `are` binds its names", async () => {
        const found = await links({
            "test/app/a_test.clj": "(ns app.a-test (:require [clojure.test :refer [deftest is testing are]] [clojure.string :as str]))\n(defn helper [] 1)\n(deftest t (testing \"x\" (is (= 1 (helper)))) (str/join (helper)) (are [helper] (= helper 1) 1))\n",
        });
        expect(found).toEqual(["test/app/a_test.clj:3 call helper()", "test/app/a_test.clj:3 call helper()"]);
    });

    it("read a def head the units query lists by name, `mu/defn` too: its parameters and `:- schema`s", async () => {
        const found = await links({ "src/app/a.clj": "(ns app.a (:require [metabase.util.malli :as mu]))\n(def Schema :int)\n(mu/defn f :- Schema [x :- Schema] (f x))\n" });
        expect(found).toEqual(["src/app/a.clj:3 call f()", "src/app/a.clj:3 value Schema", "src/app/a.clj:3 value Schema"]);
    });

    it("link no protocol method, no multimethod's method, nor a quoted, `resolve`d, `case` or `memfn` name; a protocol, a record's constructor and the multimethod itself link", async () => {
        const text = [
            "(ns app.a)",
            "(defprotocol Store (fetch [this]))",
            "(defrecord Mem [m] Store (fetch [_] m))",
            "(defmulti area :shape)",
            "(defmethod area :circle [c] 1)",
            "(defn helper [] 1)",
            "(defn run [s] (fetch s) (area s) (->Mem 1) (map->Mem {}) (Mem. 1) (satisfies? Store s) 'helper (resolve 'helper) (case s helper 1 2) (memfn helper))",
        ].join("\n");
        expect(await links({ "src/app/a.clj": text })).toEqual(["src/app/a.clj:3 value protocol Store", "src/app/a.clj:7 call area()", "src/app/a.clj:7 call record Mem", "src/app/a.clj:7 call record Mem", "src/app/a.clj:7 call record Mem", "src/app/a.clj:7 value protocol Store"]);
    });

    it("link a syntax quote's names as the reader reads them: a var defined above, never a local", async () => {
        const found = await links({ "src/app/a.clj": "(ns app.a)\n(defn helper [] 1)\n(defmacro m [helper] `(helper ~helper))\n(defmacro early [] `(later))\n(defn later [] 1)\n" });
        expect(found).toEqual(["src/app/a.clj:3 value helper()"]);
    });

    it("leave interop, and a `comment` form, which never runs", async () => {
        const found = await links({ "src/app/a.clj": "(ns app.a)\n(defn helper [] 1)\n(defn run [x] (.helper x) (Math/abs x) (. x helper) (comment (helper)))\n(comment (helper) (in-ns 'other) (helper))\n" });
        expect(found).toEqual([]);
    });
});

describe("Clojure's platforms", () => {
    it("link a `.cljc` site only where every platform reading it names one def", async () => {
        const found = await links({
            "src/app/x.cljc": "(ns app.x)\n(defn f [] 1)\n",
            "src/app/y.cljc": "(ns app.y)\n(defn f [] 2)\n",
            "src/app/a.cljc": "(ns app.a (:require #?(:clj [app.x :as m] :cljs [app.y :as m])))\n(defn run [] (m/f) #?(:clj (m/f)))\n",
        });
        expect(found).toEqual(["src/app/a.cljc:2 call f()"]);
    });

    it("take ClojureScript's macros from the namespace's Clojure file; one a `.cljc` file defines for both is no one def", async () => {
        const found = await links({
            "src/app/m.clj": "(ns app.m)\n(defmacro m [x] x)\n",
            "src/app/ui.cljs": "(ns app.ui (:require-macros [app.m :refer [m]]))\n(defn run [] (m 1))\n",
            "src/app/n.cljc": "(ns app.n)\n#?(:clj (defmacro n [x] x) :cljs (defmacro n [x] x))\n",
            "src/app/ui2.cljs": "(ns app.ui2 (:require-macros [app.n :refer [n]]))\n(defn run [] (n 1))\n",
        });
        expect(found).toEqual(["src/app/ui.cljs:1 import m()", "src/app/ui.cljs:2 call m()"]);
    });
});

describe("Clojure's pack", () => {
    it("colours a string, never a quoted form, as one", () => {
        expect(highlightLine("(require '[a.b :as b]) (def x \"it's\")", "clj", { inBlock: false })).toBe('(require &#39;[a.b :as b]) (<span class="k">def</span> x <span class="s">&quot;it&#39;s&quot;</span>)');
    });

    it("names test cases by `deftest` and groups them by `testing`", () => {
        expect(CLOJURE.cases!('(deftest ^:parallel find-items-test', undefined)).toEqual({ name: "find-items-test", group: false });
        expect(CLOJURE.cases!('  (t/testing "empty store"', undefined)).toEqual({ name: "empty store", group: true });
        expect(CLOJURE.cases!("(defn helper [])", undefined)).toBeUndefined();
    });
});

describe("What the files can't show", () => {
    it("keep an unknown head unknown where a `require` may refer it, a wrapper's too; a `case` constant, a def's name, the file's own `load` and another namespace's don't count, nor `load` in ClojureScript", async () => {
        const found = await links({
            "src/app/a.clj": "(ns app.a (:refer-clojure :exclude [load]) (:require [app.yaml :as yaml]))\n(defn helper [] 1)\n(defn load [x] x)\n(defn run [x] (case x (require use) 1 2) (load 1) (yaml/load 2) (when true (helper)))\n",
            "src/app/b.clj": "(ns app.b (:require [app.classloader :as classloader]))\n(defn helper [] 1)\n(defn setup [] (classloader/require 'app.m))\n(defn run [] (when true (helper)))\n",
            "src/app/c.cljs": "(ns app.c)\n(defn helper [] 1)\n(defn run [] (load \"x\") (when true (helper)))\n",
        });
        expect(found).toEqual(["src/app/a.clj:4 call helper()", "src/app/a.clj:4 call load()", "src/app/c.cljs:3 call helper()"]);
    });

    it("read a `require` of quoted names as loading only; one with `:as`, or `alias`, may shadow a namespace's whole name", async () => {
        const found = await links({
            "src/app/db.clj": "(ns app.db)\n(defn f [] 1)\n",
            "src/app/a.clj": "(ns app.a (:require [app.db]))\n(require 'app.x :reload)\n(defn helper [] 1)\n(defn run [] (when true (helper)) (app.db/f))\n",
            "src/app/b.clj": "(ns app.b (:require [app.db :as db]))\n(require '[app.x :as x])\n(defn run [] (db/f) (app.db/f))\n",
        });
        expect(found).toEqual(["src/app/a.clj:4 call f()", "src/app/a.clj:4 call helper()", "src/app/b.clj:3 call f()"]);
    });

    it("read every var of a file that may set `:macro` (`alter-meta!`) as a macro", async () => {
        const found = await links({
            "src/app/m.clj": "(ns app.m)\n(defn my-let [&form &env bs & body] `(let ~bs ~@body))\n(alter-meta! #'my-let assoc :macro true)\n",
            "src/app/a.clj": "(ns app.a (:require [app.m :as m]))\n(defn helper [] 1)\n(defn run [] (m/my-let [helper (fn [] 2)] (helper)))\n",
        });
        expect(found).toEqual(["src/app/a.clj:3 call my-let()", "src/app/m.clj:3 value my-let()"]);
    });

    it("refer what `clojure.core/refer` refers: `:use`'s `:refer` before its `:only`, nothing for `:require`'s `:only`", async () => {
        const found = await links({
            "src/app/util.clj": "(ns app.util)\n(defn helper [] 1)\n(defn update [m] m)\n",
            "src/app/core.clj": "(ns app.core (:use [app.util :refer [helper] :only [update]]))\n(defn run [m] (helper) (update m :a inc))\n",
            "src/app/core2.clj": "(ns app.core2 (:require [app.util :only [helper]]))\n(defn run [] (helper))\n",
        });
        expect(found).toEqual(["src/app/core.clj:1 import helper()", "src/app/core.clj:2 call helper()"]);
    });

    it("link a private var's name where a macro of unknown meaning may take it as a var (`with-redefs`' kind), never in plain code", async () => {
        const found = await links({
            "src/app/db.clj": "(ns app.db)\n(defn- secret [] 1)\n",
            "test/app/db_test.clj": "(ns app.db-test (:require [app.db :as db] [app.test :as mt]))\n(defn t [] (mt/with-dynamic-fn-redefs [db/secret (constantly 2)] 1) (db/secret))\n",
        });
        expect(found).toEqual(["test/app/db_test.clj:2 value secret()"]);
    });

    it("read a core name `:refer-clojure` renames away as unknown, and its new name as the core var", async () => {
        const found = await links({ "src/app/a.clj": "(ns app.a (:refer-clojure :rename {when core-when}))\n(defn helper [] 1)\n(defn run [] (when true (helper)) (core-when true (helper)))\n" });
        expect(found).toEqual(["src/app/a.clj:3 call helper()"]);
    });

    it("link a def's own name in its body and after it in the same top-level form, never before it", async () => {
        const found = await links({ "src/app/a.clj": "(ns app.a)\n(let [orig helper] (defn helper [] (orig)))\n(do (defn fib [n] (fib n)) (fib 1))\n" });
        expect(found).toEqual(["src/app/a.clj:3 call fib()", "src/app/a.clj:3 call fib()"]);
    });
});

describe("What other files read do as the file loads", () => {
    it("keep `eval` to its own file, which proves nothing, since its forms are code the files show; `(eval (read-string …))` runs code from text, as `load` does, in its callers too", async () => {
        const found = await links({
            "src/app/util.clj": "(ns app.util)\n(defn run-forms [forms] (doseq [f forms] (eval f)))\n(defn run-text [s] (eval (read-string s)))\n",
            "src/app/a.clj": "(ns app.a (:require [app.util :as u]))\n(u/run-forms [])\n(defn helper [] 1)\n(defn run [] (when true (helper)))\n",
            "src/app/b.clj": "(ns app.b (:require [app.util :as u]))\n(u/run-text \"\")\n(defn helper [] 1)\n(defn run [] (when true (helper)))\n",
        });
        expect(found).toEqual(["src/app/a.clj:4 call helper()"]);
    });

    it("count a quoted name where `resolve` finds it or a macro builds a form of it, not in data", async () => {
        const found = await links({
            "src/app/a.clj": "(ns app.a)\n(def syms '#{require load alias})\n(defn req? [x] (= 'require x))\n(defn helper [] 1)\n(defn run [] (when true (helper)))\n",
            "src/app/b.clj": "(ns app.b)\n(defmacro m [] (list 'require ''[app.x :refer [y]]))\n(defn helper [] 1)\n(defn run [] (when true (helper)))\n",
        });
        expect(found).toEqual(["src/app/a.clj:5 call helper()"]);
    });

    it("follow a function another file defines into the code that calls it as the file loads, not from a function's body or a value a def holds", async () => {
        const found = await links({
            "src/app/util.clj": "(ns app.util)\n(defn setup [] (require '[app.m :refer [my-let]]))\n",
            "src/app/a.clj": "(ns app.a (:require [app.util :as u]))\n(defn helper [] 1)\n(defn later [] (u/setup))\n(def f u/setup)\n(defn run [] (when true (helper)))\n",
            "src/app/b.clj": "(ns app.b (:require [app.util :as u]))\n(u/setup)\n(defn helper [] 1)\n(defn run [] (when true (helper)))\n",
        });
        expect(found).toEqual(["src/app/a.clj:3 call setup()", "src/app/a.clj:4 value setup()", "src/app/a.clj:5 call helper()", "src/app/b.clj:2 call setup()"]);
    });

    it("read a syntax quote's code where the macro puts it: in its callers as they load, not in its own file", async () => {
        const found = await links({
            "src/app/m.clj": "(ns app.m)\n(defmacro with-tools [] `(require '[app.t :refer [tool]]))\n(defn helper [] 1)\n(defn run [] (when true (helper)))\n",
            "src/app/a.clj": "(ns app.a (:require [app.m :as m]))\n(m/with-tools)\n(defn helper [] 1)\n(defn run [] (when true (helper)))\n",
        });
        expect(found).toEqual(["src/app/a.clj:2 call with-tools()", "src/app/m.clj:4 call helper()"]);
    });

    it("prove no var another file read may `intern` into its namespace", async () => {
        const found = await links({
            "src/app/m.clj": "(ns app.m)\n(defn my-let [] 1)\n(defn other [] 2)\n",
            "src/app/init.clj": "(ns app.init (:require [app.m]))\n(intern 'app.m 'my-let (fn [] 3))\n",
            "src/app/a.clj": "(ns app.a (:require [app.m :as m]))\n(defn run [] (m/my-let) (m/other))\n",
        });
        expect(found).toEqual(["src/app/a.clj:2 call other()"]);
    });

    it("make no macro of an `alter-meta!` that edits other keys; after `ns-unalias`, prove no qualified name", async () => {
        const found = await links({
            "src/app/m.clj": "(ns app.m)\n(defn helper [] 1)\n(defn wrap [x] x)\n(alter-meta! #'wrap assoc :doc \"d\" :private false)\n",
            "src/app/a.clj": "(ns app.a (:require [app.m :as m]))\n(defn run [] (m/wrap (m/helper)))\n",
            "src/app/b.clj": "(ns app.b (:require [app.m :as m]))\n(ns-unalias *ns* 'm)\n(defn run [] (m/helper))\n",
        });
        expect(found).toEqual(["src/app/a.clj:2 call helper()", "src/app/a.clj:2 call wrap()", "src/app/m.clj:4 value wrap()"]);
    });
});

describe("Threading, scopes and code built of names", () => {
    it("read each step of a threading macro with the value it gets: `as->` binds its name, `case` keeps its constants, and a step that reads its value as code keeps `->` open", async () => {
        const found = await links({
            "src/app/a.clj": "(ns app.a)\n(defn q [] 1)\n(defn k [] 2)\n(defn helper [] 3)\n(defn run [m] (-> m (as-> q (assoc q :a (helper)))) (some-> m (case k 1 (helper))) (-> m (cond-> true (assoc :b 1)) (helper)))\n",
        });
        expect(found).toEqual(["src/app/a.clj:5 call helper()", "src/app/a.clj:5 call helper()", "src/app/a.clj:5 call helper()"]);
    });

    it("link the name `if-let`'s else branch and an `:or` default use, which their locals don't cover", async () => {
        const found = await links({ "src/app/a.clj": "(ns app.a)\n(defn x [] 1)\n(defn run [m] (if-let [x (:x m)] (x) (x)) (let [{:keys [y] :or {y (x)}} m] y))\n" });
        expect(found).toEqual(["src/app/a.clj:3 call x()", "src/app/a.clj:3 call x()"]);
    });

    it("count a function's quoted names only for code that builds code of them, and a name a macro puts after `'quote` as data", async () => {
        const found = await links({
            "src/app/dev.clj": "(ns app.dev)\n(defn names [] '[require load])\n(defmacro table [] (list 'quote 'load))\n",
            "src/app/a.clj": "(ns app.a (:require [app.dev :as d]))\n(d/names)\n(d/table)\n(defn helper [] 1)\n(defn run [] (when true (helper)))\n",
        });
        expect(found).toEqual(["src/app/a.clj:2 call names()", "src/app/a.clj:3 call table()", "src/app/a.clj:5 call helper()"]);
    });

    it("count `ns-map` of `*ns*` and `ns-publics` of clojure.core, which hold `require`, not another namespace's publics", async () => {
        const found = await links({
            "src/app/a.clj": "(ns app.a)\n(defn helper [] 1)\n(def vs (ns-publics 'app.other))\n(defn run [] (when true (helper)))\n",
            "src/app/b.clj": "(ns app.b)\n(defn helper [] 1)\n(def m (ns-map *ns*))\n(defn run [] (when true (helper)))\n",
        });
        expect(found).toEqual(["src/app/a.clj:4 call helper()"]);
    });

    it("make any var of a namespace a macro where `.setMacro` takes `(ns-resolve 'ns name)` of a name not written out", async () => {
        const found = await links({
            "src/app/m.clj": "(ns app.m)\n(defn f [x] x)\n(defn g [x] x)\n",
            "src/app/init.clj": "(ns app.init (:require [app.m]))\n(defn mark! [n] (.setMacro (ns-resolve 'app.m n)))\n",
            "src/app/a.clj": "(ns app.a (:require [app.m :as m]))\n(defn helper [] 1)\n(defn run [] (m/f (helper)) (m/g (helper)))\n",
        });
        expect(found).toEqual(["src/app/a.clj:3 call f()", "src/app/a.clj:3 call g()"]);
    });

    it("run no function a def holds in a literal (`(def handlers {:k f})`), and no code a syntax quote only builds", async () => {
        const found = await links({
            "src/app/util.clj": "(ns app.util)\n(defn setup [] (require '[app.m :refer [my-let]]))\n",
            "src/app/a.clj": "(ns app.a (:require [app.util :as u]))\n(def handlers {:setup u/setup})\n(defn helper [] 1)\n(defn run [] (when true (helper)))\n",
            "src/app/b.clj": "(ns app.b)\n(defn helper [] 1)\n(defn remote-code [s] `(eval (read-string ~s)))\n(defn run [] (when true (helper)))\n",
        });
        expect(found).toEqual(["src/app/a.clj:2 value setup()", "src/app/a.clj:4 call helper()", "src/app/b.clj:4 call helper()"]);
    });
});

/** A case's files, each after a `;;; path` line. */
const split = (text: string): Record<string, string> => {
    const files: Record<string, string> = {};
    let path = "";
    for (const line of text.split("\n")) {
        const m = /^;;; (\S+)$/.exec(line);
        if (m) files[(path = m[1])] = "";
        else if (path) files[path] += (files[path] ? "\n" : "") + line;
    }
    return files;
};

/** The adversarial review's cases (2026-10-12), each with every line it draws: right, or none. */
const REVIEW: [string, string, string[]][] = [
    [
        "a1: under `:use` or `:refer :all`, `:rename` leaves the old name to clojure.core",
        `;;; src/app/util.clj
(ns app.util)
(defn update [m k f] m)
(defn helper [] 1)
;;; src/app/core.clj
(ns app.core
  (:use [app.util :rename {update u-update}]))
(defn run [m] (update m :a inc) (u-update m :a inc) (helper))
;;; src/app/core2.clj
(ns app.core2
  (:require [app.util :refer :all :rename {update upd}]))
(defn run [m] (update m :a inc) (upd m :a inc) (helper))`,
        [
            "src/app/core.clj:3 call helper()",
            "src/app/core.clj:3 call update()",
            "src/app/core2.clj:3 call helper()",
            "src/app/core2.clj:3 call update()",
        ],
    ],
    [
        "a2: a private var gets no line through an alias or a refer in Clojure; `#'` keeps it, and ClojureScript only warns",
        `;;; src/app/db.clj
(ns app.db)
(defn- secret [] 1)
(def ^:private hidden 2)
(defn ^:private meta-secret [] 3)
(defn open-fn [] 4)
;;; src/app/core.clj
(ns app.core (:require [app.db :as db :refer [secret open-fn]]))
(defn run [] (db/secret) db/hidden (db/meta-secret) (secret) @#'db/secret (open-fn))
;;; src/app/ui.cljs
(ns app.ui (:require [app.shared :as sh]))
(defn run [] (sh/priv))
;;; src/app/shared.cljs
(ns app.shared)
(defn- priv [] 1)`,
        [
            "src/app/core.clj:1 import open-fn()",
            "src/app/core.clj:2 call open-fn()",
            "src/app/core.clj:2 value secret()",
            "src/app/ui.cljs:2 call priv()",
        ],
    ],
    [
        "a3: `:exclude` applies to an explicit `:refer` or `:only` list",
        `;;; src/app/util.clj
(ns app.util)
(defn update [m k f] m)
(defn helper [] 1)
;;; src/app/core.clj
(ns app.core (:require [app.util :refer [update helper] :exclude [update]]))
(defn run [m] (update m :a inc) (helper))
;;; src/app/core2.clj
(ns app.core2 (:use [app.util :only [update helper] :exclude [update]]))
(defn run [m] (update m :a inc) (helper))`,
        [
            "src/app/core.clj:1 import helper()",
            "src/app/core.clj:2 call helper()",
            "src/app/core2.clj:1 import helper()",
            "src/app/core2.clj:2 call helper()",
        ],
    ],
    [
        "b1: every binding form's locals",
        `;;; src/app/a.clj
(ns app.a)
(defn x [] 1)
(defn y [] 2)
(defn z [] 3)
(defn r1 [] (let [#_x y 1] (y)))
(defn r2 [#_x y] (y))
(defn r3 [m] (let [{:keys [#_x y]} m] (y)))
(defn r4 [#^String x ^long z] (x) (z))
(defn r5 [{:keys [app.b/x]} {:app.a/keys [y]} {::keys [z]}] (x) (y) (z))
(defn r6 [m] (let [{x :x :or {x 1}} m] (x)))
(defn r7 [& {:keys [x]}] (x))
(defn r8 [x] {:pre [(x)]} (x))
(defn r9 [[x y] {:keys [z]}] (x) (y) (z))
(defn r10 [c] (loop [[x & y] c] (x) (y)))
(defn r11 [xs] (doseq [x xs :let [y x] :when (y)] (x)))
(defn r12 [m] (for [[x y] m] [(x) (y)]))
(defn r13 [] (try 1 (catch Exception x (x)) (catch :default y (y))))
(defn r14 [x] (cond-> x (x) (x)))
(defn r15 [& z] (z))
(defn r16 [] (let [^long x 1 ^{:tag long} y 2] (x) (y)))
(defn r17 ^String [x] (x))
(defn r18 "doc" {:added 1} ([x] (x)) ([x y] (y)))
(defn r19 [] (with-local-vars [x 1] (x)))
(defn r20 [] (if-let [x 1] (x) (y)))
(defn r21 [] (when-some [{:keys [x]} {}] (x)))
(defn r22 [] (when-first [x [1]] (x)))
(defn r23 [] (with-open [x (y) z (x)] (z)))
(defn r24 [] (dotimes [x 3] (x)))
(defn r25 [] (condp = 1 2 :>> (fn [x] (x)) 3))
(defn r26 [] (letfn [(x [y] (y))] (x 1)))
(defn r27 [] (let [{[x] :v} {}] (x)))
(defn r28 [] (let [{:syms [x] :strs [y]} {}] (x) (y)))
(defn r29 [] (let [x 1, y 2] (x) (y)))
(defn r30 [] (fn* [x] (x)))
(defn r31 [] (let* [x 1] (x)))
(defn r32 [] (loop* [x 1] (x)))
(defn r33 [] (letfn* [x (fn* [] 1)] (x)))
(defn r34 [] (some->> 1 (x)))
(defn r35 [] (as-> 1 {:keys [x]} (x)))
(defn r36 [] (binding [x (fn [] 1)] (x)))
(defn r37 [] (with-redefs [x (fn [] 1)] (x)))`,
        [
            "src/app/a.clj:24 call y()",
            "src/app/a.clj:27 call y()",
            "src/app/a.clj:38 call x()",
            "src/app/a.clj:40 call x()",
            "src/app/a.clj:40 value x()",
            "src/app/a.clj:41 call x()",
            "src/app/a.clj:41 value x()",
        ],
    ],
    [
        "c1: special forms before vars of their name; a record's class and constructors",
        `;;; src/app/a.clj
(ns app.a (:refer-clojure :exclude [fn let update]))
(defn fn [x] x)
(defn let [v] v)
(defn update [x] x)
(defn run [] (fn [1]) (let [2]) (update 1) (new Object) (var update))
(defrecord Foo [a])
(defn mk [] (new Foo 1) (Foo. 1) (->Foo 1) Foo (instance? Foo 1))`,
        [
            "src/app/a.clj:5 call fn()",
            "src/app/a.clj:5 call let()",
            "src/app/a.clj:5 call update()",
            "src/app/a.clj:5 value update()",
            "src/app/a.clj:7 call record Foo",
            "src/app/a.clj:7 call record Foo",
            "src/app/a.clj:7 value record Foo",
            "src/app/a.clj:7 value record Foo",
            "src/app/a.clj:7 value record Foo",
        ],
    ],
    [
        "d1: prefix lists, `:as-alias`, `require` and `alias` outside the `ns` form, `in-ns`, an alias named like a namespace",
        `;;; src/app/db.clj
(ns app.db)
(defn find-items [x] x)
(defn helper [] 1)
;;; src/app/util.clj
(ns app.util)
(defn helper [] 2)
(defn other [] 3)
;;; src/app/c1.clj
(ns app.c1 (:require [app.db :as-alias db]))
(defn run [] (db/find-items 1))
;;; src/app/c2.clj
(ns app.c2 (:require [app [db :as d] [util :refer [other]]]))
(defn run [] (d/find-items 1) (other))
;;; src/app/c3.clj
(ns app.c3 (:require (app [db :as d])))
(defn run [] (d/find-items 1))
;;; src/app/c4.clj
(ns app.c4)
(require '[app.db :as db])
(defn run [] (db/find-items 1) (app.db/find-items 1))
;;; src/app/c5.clj
(ns app.c5)
(alias 'db 'app.db)
(defn run [] (db/find-items 1))
;;; src/app/c6.clj
(ns app.c6 (:require [app.db :refer :all :exclude [helper]] [app.util :refer :all]))
(defn run [] (helper) (find-items 1) (other))
;;; src/app/c7.clj
(ns app.c7 (:use [app.util :only [helper]]))
(defn run [] (helper) (other))
;;; src/app/c8.clj
(ns app.c8 (:require [app.db :as db]))
(defn run [db] (db/find-items db))
(in-ns 'app.db)
(defn x [] (find-items 1) (helper))
;;; src/app/c9.clj
(ns app.c9 (:require [app.db :as app.util]))
(defn run [] (app.util/find-items 1) (app.util/other))
;;; src/app/c10.clj
(ns app.c10 (:require [app.db :refer [helper]] [app.util :as u]))
(defn helper [] 9)
(defn run [] (helper) (u/helper))`,
        [
            "src/app/c10.clj:1 import helper()",
            "src/app/c10.clj:3 call helper()",
            "src/app/c2.clj:1 import other()",
            "src/app/c2.clj:2 call find-items()",
            "src/app/c2.clj:2 call other()",
            "src/app/c3.clj:2 call find-items()",
            "src/app/c6.clj:2 call find-items()",
            "src/app/c6.clj:2 call helper()",
            "src/app/c6.clj:2 call other()",
            "src/app/c7.clj:1 import helper()",
            "src/app/c7.clj:2 call helper()",
            "src/app/c8.clj:2 call find-items()",
            "src/app/c9.clj:2 call find-items()",
        ],
    ],
    [
        "e1: redefinitions, `declare`, and defs in `#_` or a `comment` form",
        `;;; src/app/a.clj
(ns app.a)
(declare f)
(defn g [] (f) (h) (k) (m) (n) (o))
(defn f [] 1)
(defn h [] 1)
(defn h [] 2)
(defonce k 1)
(def k 2)
(let [] #_(defn m [] 1))
(defn m [] 2)
#_#_(defn n [] 1) (defn n [] 2)
(defn n [] 3)
(when true (comment (defn o [] 1)))
(defn o [] 2)
(defn use-after [] (f) (h) (k) (m) (n) (o))`,
        [
            "src/app/a.clj:15 call f()",
            "src/app/a.clj:15 call m()",
            "src/app/a.clj:15 call n()",
            "src/app/a.clj:15 call o()",
            "src/app/a.clj:3 call f()",
        ],
    ],
    [
        "f1: a `.cljc` file's platforms and `:default`",
        `;;; src/app/x.cljc
(ns app.x)
#?(:clj (defn f [] 1))
(defn g [] (f))
#?@(:clj [(defn h [] 1)] :cljs [(defn h [] 2)])
(defn k [] #?(:clj (h)) (h))
#?(:default (defn d [] 2) :clj (defn d [] 1))
(defn use-d [] (d))
#?(:clj (defn e [] 1) :default (defn e [] 2))
(defn use-e [] (e))
;;; src/app/y.clj
(ns app.y)
(defn f [] 1)
;;; src/app/y.cljs
(ns app.y)
(defn f [] 2)
;;; src/app/z.cljc
(ns app.z (:require [app.y :as y :refer [f]]))
(defn run [] (y/f) (f))
;;; src/app/w.clj
(ns app.w (:require [app.y :as y]))
(defn run [] (y/f))
;;; src/app/v.cljs
(ns app.v (:require [app.y :as y]))
(defn run [] (y/f))`,
        [
            "src/app/v.cljs:2 call f()",
            "src/app/w.clj:2 call f()",
            "src/app/x.cljc:5 call h()",
            "src/app/x.cljc:7 call d()",
        ],
    ],
    [
        "g1: a macro's forms hide their names, threaded ones too",
        `;;; src/app/m.clj
(ns app.m)
(defmacro my-let [bs & body] \`(let ~bs ~@body))
(defn helper [] 1)
(defn a [] 1)
;;; src/app/a.clj
(ns app.a (:require [app.m :as m :refer [my-let]]))
(defn helper [] 2)
(defn a [] 3)
(defn run []
  (my-let [helper 1] (helper))
  (m/my-let [a 1] (a))
  (-> [a 1] (my-let (a)))
  (some-> [helper 1] (m/my-let (helper)))
  (doto [a 1] (my-let (a))))
(defmacro local-mac [x] x)
(defn run2 [] (local-mac [a 1] (a)) (later-mac (a)))
(defmacro later-mac [x] x)
(def ^:macro dm (fn [&form &env x] x))
(defn run3 [] (dm (a)))`,
        [
            "src/app/a.clj:1 import my-let()",
            "src/app/a.clj:11 call local-mac()",
            "src/app/a.clj:14 call dm",
            "src/app/a.clj:5 call my-let()",
            "src/app/a.clj:6 call my-let()",
            "src/app/a.clj:8 call my-let()",
            "src/app/a.clj:8 value helper()",
            "src/app/a.clj:9 call my-let()",
            "src/app/a.clj:9 value a()",
        ],
    ],
    [
        "h1: methods, fields, constructors and classes",
        `;;; src/app/a.clj
(ns app.a (:import [java.util Date]))
(defn foo [] 1)
(defrecord Rec [foo])
(deftype Typ [foo])
(definterface Iface (bar [x]))
(defn run [o]
  (.foo o) (.-foo o) (Math/abs 1) (Date.) (Rec. 1) (Typ. 1) (. o foo) (. o (foo)) (.. o (foo) (foo))
  (Rec/create {}) (memfn foo) (new Rec 1) Typ Iface (foo))
(defrecord Rec2 [x] Iface (bar [this x] (foo) x))
(defn run2 [^Rec r] (:foo r) (.foo r))`,
        [
            "src/app/a.clj:7 call record Rec",
            "src/app/a.clj:7 call type Typ",
            "src/app/a.clj:8 call foo()",
            "src/app/a.clj:8 value interface Iface",
            "src/app/a.clj:8 value record Rec",
            "src/app/a.clj:8 value type Typ",
            "src/app/a.clj:9 call foo()",
            "src/app/a.clj:9 value interface Iface",
        ],
    ],
    [
        "j1: a syntax quote's names are read where the reader reads them",
        `;;; src/app/db.clj
(ns app.db)
(defn find-items [] 1)
;;; src/app/a.clj
(ns app.a (:require [app.db :as db]))
(defn helper [] 1)
(defmacro m1 [helper] \`(helper ~helper ~'helper (db/find-items) 'helper #'helper))
(defmacro m2 [] \`(later))
(defn later [] 1)
(defmacro m3 [] \`(let [x# 1 ~'y 2] [x# ~'y helper]))
(def data \`[helper later db/find-items])
(defmacro m4 [] \`'helper)`,
        [
            "src/app/a.clj:3 value find-items()",
            "src/app/a.clj:3 value helper()",
            "src/app/a.clj:3 value helper()",
            "src/app/a.clj:6 value helper()",
            "src/app/a.clj:7 value find-items()",
            "src/app/a.clj:7 value helper()",
            "src/app/a.clj:7 value later()",
        ],
    ],
    [
        "k1: in a file with no `ns` form, `load`ed by a namespace, an unknown head stays unknown",
        `;;; src/app/m.clj
(ns app.m)
(defmacro my-let [bs & body] \`(let ~bs ~@body))
;;; src/app/core.clj
(ns app.core (:require [app.m :refer [my-let]]))
(load "core_impl")
;;; src/app/core_impl.clj
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))`,
        [],
    ],
    [
        "l1: ClojureScript takes a namespace's macros from its Clojure file",
        `;;; src/app/m.clj
(ns app.m)
(defmacro both [x] x)
(defmacro only-mac [bs & body] \`(let ~bs ~@body))
;;; src/app/m.cljs
(ns app.m)
(defn both [x] x)
(defn only-fn [x] x)
;;; src/app/ui.cljs
(ns app.ui (:require [app.m :as m :refer [both only-fn]]))
(defn helper [] 1)
(defn run [] (m/both 1) (both 2) (m/only-fn (helper)) (only-fn 3))
;;; src/app/ui2.cljs
(ns app.ui2 (:require [app.m :as m :include-macros true]))
(defn helper [] 1)
(defn run [] (m/both 1) (m/only-mac [helper 1] (helper)))
;;; src/app/n.cljc
(ns app.n #?(:cljs (:require-macros [app.n])))
#?(:clj (defmacro nm [bs & body] \`(let ~bs ~@body)))
(defn helper [] 1)
(defn run [] (nm [helper 1] (helper)))
;;; src/app/ui3.cljs
(ns app.ui3 (:require [app.n :as n :refer [nm]]))
(defn helper [] 1)
(defn run [] (n/nm [helper 1] (helper)) (nm [helper 2] (helper)))`,
        [
            "src/app/ui.cljs:1 import both()",
            "src/app/ui.cljs:1 import only-fn()",
            "src/app/ui.cljs:3 call both()",
            "src/app/ui.cljs:3 call both()",
            "src/app/ui.cljs:3 call helper()",
            "src/app/ui.cljs:3 call only-fn()",
            "src/app/ui.cljs:3 call only-fn()",
            "src/app/ui2.cljs:3 call only-mac()",
            "src/app/ui3.cljs:1 import nm()",
            "src/app/ui3.cljs:3 call nm()",
            "src/app/ui3.cljs:3 call nm()",
        ],
    ],
    [
        "m1: protocols and multimethods",
        `;;; src/app/p.clj
(ns app.p)
(defprotocol Store "doc" :extend-via-metadata true (fetch [this]) (save [this x]))
(defmulti area :shape)
(defmethod area :circle [c] 1)
(defrecord Mem [m] Store (fetch [_] m) (save [this x] (fetch this)))
(extend-protocol Store String (fetch [s] (fetch s)) (save [s x] (area x)))
(extend-type Long Store (fetch [s] (area s)))
(defn helper [] 1)
(defn run [s] (fetch s) (save s 1) (area s) (methods area) (remove-method area :circle) (helper))
(reify Store (fetch [this] (helper)))
;;; src/app/q.clj
(ns app.q (:require [app.p :as p :refer [fetch area]]))
(defn run [s] (p/fetch s) (fetch s) (p/area s) (area s) (p/->Mem 1) (p/map->Mem {}) p/Store)
(defmethod p/area :square [s] (p/area s))
(extend-protocol p/Store Object (fetch [x] x))`,
        [
            "src/app/p.clj:10 call helper()",
            "src/app/p.clj:10 value protocol Store",
            "src/app/p.clj:5 value protocol Store",
            "src/app/p.clj:6 call area()",
            "src/app/p.clj:6 value protocol Store",
            "src/app/p.clj:7 call area()",
            "src/app/p.clj:7 value protocol Store",
            "src/app/p.clj:9 call area()",
            "src/app/p.clj:9 call helper()",
            "src/app/p.clj:9 value area()",
            "src/app/p.clj:9 value area()",
            "src/app/q.clj:1 import area()",
            "src/app/q.clj:2 call area()",
            "src/app/q.clj:2 call area()",
            "src/app/q.clj:2 call record Mem",
            "src/app/q.clj:2 call record Mem",
            "src/app/q.clj:2 value protocol Store",
            "src/app/q.clj:3 call area()",
            "src/app/q.clj:4 value protocol Store",
        ],
    ],
    [
        "n1: keywords, quotes, and `comment` forms, which never run",
        `;;; src/app/db.clj
(ns app.db)
(defn find-items [] 1)
;;; src/app/a.clj
(ns app.a (:require [app.db :as db]))
(defn x [] 1)
(def m {::db/find-items 1 :db/find-items 2 'x 3 x 4 'db/find-items 5})
(def n #:db{:find-items 1 x 2})
(defn run [] (comment (x) (db/find-items)) #_(x) (:x m) (get m 'x))
(comment
  (x)
  (db/find-items)
  (in-ns 'app.db)
  (find-items))`,
        [
            "src/app/a.clj:3 value x()",
            "src/app/a.clj:4 value x()",
            "src/app/a.clj:5 value m",
            "src/app/a.clj:5 value m",
        ],
    ],
    [
        "o1: metadata and dynamic vars",
        `;;; src/app/a.clj
(ns app.a)
(def ^:dynamic *ctx* nil)
(defn helper [] 1)
(defn ^{:arglists '([helper])} f [x] x)
(def ^{:doc "d" :tag (helper)} v 1)
(defn run [] (binding [*ctx* 1] (helper)) *ctx* (f 1) v)
(defn ^String g [^String helper] (helper))
(defn h [] (let [^{:tag helper} y 1] y))`,
        [
            "src/app/a.clj:6 call f()",
            "src/app/a.clj:6 call helper()",
            "src/app/a.clj:6 value *ctx*",
            "src/app/a.clj:6 value *ctx*",
            "src/app/a.clj:6 value v",
        ],
    ],
    [
        "p1: a `require` outside the `ns` form, at any depth or written qualified, keeps an unknown head unknown",
        `;;; src/app/m.clj
(ns app.m)
(defmacro my-let [bs & body] \`(let ~bs ~@body))
;;; src/app/a.clj
(ns app.a)
(try (require '[app.m :refer [my-let]]) (catch Exception _ nil))
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))
;;; src/app/b.clj
(ns app.b)
(clojure.core/require '[app.m :refer [my-let]])
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))
;;; src/app/c.clj
(ns app.c)
(when true (require '[app.m :refer [my-let]]))
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))
;;; src/app/d.clj
(ns app.d)
(defn helper [] 1)
(defn setup [] (require '[app.m :refer [my-let]]))
(defn run [] (my-let [helper (fn [] 2)] (helper)))`,
        [],
    ],
    [
        "q1: `:refer-clojure :only`, a macro named like clojure.core's, a function redefined, a value redefined",
        `;;; src/app/a.clj
(ns app.a (:refer-clojure :only [defn fn let]))
(defn helper [] 1)
(defn run [] (when true (helper)) (helper))
;;; src/app/b.clj
(ns app.b (:refer-clojure :exclude [when]))
(defmacro when [t & body] \`(if ~t (do ~@body)))
(defn helper [] 1)
(defn run [] (when true (helper)) (let [helper 2] (when helper (helper))))
;;; src/app/c.clj
(ns app.c)
(defn fib [n] n)
(def fib (memoize fib))
(defn run [] (fib 1))
;;; src/app/d.clj
(ns app.d)
(def x 1)
(def y (inc x))
(def x 2)
(defn run [] x y)`,
        [
            "src/app/a.clj:3 call helper()",
            "src/app/b.clj:4 call when()",
            "src/app/b.clj:4 call when()",
            "src/app/d.clj:5 value y",
        ],
    ],
    [
        "r1: before its def in the same top-level form, a name keeps its earlier meaning",
        `;;; src/app/a.clj
(ns app.a)
(let [orig-update update]
  (defn update [m k f & args] (apply orig-update m k f args)))
(do
  (def original-println println)
  (defn println [& xs] (apply original-println xs)))
(defn run [m] (update m :a inc) (println 1))
;;; src/app/util.clj
(ns app.util)
(defn helper [] 1)
;;; src/app/b.clj
(ns app.b (:use [app.util]))
(let [h helper]
  (defn helper [] (h)))`,
        [
            "src/app/a.clj:6 value original-println",
            "src/app/a.clj:7 call println()",
            "src/app/a.clj:7 call update()",
        ],
    ],
    [
        "s1: a var made a macro by `^:macro`, `^{:macro true}` or `.setMacro` reads as one",
        `;;; src/app/m.clj
(ns app.m)
(defn ^:macro my-let [&form &env bs & body] \`(let ~bs ~@body))
(defn ^{:macro true} my-let2 [&form &env bs & body] \`(let ~bs ~@body))
(def my-let3 (fn [&form &env bs & body] \`(let ~bs ~@body)))
(.setMacro #'my-let3)
;;; src/app/a.clj
(ns app.a (:require [app.m :as m]))
(defn helper [] 1)
(defn run []
  (m/my-let [helper (fn [] 2)] (helper))
  (m/my-let2 [helper (fn [] 2)] (helper))
  (m/my-let3 [helper (fn [] 2)] (helper)))`,
        [
            "src/app/a.clj:4 call my-let()",
            "src/app/a.clj:5 call my-let2()",
            "src/app/a.clj:6 call my-let3",
            "src/app/m.clj:5 value my-let3",
        ],
    ],
    [
        "t1: `#_` in the `ns` form, a record's methods, and a `deftest` nothing refers",
        `;;; src/app/db.clj
(ns app.db)
(defn find-items [] 1)
;;; src/app/other.clj
(ns app.other)
(defn find-items [] 2)
;;; src/app/a.cljc
(ns app.a
  (:require [app.db :as db]
            #_[app.other :as db2]
            [app.other :as o #_#_:refer [find-items]]))
(defn x [] 1)
(defrecord R [x] Object (toString [_] (str (x))))
(extend-type R clojure.lang.IFn (invoke [this] (x)))
(deftest t1 (x))
(defn run [m]
  (let [#_(comment x 1) y (x) {:keys [#?(:clj x :cljs z)]} m] (x) (db/find-items) (o/find-items) (find-items))
  (t1))`,
        [
            "src/app/a.cljc:10 call x()",
            "src/app/a.cljc:7 call x()",
            "src/app/a.cljc:7 value record R",
            "src/app/a.cljc:8 call x()",
        ],
    ],
];

describe("Clojure's adversarial review", () => {
    it.each(REVIEW)("%s", async (_title, text, expected) => {
        expect(await links(split(text))).toEqual(expected);
    });
});

/** The adversarial review's second round (2026-10-13). */
const REVIEW2: [string, string, string[]][] = [
    [
        "v1: `require` bound to a local (`(let [req require] (req …))`) keeps an unknown head unknown",
        `;;; src/app/m.clj
(ns app.m)
(defmacro my-let [bs & body] \`(let ~bs ~@body))
;;; src/app/a.clj
(ns app.a)
(let [req require] (req (quote [app.m :refer [my-let]])))
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))`,
        [],
    ],
    [
        "v2: `require` in a vector (`(doseq [f [require]] …)`) keeps an unknown head unknown",
        `;;; src/app/m.clj
(ns app.m)
(defmacro my-let [bs & body] \`(let ~bs ~@body))
;;; src/app/a.clj
(ns app.a)
(doseq [f [require]] (f (quote [app.m :refer [my-let]])))
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))`,
        [],
    ],
    [
        "v3: `((resolve 'require) …)` keeps an unknown head unknown",
        `;;; src/app/m.clj
(ns app.m)
(defmacro my-let [bs & body] \`(let ~bs ~@body))
;;; src/app/a.clj
(ns app.a)
((resolve 'require) '[app.m :refer [my-let]])
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))`,
        [],
    ],
    [
        "v4: `(eval '(require …))` keeps an unknown head unknown",
        `;;; src/app/m.clj
(ns app.m)
(defmacro my-let [bs & body] \`(let ~bs ~@body))
;;; src/app/a.clj
(ns app.a)
(eval '(require '[app.m :refer [my-let]]))
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))`,
        [],
    ],
    [
        "v5: an `alias` outside the `ns` form may name a namespace's whole name another",
        `;;; src/app/db.clj
(ns app.db)
(defn f [] 1)
;;; src/app/other.clj
(ns app.other)
(defn f [] 2)
;;; src/app/a.clj
(ns app.a (:require [app.db] [app.other]))
(alias 'app.db 'app.other)
(defn run [] (app.db/f))`,
        [],
    ],
    [
        "v6: `alter-meta!` copying another var's metadata may make a macro",
        `;;; src/app/m.clj
(ns app.m)
(def my-let @#'clojure.core/let)
(alter-meta! #'my-let merge (dissoc (meta #'clojure.core/let) :name :ns))
;;; src/app/a.clj
(ns app.a (:require [app.m :as m]))
(defn helper [] 1)
(defn run [] (m/my-let [helper (fn [] 2)] (helper)))`,
        [
            "src/app/a.clj:3 call my-let",
            "src/app/m.clj:3 value my-let",
        ],
    ],
    [
        "v7: a function another file read defines, which calls `load`, called as the file loads",
        `;;; src/app/util.clj
(ns app.util)
(defn load-impl [path] (load path))
;;; src/app/core_macros.clj
(defmacro my-let [bs & body] \`(let ~bs ~@body))
;;; src/app/core.clj
(ns app.core (:require [app.util :as util]))
(util/load-impl "core_macros")
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))`,
        [],
    ],
    [
        "v8: a macro whose syntax quote calls `require`",
        `;;; src/app/m.clj
(ns app.m)
(defmacro my-let [bs & body] \`(let ~bs ~@body))
;;; src/app/dev.clj
(ns app.dev)
(defmacro refer-tools [] \`(clojure.core/require '[app.m :refer [~'my-let]]))
;;; src/app/a.clj
(ns app.a (:require [app.dev :refer [refer-tools]]))
(refer-tools)
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))`,
        [
            "src/app/a.clj:1 import refer-tools()",
            "src/app/a.clj:2 call refer-tools()",
        ],
    ],
    [
        "v9: `(let [r clojure.core/require] …)` keeps an unknown head unknown",
        `;;; src/app/m.clj
(ns app.m)
(defmacro my-let [bs & body] \`(let ~bs ~@body))
;;; src/app/a.clj
(ns app.a)
(let [r clojure.core/require] (r (quote [app.m :refer [my-let]])))
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))`,
        [],
    ],
    [
        "v13: an `alter-meta!` in another file read makes the var it names a macro",
        `;;; src/app/m.clj
(ns app.m)
(defn my-let [&form &env bs & body] \`(let ~bs ~@body))
;;; src/app/m_init.clj
(ns app.m-init (:require [app.m]))
(alter-meta! #'app.m/my-let assoc :macro true)
;;; src/app/a.clj
(ns app.a (:require [app.m-init] [app.m :as m]))
(defn helper [] 1)
(defn run [] (m/my-let [helper (fn [] 2)] (helper)))`,
        [
            "src/app/a.clj:3 call my-let()",
            "src/app/m_init.clj:2 value my-let()",
        ],
    ],
    [
        "w1: a private var's name keeps its line only inside a macro the code shows",
        `;;; src/app/db.clj
(ns app.db)
(defn- secret [] 1)
;;; src/app/x.clj
(ns app.x)
;;; src/app/a.clj
(ns app.a (:require [app.db :as db]))
(require 'app.x)
(defn run [] (when true (db/secret)) (let [v (db/secret)] v) (db/secret))
;;; src/app/b.clj
(ns app.b (:require [app.db :as db]))
(defn run [] (when true (db/secret)) (let [v (db/secret)] v) (db/secret))`,
        [],
    ],
    [
        "y1: `require` renamed by `:refer-clojure`, in a def's metadata, or `.refer` on the namespace",
        `;;; src/app/m.clj
(ns app.m)
(defmacro my-let [bs & body] \`(let ~bs ~@body))
;;; src/app/a.clj
(ns app.a (:refer-clojure :rename {require core-require}))
(core-require '[app.m :refer [my-let]])
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))
;;; src/app/b.clj
(ns app.b)
(def ^{:loaded (require '[app.m :refer [my-let]])} loaded? true)
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))
;;; src/app/c.clj
(ns app.c (:require [app.m]))
(.refer *ns* 'my-let #'app.m/my-let)
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))`,
        [
            "src/app/c.clj:2 value my-let()",
        ],
    ],
];

describe("Clojure's adversarial review, round 2", () => {
    it.each(REVIEW2)("%s", async (_title, text, expected) => {
        expect(await links(split(text))).toEqual(expected);
    });
});

/** The adversarial review's third round (2026-10-13). */
const REVIEW3: [string, string, string[]][] = [
    [
        "p1 (accepted): a private var's name inside a library macro keeps its line, in code that wouldn't compile",
        `;;; src/app/db.clj
(ns app.db)
(defn- secret [] 1)
;;; src/app/a.clj
(ns app.a (:require [app.db :as db] [toucan2.core :as t2] [clojure.string :as str]))
(defn run [] (t2/select :model/User (db/secret)) (str/join (db/secret)) (db/secret))`,
        [
            "src/app/a.clj:2 call secret()",
        ],
    ],
    [
        "t1: an `as->` step of `some->`, `cond->` or `->` binds its name",
        `;;; src/app/a.clj
(ns app.a)
(defn q [] {})
(defn run [m]
  (some-> m (as-> q (assoc q :a 1)) (as-> q (merge q (q))))
  (cond-> m true (as-> q (assoc q :b (count q))))
  (-> m (as-> q (assoc q :c 1))))`,
        [],
    ],
    [
        "t2: `as->` and `case` steps of `cond->`, `doto` and `some->` read the value they get",
        `;;; src/app/sql.clj
(ns app.sql)
(defn where [q clause] (assoc q :where clause))
;;; src/app/query.clj
(ns app.query (:require [app.sql :refer [where]]))
(defn query [id] {:select [:*] :id id})
(defn build [q ids limit]
  (cond-> q
    (seq ids) (as-> where (assoc where :ids ids))
    limit     (as-> query (assoc query :limit limit) (assoc query :offset 0))))
(defn label [s]
  (doto s (as-> query (when (empty? query) (println "empty")))))
(defn route [k]
  (some-> k (case query :q where :w)))`,
        [
            "src/app/query.clj:1 import where()",
        ],
    ],
    [
        "z1: a `require` in a `defn`'s attribute map, which runs as metadata",
        `;;; src/app/m.clj
(ns app.m)
(defmacro my-let [bs & body] \`(let ~bs ~@body))
;;; src/app/a.clj
(ns app.a)
(defn setup {:loaded (require '[app.m :refer [my-let]])} [] 1)
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))`,
        [],
    ],
    [
        "z2: `if-let`'s else branch doesn't see its binding",
        `;;; src/app/m.clj
(ns app.m)
(defmacro my-let [bs & body] \`(let ~bs ~@body))
;;; src/app/a.clj
(ns app.a)
(if-let [require (System/getenv "NO_SUCH_VAR")] nil (require '[app.m :refer [my-let]]))
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))`,
        [],
    ],
    [
        "z3: a multimethod whose `defmethod` calls `require`, called as the file loads",
        `;;; src/app/m.clj
(ns app.m)
(defmacro my-let [bs & body] \`(let ~bs ~@body))
;;; src/app/setup.clj
(ns app.setup)
(defmulti setup! identity)
(defmethod setup! :tools [_] (require '[app.m :refer [my-let]]))
;;; src/app/a.clj
(ns app.a (:require [app.setup :as s]))
(s/setup! :tools)
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))`,
        [
            "src/app/a.clj:2 call setup!()",
        ],
    ],
    [
        "z4: a protocol method whose implementation calls `require`, called as the file loads",
        `;;; src/app/m.clj
(ns app.m)
(defmacro my-let [bs & body] \`(let ~bs ~@body))
;;; src/app/setup.clj
(ns app.setup)
(defprotocol Setup (setup! [x]))
(extend-protocol Setup clojure.lang.Keyword (setup! [_] (require '[app.m :refer [my-let]])))
;;; src/app/a.clj
(ns app.a (:require [app.setup :as s]))
(s/setup! :tools)
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))`,
        [],
    ],
    [
        "z5: a macro whose helper builds a `require` form",
        `;;; src/app/m.clj
(ns app.m)
(defmacro my-let [bs & body] \`(let ~bs ~@body))
;;; src/app/dev.clj
(ns app.dev)
(defn- require-form [] (list 'require ''[app.m :refer [my-let]]))
(defmacro refer-tools [] (require-form))
;;; src/app/a.clj
(ns app.a (:require [app.dev :refer [refer-tools]]))
(refer-tools)
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))`,
        [
            "src/app/a.clj:1 import refer-tools()",
            "src/app/a.clj:2 call refer-tools()",
            "src/app/dev.clj:3 call require-form()",
        ],
    ],
    [
        "z6: a `(defn ^:macro …)` that builds a `require` form",
        `;;; src/app/m.clj
(ns app.m)
(defmacro my-let [bs & body] \`(let ~bs ~@body))
;;; src/app/dev.clj
(ns app.dev)
(defn ^:macro refer-tools [&form &env] (list 'require ''[app.m :refer [my-let]]))
;;; src/app/a.clj
(ns app.a (:require [app.dev :refer [refer-tools]]))
(refer-tools)
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))`,
        [
            "src/app/a.clj:1 import refer-tools()",
            "src/app/a.clj:2 call refer-tools()",
        ],
    ],
    [
        "z7: `.setMacro` on `(ns-resolve 'ns 'name)` makes that var a macro",
        `;;; src/app/m.clj
(ns app.m)
(defn my-let [&form &env bs & body] \`(let ~bs ~@body))
;;; src/app/init.clj
(ns app.init (:require [app.m]))
(.setMacro (ns-resolve 'app.m 'my-let))
;;; src/app/a.clj
(ns app.a (:require [app.init] [app.m :as m]))
(defn helper [] 1)
(defn run [] (m/my-let [helper (fn [] 2)] (helper)))`,
        [
            "src/app/a.clj:3 call my-let()",
        ],
    ],
    [
        "z8: `require` taken from `(ns-publics 'clojure.core)`",
        `;;; src/app/m.clj
(ns app.m)
(defmacro my-let [bs & body] \`(let ~bs ~@body))
;;; src/app/a.clj
(ns app.a)
((get (ns-publics 'clojure.core) 'require) '[app.m :refer [my-let]])
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))`,
        [],
    ],
    [
        "z9: a macro that builds a `require` form with `(apply list ['require …])`",
        `;;; src/app/m.clj
(ns app.m)
(defmacro my-let [bs & body] \`(let ~bs ~@body))
;;; src/app/dev.clj
(ns app.dev)
(defmacro refer-tools [] (apply list ['require ''[app.m :refer [my-let]]]))
;;; src/app/a.clj
(ns app.a (:require [app.dev :refer [refer-tools]]))
(refer-tools)
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))`,
        [
            "src/app/a.clj:1 import refer-tools()",
            "src/app/a.clj:2 call refer-tools()",
        ],
    ],
    [
        "z10: an `:or` default runs before its local exists",
        `;;; src/app/m.clj
(ns app.m)
(defmacro my-let [bs & body] \`(let ~bs ~@body))
;;; src/app/a.clj
(ns app.a)
(let [{:keys [require] :or {require (require '[app.m :refer [my-let]])}} {}] require)
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))`,
        [],
    ],
    [
        "z11: a wrapper re-exported by a `def`, called as the file loads",
        `;;; src/app/m.clj
(ns app.m)
(defmacro my-let [bs & body] \`(let ~bs ~@body))
;;; src/app/impl.clj
(ns app.impl)
(defn init! [] (require '[app.m :refer [my-let]]))
;;; src/app/api.clj
(ns app.api (:require [app.impl]))
(def init! app.impl/init!)
;;; src/app/a.clj
(ns app.a (:require [app.api :as api]))
(api/init!)
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))`,
        [
            "src/app/a.clj:2 call init!",
            "src/app/api.clj:2 value init!()",
        ],
    ],
];

describe("Clojure's adversarial review, round 3", () => {
    it.each(REVIEW3)("%s", async (_title, text, expected) => {
        expect(await links(split(text))).toEqual(expected);
    });
});

/** The third round's families written other ways: a var a meta write finds by name, `require` found by name, a macro building code of strings or text, a method `.addMethod` adds. */
const REVIEW3_VARIANTS: [string, string, string[]][] = [
    [
        "`.setMacro` on `(ns-resolve (the-ns 'app.m) 'my-let)`",
        `;;; src/app/m.clj
(ns app.m)
(defn my-let [&form &env bs & body] \`(let ~bs ~@body))
;;; src/app/init.clj
(ns app.init (:require [app.m]))
(.setMacro (ns-resolve (the-ns 'app.m) 'my-let))
;;; src/app/a.clj
(ns app.a (:require [app.init] [app.m :as m]))
(defn helper [] 1)
(defn run [] (m/my-let [helper (fn [] 2)] (helper)))`,
        [
            "src/app/a.clj:3 call my-let()",
        ],
    ],
    [
        "`.setMacro` on `(find-var (symbol \"app.m\" \"my-let\"))`",
        `;;; src/app/m.clj
(ns app.m)
(defn my-let [&form &env bs & body] \`(let ~bs ~@body))
;;; src/app/init.clj
(ns app.init (:require [app.m]))
(.setMacro (find-var (symbol "app.m" "my-let")))
;;; src/app/a.clj
(ns app.a (:require [app.init] [app.m :as m]))
(defn helper [] 1)
(defn run [] (m/my-let [helper (fn [] 2)] (helper)))`,
        [
            "src/app/a.clj:3 call my-let()",
        ],
    ],
    [
        "`.setMacro` on each var of `(ns-publics 'app.m)`",
        `;;; src/app/m.clj
(ns app.m)
(defn my-let [&form &env bs & body] \`(let ~bs ~@body))
;;; src/app/init.clj
(ns app.init (:require [app.m]))
(doseq [[_ v] (ns-publics 'app.m)] (.setMacro v))
;;; src/app/a.clj
(ns app.a (:require [app.init] [app.m :as m]))
(defn helper [] 1)
(defn run [] (m/my-let [helper (fn [] 2)] (helper)))`,
        [
            "src/app/a.clj:3 call my-let()",
        ],
    ],
    [
        "`.setMacro` on a local bound to `(ns-resolve 'app.m 'my-let)`",
        `;;; src/app/m.clj
(ns app.m)
(defn my-let [&form &env bs & body] \`(let ~bs ~@body))
;;; src/app/init.clj
(ns app.init (:require [app.m]))
(let [v (ns-resolve 'app.m 'my-let)] (.setMacro v))
;;; src/app/a.clj
(ns app.a (:require [app.init] [app.m :as m]))
(defn helper [] 1)
(defn run [] (m/my-let [helper (fn [] 2)] (helper)))`,
        [
            "src/app/a.clj:3 call my-let()",
        ],
    ],
    [
        "`.setMacro` in a `doto` of `(ns-resolve 'app.m 'my-let)`",
        `;;; src/app/m.clj
(ns app.m)
(defn my-let [&form &env bs & body] \`(let ~bs ~@body))
;;; src/app/init.clj
(ns app.init (:require [app.m]))
(doto (ns-resolve 'app.m 'my-let) (.setMacro))
;;; src/app/a.clj
(ns app.a (:require [app.init] [app.m :as m]))
(defn helper [] 1)
(defn run [] (m/my-let [helper (fn [] 2)] (helper)))`,
        [
            "src/app/a.clj:3 call my-let()",
        ],
    ],
    [
        "`.setMacro` in a function given `(ns-resolve 'app.m 'my-let)`",
        `;;; src/app/m.clj
(ns app.m)
(defn my-let [&form &env bs & body] \`(let ~bs ~@body))
;;; src/app/init.clj
(ns app.init (:require [app.m]))
(defn mark! [v] (.setMacro v))
(mark! (ns-resolve 'app.m 'my-let))
;;; src/app/a.clj
(ns app.a (:require [app.init] [app.m :as m]))
(defn helper [] 1)
(defn run [] (m/my-let [helper (fn [] 2)] (helper)))`,
        [
            "src/app/a.clj:3 call my-let()",
            "src/app/init.clj:3 call mark!()",
        ],
    ],
    [
        "`.setMacro` on `(clojure.lang.RT/var \"app.m\" \"my-let\")`",
        `;;; src/app/m.clj
(ns app.m)
(defn my-let [&form &env bs & body] \`(let ~bs ~@body))
;;; src/app/init.clj
(ns app.init (:require [app.m]))
(.setMacro (clojure.lang.RT/var "app.m" "my-let"))
;;; src/app/a.clj
(ns app.a (:require [app.init] [app.m :as m]))
(defn helper [] 1)
(defn run [] (m/my-let [helper (fn [] 2)] (helper)))`,
        [
            "src/app/a.clj:3 call my-let()",
        ],
    ],
    [
        "`.setMacro` on `#'app.m/my-let` in a file that also calls `eval`",
        `;;; src/app/m.clj
(ns app.m)
(defn my-let [&form &env bs & body] \`(let ~bs ~@body))
;;; src/app/init.clj
(ns app.init (:require [app.m]))
(defn f [] (eval 1))
(.setMacro #'app.m/my-let)
;;; src/app/a.clj
(ns app.a (:require [app.init] [app.m :as m]))
(defn helper [] 1)
(defn run [] (m/my-let [helper (fn [] 2)] (helper)))`,
        [
            "src/app/a.clj:3 call my-let()",
        ],
    ],
    [
        "`.setMacro` in `#(…)` over `(ns-interns 'app.m)`",
        `;;; src/app/m.clj
(ns app.m)
(defn my-let [&form &env bs & body] \`(let ~bs ~@body))
;;; src/app/init.clj
(ns app.init (:require [app.m]))
(run! #(.setMacro %) (vals (ns-interns 'app.m)))
;;; src/app/a.clj
(ns app.a (:require [app.init] [app.m :as m]))
(defn helper [] 1)
(defn run [] (m/my-let [helper (fn [] 2)] (helper)))`,
        [
            "src/app/a.clj:3 call my-let()",
        ],
    ],
    [
        "`require` found by `(resolve (symbol \"clojure.core\" \"require\"))`",
        `;;; src/app/m.clj
(ns app.m)
(defmacro my-let [bs & body] \`(let ~bs ~@body))
;;; src/app/a.clj
(ns app.a)
((resolve (symbol "clojure.core" "require")) '[app.m :refer [my-let]])
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))`,
        [],
    ],
    [
        "`require` found by `(clojure.lang.RT/var \"clojure.core\" \"require\")`",
        `;;; src/app/m.clj
(ns app.m)
(defmacro my-let [bs & body] \`(let ~bs ~@body))
;;; src/app/a.clj
(ns app.a)
(.invoke (clojure.lang.RT/var "clojure.core" "require") '[app.m :refer [my-let]])
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))`,
        [],
    ],
    [
        "`require` found by `(clojure.lang.Var/find 'clojure.core/require)`",
        `;;; src/app/m.clj
(ns app.m)
(defmacro my-let [bs & body] \`(let ~bs ~@body))
;;; src/app/a.clj
(ns app.a)
((clojure.lang.Var/find 'clojure.core/require) '[app.m :refer [my-let]])
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))`,
        [],
    ],
    [
        "a macro that builds a call of `(symbol \"require\")`",
        `;;; src/app/m.clj
(ns app.m)
(defmacro my-let [bs & body] \`(let ~bs ~@body))
;;; src/app/dev.clj
(ns app.dev)
(defmacro refer-tools [] (list (symbol "require") ''[app.m :refer [my-let]]))
;;; src/app/a.clj
(ns app.a (:require [app.dev :refer [refer-tools]]))
(refer-tools)
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))`,
        [
            "src/app/a.clj:1 import refer-tools()",
            "src/app/a.clj:2 call refer-tools()",
        ],
    ],
    [
        "a macro that builds a call of the string `\"require\"`",
        `;;; src/app/m.clj
(ns app.m)
(defmacro my-let [bs & body] \`(let ~bs ~@body))
;;; src/app/dev.clj
(ns app.dev)
(defmacro refer-tools [] (apply list (map symbol ["require"]) [''[app.m :refer [my-let]]]))
;;; src/app/a.clj
(ns app.a (:require [app.dev :refer [refer-tools]]))
(refer-tools)
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))`,
        [
            "src/app/a.clj:1 import refer-tools()",
            "src/app/a.clj:2 call refer-tools()",
        ],
    ],
    [
        "a macro that builds `(require)` and adds its arguments with `concat`",
        `;;; src/app/m.clj
(ns app.m)
(defmacro my-let [bs & body] \`(let ~bs ~@body))
;;; src/app/dev.clj
(ns app.dev)
(defmacro refer-tools [] (concat '(require) ['(quote [app.m :refer [my-let]])]))
;;; src/app/a.clj
(ns app.a (:require [app.dev :refer [refer-tools]]))
(refer-tools)
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))`,
        [
            "src/app/a.clj:1 import refer-tools()",
            "src/app/a.clj:2 call refer-tools()",
        ],
    ],
    [
        "a macro that reads its form from text with `read-string`",
        `;;; src/app/m.clj
(ns app.m)
(defmacro my-let [bs & body] \`(let ~bs ~@body))
;;; src/app/dev.clj
(ns app.dev)
(defmacro refer-tools [] (read-string "(require '[app.m :refer [my-let]])"))
;;; src/app/a.clj
(ns app.a (:require [app.dev :refer [refer-tools]]))
(refer-tools)
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))`,
        [],
    ],
    [
        "a function `alter-meta!` makes a macro, which builds a `require` form",
        `;;; src/app/m.clj
(ns app.m)
(defmacro my-let [bs & body] \`(let ~bs ~@body))
;;; src/app/dev.clj
(ns app.dev)
(defn refer-tools [&form &env] (list 'require ''[app.m :refer [my-let]]))
(alter-meta! #'refer-tools assoc :macro true)
;;; src/app/a.clj
(ns app.a (:require [app.dev :refer [refer-tools]]))
(refer-tools)
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))`,
        [
            "src/app/a.clj:1 import refer-tools()",
            "src/app/a.clj:2 call refer-tools()",
            "src/app/dev.clj:3 value refer-tools()",
        ],
    ],
    [
        "a multimethod whose method, added with `.addMethod`, calls `require`",
        `;;; src/app/m.clj
(ns app.m)
(defmacro my-let [bs & body] \`(let ~bs ~@body))
;;; src/app/setup.clj
(ns app.setup)
(defmulti setup! identity)
(.addMethod setup! :tools (fn [_] (require '[app.m :refer [my-let]])))
;;; src/app/a.clj
(ns app.a (:require [app.setup :as s]))
(s/setup! :tools)
(defn helper [] 1)
(defn run [] (my-let [helper (fn [] 2)] (helper)))`,
        [],
    ],
];

describe("Clojure's adversarial review, round 3, other ways to write it", () => {
    it.each(REVIEW3_VARIANTS)("%s", async (_title, text, expected) => {
        expect(await links(split(text))).toEqual(expected);
    });
});
