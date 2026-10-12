import { describe, expect, it } from "@jest/globals";
import { testParse } from "../../../test/parser.ts";
import { isGeneric, type GFile } from "../../anyfacts.ts";
import { parsePatch } from "../../diff.ts";
import { roleOf } from "../../language.ts";
import { testCases } from "../../symbols.ts";

const index = async (path: string, text: string): Promise<GFile> => {
    const f = await testParse(path, text);
    if (!f || !isGeneric(f)) throw new Error(`${path} wasn't read by a rule table`);
    return f;
};

/** Each unit as `label lines`, from its first comment to its last line. */
const units = (f: GFile) => f.units.map((u) => `${f.labels.get(u.id)} ${u.docLine}-${u.endLine}`);

const WALLET = `#include <vector>

namespace wallet {
namespace {
int Helper() { return 1; }
} // namespace

/** A wallet. */
class CWallet final : public Base
{
public:
    CWallet() = default;
    explicit CWallet(int x) : m_x(x) {}
    ~CWallet() override;

    int Get() const { return m_x; }
    template <typename T>
    T As() const { return T(); }
    bool operator==(const CWallet& o) const { return m_x == o.m_x; }
    explicit operator bool() const { return m_x != 0; }
    friend bool operator<(const CWallet& a, const CWallet& b) { return a.m_x < b.m_x; }
    const std::vector<int>& Keys() const noexcept { return m_keys; }

    struct Entry {
        int id;
        void Touch() {}
    };

private:
    int m_x;
    std::vector<int> m_keys;
};

CWallet::~CWallet() {}

int CWallet::Count(int a)
{
    auto twice = [](int x) { return 2 * x; };
    return twice(a);
}

template <typename T>
void Box<T>::Put(T v)
{
}

void chain::detail::Deep::Run() {}
} // namespace wallet

class LEVELDB_EXPORT Env {
 public:
  virtual ~Env();
};

enum class Mode : int { A, B };
using Alias = std::vector<int>;
`;

describe("C++'s units", () => {
    it("are classes, structs and enums with a body, and function definitions: a member's card named for its class, in the class or qualified with it", async () => {
        const f = await index("src/wallet/wallet.cpp", WALLET);
        expect(units(f)).toEqual([
            "Helper() 5-5",
            "class CWallet 8-32",
            "CWallet::CWallet() 12-12",
            "CWallet::CWallet() 13-13",
            "CWallet::Get() 16-16",
            "CWallet::As() 17-18",
            "CWallet::operator==() 19-19",
            "CWallet::operator bool() 20-20",
            "operator<() 21-21",
            "CWallet::Keys() 22-22",
            "struct Entry 24-27",
            "Entry::Touch() 26-26",
            "CWallet::~CWallet() 34-34",
            "CWallet::Count() 36-40",
            "Box::Put() 42-45",
            "Deep::Run() 47-47",
            "enum Mode 55-55",
        ]);
    });

    it("make no unit of a declaration, a lambda, a namespace, or a class whose name follows a macro (`class EXPORT Env {` reads as a function)", async () => {
        const f = await index("src/wallet/wallet.cpp", WALLET);
        const names = f.units.map((u) => u.name);
        expect(names).not.toContain("Env");
        expect(names).not.toContain("wallet");
        expect(f.units.filter((u) => u.name === "~CWallet")).toHaveLength(1);
        expect([f.sites, f.imports, f.scopes.length]).toEqual([[], [], 1]);
    });

    it("read a header as C++, and leave out a function written in a macro's body, which the grammar reads as code after a comment", async () => {
        const filler = Array.from({ length: 30 }, (_, i) => `int Filler${i}(int x)\n{\n    return x + ${i};\n}\n`).join("\n");
        const text = `#define SETTING(type, name)           \\\nprivate:                              \\\n    type _##name;                     \\\n                                      \\\npublic:                               \\\n    /* Returns the setting */         \\\n    type name() const                 \\\n    {                                 \\\n        return _##name;               \\\n    }\n\nclass Settings\n{\n    SETTING(int, Width);\n};\n\n${filler}`;
        const f = await index("src/settings.h", text);
        expect(units(f).slice(0, 2)).toEqual(["class Settings 12-15", "Filler0() 17-20"]);
    });
});

describe("C++'s tests", () => {
    it("are files named for a test", () => {
        expect(["src/test/util_tests.cpp", "src/ut_adapter/adapterTest.cpp", "src/net_unittest.cc", "src/net.cpp"].map(roleOf)).toEqual(["test", "test", "test", "code"]);
    });

    it("name GoogleTest's, Boost's, Catch2's and doctest's cases and suites", () => {
        const hunk = parsePatch(
            '@@ -0,0 +1,7 @@\n+TEST(NotNull, Dereference) {\n+TEST_F(WalletFixture, Sync) {\n+BOOST_AUTO_TEST_SUITE(util_tests)\n+BOOST_AUTO_TEST_CASE(not_null_basic)\n+TEST_CASE("[ClassDB] Signals (owned by GDType)") {\n+    TEST_METHOD(CreateUuid);\n+BOOST_AUTO_TEST_SUITE_END()'
        );
        expect(testCases(hunk).map((c) => `${c.name}${c.group ? " (group)" : ""}`)).toEqual([
            "NotNull.Dereference",
            "WalletFixture.Sync",
            "util_tests (group)",
            "not_null_basic",
            "[ClassDB] Signals (owned by GDType)",
            "CreateUuid",
        ]);
    });
});
