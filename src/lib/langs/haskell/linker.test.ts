import { describe, expect, it } from "@jest/globals";
import { testParse } from "../../../test/parser.ts";
import { isGeneric, type GFile } from "../../anyfacts.ts";
import { parsePatch } from "../../diff.ts";
import { roleOf } from "../../language.ts";
import { linkerOf } from "../../linking.ts";
import { changedSymbols, testCases } from "../../symbols.ts";

const index = async (path: string, text: string): Promise<GFile> => {
    const f = await testParse(path, text);
    if (!f || !isGeneric(f)) throw new Error(`${path} wasn't read by a rule table`);
    return f;
};

/** Each unit as `label lines`, from its first comment to its last line. */
const units = (f: GFile) => f.units.map((u) => `${f.labels.get(u.id)} ${u.docLine}-${u.endLine}`);

const PLAN = `{-# LANGUAGE CPP #-}
module Stack.Build.Plan
  ( Plan (..)
  , constructPlan
  ) where

import qualified Data.Map as Map
import Data.List (sortOn)

-- | Builds the plan.
-- More about it.
constructPlan :: [Task] -> Plan
constructPlan [] = emptyPlan
constructPlan tasks =
  Plan (Map.fromList (map keyed tasks))
  where
    keyed t = (taskId t, t)
{-# INLINE constructPlan #-}

-- a plain comment
minVersion, maxVersion :: Int
minVersion = 1
maxVersion = 9

data Plan = Plan
  { planTasks :: Map.Map TaskId Task
  }
  deriving (Show)

newtype TaskId = TaskId Int

type Tasks = [Task]

class Monad m => HasPlan m where
  getPlan :: m Plan

  -- | With a default.
  hasTasks :: m Bool
  hasTasks = pure True

instance Show Task where
  show t = "task " ++ show (taskId t)

(<+>) :: Plan -> Plan -> Plan
a <+> b = Plan (planTasks a <> planTasks b)

#if MIN_VERSION_base(4,0,0)
merge :: Plan -> Plan
#else
merge :: Plan -> Plan -> Plan
#endif
merge p
  | null (planTasks p) = emptyPlan
  | otherwise = p
`;

describe("Haskell's units", () => {
    it("are functions from their type signature through their last equation, data, newtypes, types, classes and instances, each with its Haddock comment", async () => {
        const f = await index("src/Stack/Build/Plan.hs", PLAN);
        expect(units(f)).toEqual([
            "constructPlan 10-17",
            "minVersion 22-22",
            "maxVersion 23-23",
            "data Plan 25-28",
            "newtype TaskId 30-30",
            "type Tasks 32-32",
            "class HasPlan 34-39",
            "instance Show Task 41-42",
            "(<+>) 44-45",
            "merge 48-54",
        ]);
    });

    it("leave a `where` or `let` binding, a class's methods and an instance's to the declaration around them, and read nothing a name could link", async () => {
        const f = await index("Plan.hs", PLAN);
        const names = f.units.map((u) => u.name);
        for (const name of ["keyed", "getPlan", "hasTasks", "show"]) expect([name, names.includes(name)]).toEqual([name, false]);
        expect([f.sites, f.imports, f.scopes.length]).toEqual([[], [], 1]);
    });

    it("join a signature to its equations only with no other declaration between, a pragma aside", async () => {
        const f = await index("M.hs", "module M where\n\nfoo :: Int\n(a, b) = (1, 2)\nfoo = 3\n\nbar :: Int\n{-# INLINE bar #-}\nbar = 1\n");
        expect(units(f)).toEqual(["foo 3-3", "foo 5-5", "bar 7-9"]);
    });

    it("say the import lines import", async () => {
        const f = await index("Plan.hs", PLAN);
        const isImport = linkerOf("Plan.hs")!.isImport!;
        const lines: number[] = [];
        for (let n = f.flat.first[0]; n >= 0; n = f.flat.next[n]) if (isImport(f.flat, n)) lines.push(PLAN.slice(0, f.flat.start[n]).split("\n").length);
        expect(lines).toEqual([7]);
    });

    it("leave a file the parser can't trust to its file's card, as every Haskell file was before", async () => {
        // A shebang line below the top, which hls keeps as test data.
        const text = "class Semigroup a => SomeData a\ninstance SomeData All\n\n#! nix-shell -i runghc\n\nf :: Int -> Int\nf x = x * x\n";
        expect(await testParse("Main.hs", text)).toBeNull();
        const changes = changedSymbols("Main.hs", "hs", text.split("\n"), parsePatch("@@ -7,1 +7,1 @@\n-f x = x + x\n+f x = x * x"));
        expect([changes.symbols, changes.loose.map((l) => `${l.from}-${l.to}`)]).toEqual([[], ["7-7"]]);
    });
});

describe("Haskell's tests", () => {
    it("are files named for a spec or a test", () => {
        expect(["test/PlanSpec.hs", "src/Stack/PlanTests.hs", "src/Stack/Plan.hs"].map(roleOf)).toEqual(["test", "test", "code"]);
    });

    it("name Hspec's and tasty's cases and groups, and leave RSpec's alone", () => {
        const hunk = parsePatch('@@ -0,0 +1,4 @@\n+  describe "constructPlan" $ do\n+    it "keeps every task" $ do\n+  , testCase "merge is empty" $ assertEqual\n+  it "is RSpec" do');
        expect(testCases(hunk).map((c) => `${c.name}${c.group ? " (group)" : ""}`)).toEqual(["constructPlan (group)", "keeps every task", "merge is empty"]);
    });
});
