import { describe, expect, it } from "@jest/globals";
import { testParse } from "../../../test/parser.ts";
import { isGeneric, type GFile } from "../../anyfacts.ts";
import { resolveAny } from "../../anylink.ts";
import { rulesOf } from "../../linking.ts";
import { phpWants } from "./wants.ts";

const COMPOSER = JSON.stringify({ autoload: { "psr-4": { "App\\": "src/" } }, "autoload-dev": { "psr-4": { "App\\Tests\\": "tests/" } } });

const parse = async (files: Record<string, string>): Promise<GFile[]> => {
    const parsed: GFile[] = [];
    for (const [path, text] of Object.entries(files)) {
        const f = path.endsWith(".php") ? await testParse(path, text) : null;
        if (f && isGeneric(f)) parsed.push(f);
    }
    return parsed;
};

/** Every reference that resolves, as `path:line ref card`: the files given (and the root composer.json) are all there is, any other path a 404. */
const links = async (files: Record<string, string>, composer = COMPOSER): Promise<string[]> => {
    const all: Record<string, string> = { "composer.json": composer, ...files };
    const parsed = await parse(all);
    const labels = new Map(parsed.flatMap((f) => [...f.labels]));
    return resolveAny(parsed, (f) => rulesOf(f.path)!.resolver, (path) => all[path], (path) => path in all).flatMap((r) => r.units.map((u) => `${r.path}:${r.line} ${r.ref} ${labels.get(u.id)}${r.alt ? ` (${labels.get(r.alt.id)})` : ""}`));
};

/** The calls among them. */
const calls = async (files: Record<string, string>, composer?: string): Promise<string[]> => (await links(files, composer)).filter((l) => l.includes(" call "));

const php = (ns: string, body: string) => `<?php\nnamespace ${ns};\n\n${body}\n`;

const B = php("App", "class B\n{\n    private function secret(): void {}\n    protected function prot(): void {}\n    public function pub(): self { return $this; }\n}");

describe("PHP's units", () => {
    it("are the classes, interfaces, traits and enums a file or a namespace holds, their methods named with them, and functions", async () => {
        const [f] = await parse({
            "src/a.php": "<?php\nnamespace App;\n\n/** A. */\n#[Attr]\nfinal class A\n{\n    public function run(): void\n    {\n        $x = new class { public function inner() {} };\n        function local() {}\n    }\n}\ninterface I { public function i(); }\ntrait T { public function t() {} }\nenum E: string { case X = 'x'; public function e() {} }\nif (!function_exists('helper')) {\n    function helper() {}\n}\n$f = function () { class Hidden {} };\n",
        });
        expect(f.units.map((u) => `${f.labels.get(u.id)} ${u.docLine}-${u.endLine}`)).toEqual(["class A 4-13", "A::run() 8-12", "interface I 14-14", "I::i() 14-14", "trait T 15-15", "T::t() 15-15", "enum E 16-16", "E::e() 16-16", "helper() 18-18"]);
    });
});

describe("PHP's class names", () => {
    it("read `use` aliases, group uses, full names and the namespace's own, then Composer's PSR-4 map; `namespace\\Foo` names nothing", async () => {
        const found = await links({
            "src/Http/Router.php": php("App\\Http", "use App\\Model\\User;\nuse App\\Model\\{Post, Tag as Label};\n\nclass Router\n{\n    public function go(User $u, Post $p, Label $l, \\App\\Model\\Tag $t, Route $r, namespace\\Route $s): void {}\n}"),
            "src/Http/Route.php": php("App\\Http", "class Route {}"),
            "src/Model/User.php": php("App\\Model", "class User {}"),
            "src/Model/Post.php": php("App\\Model", "class Post {}"),
            "src/Model/Tag.php": php("App\\Model", "class Tag {}"),
        });
        expect(found.filter((l) => l.startsWith("src/Http/Router.php"))).toEqual([
            "src/Http/Router.php:9 type class User",
            "src/Http/Router.php:9 type class Post",
            "src/Http/Router.php:9 type class Tag",
            "src/Http/Router.php:9 type class Tag",
            "src/Http/Router.php:9 type class Route",
            "src/Http/Router.php:4 import class User",
            "src/Http/Router.php:5 import class Post",
            "src/Http/Router.php:5 import class Tag",
        ]);
    });

    it("take the file Composer loads: the longest prefix first, its folders in order, the first that exists", async () => {
        const composer = JSON.stringify({ autoload: { "psr-4": { "Lib\\": "src/", "Lib\\Support\\": ["src/Macroable/", "src/Collections/"] } } });
        const found = await links(
            {
                "src/App.php": php("Lib", "use Lib\\Support\\Collection;\nuse Lib\\Support\\Str;\n\nclass App\n{\n    public function go(Collection $c, Str $s): void {}\n}"),
                "src/Collections/Collection.php": php("Lib\\Support", "class Collection {}"),
                "src/Support/Str.php": php("Lib\\Support", "class Str {}"),
            },
            composer
        );
        expect(found.filter((l) => l.startsWith("src/App.php"))).toEqual(["src/App.php:9 type class Collection", "src/App.php:9 type class Str", "src/App.php:4 import class Collection", "src/App.php:5 import class Str"]);
    });

    it("name nothing for a class no prefix maps (a Composer package's), a class a file declares in a block or twice, or one two files read declare", async () => {
        const found = await links({
            "src/A.php": php("App", "use Psr\\Log\\LoggerInterface;\n\nclass A\n{\n    public function go(LoggerInterface $l, Twice $t, Shadowed $s, Guarded $g): void {}\n}"),
            "src/Twice.php": php("App", "if (PHP_VERSION_ID > 80000) {\n    class Twice {}\n} else {\n    class Twice {}\n}"),
            "src/Shadowed.php": php("App", "class Shadowed {}"),
            "tests/Fixtures/Shadowed.php": php("App", "class Shadowed {}"),
            "src/Guarded.php": php("App", "if (!class_exists(Guarded::class)) {\n    class Guarded {}\n}"),
        });
        expect(found.filter((l) => l.startsWith("src/A.php"))).toEqual([]);
    });

    it("are the file's own where it declares them, whatever the map says", async () => {
        const found = await links({ "tests/ATest.php": php("App\\Tests", "class ATest\n{\n    public function test(): void { (new Helper())->help(); }\n}\nclass Helper { public function help() {} }") });
        expect(found).toEqual(["tests/ATest.php:6 type class Helper", "tests/ATest.php:6 call class Helper", "tests/ATest.php:6 call Helper::help()"]);
    });

    it("compare as PHP compares them, case aside", async () => {
        const found = await calls({ "src/A.php": php("App", "use App\\b as Bee;\n\nclass A\n{\n    public function go(BEE $b): void { $b->PUB(); }\n}"), "src/b.php": B.replace("class B", "class b") });
        expect(found).toEqual(["src/A.php:8 call b::pub()"]);
    });
});

describe("PHP's method calls", () => {
    const base = php("App", "abstract class Base implements Contract\n{\n    public function __construct() {}\n    protected function helper(): void {}\n    private function hidden(): void {}\n    public function both(): void {}\n}");
    const contract = php("App", "interface Contract\n{\n    public function contract(): void;\n}");
    const trait = php("App", "trait Logs\n{\n    public function log(): void { $this->helper(); self::make(); }\n    public function both(): void {}\n}");

    it("follow `$this` through the class, its traits, its parents, then its interfaces", async () => {
        const found = await calls({
            "src/Base.php": base,
            "src/Contract.php": contract,
            "src/Logs.php": trait,
            "src/Store.php": php("App", "class Store extends Base\n{\n    use Logs;\n\n    public function run(): void\n    {\n        $this->own();\n        $this->log();\n        $this->both();\n        $this->helper();\n        $this->contract();\n        $this->hidden();\n        $this->missing();\n    }\n\n    public function own(): void {}\n}"),
        });
        expect(found).toEqual(["src/Store.php:10 call Store::own()", "src/Store.php:11 call Logs::log()", "src/Store.php:12 call Logs::both()", "src/Store.php:13 call Base::helper()", "src/Store.php:14 call Contract::contract()"]);
    });

    it("find a class's own methods only, when a parent or a trait isn't read", async () => {
        const found = await calls({ "src/A.php": php("App", "class A extends Missing\n{\n    use Gone;\n\n    public function run(): void { $this->own(); $this->inherited(); }\n    public function own(): void {}\n}") });
        expect(found).toEqual(["src/A.php:8 call A::own()"]);
    });

    it("take an inherited method over a trait's abstract one, and a trait's concrete one over an inherited one", async () => {
        const found = await calls({
            "src/P.php": php("App", "class P\n{\n    public function need(): void {}\n    public function both(): void {}\n}"),
            "src/Needs.php": php("App", "trait Needs\n{\n    abstract public function need(): void;\n    public function both(): void {}\n}"),
            "src/A.php": php("App", "class A extends P\n{\n    use Needs;\n\n    public function go(): void { $this->need(); $this->both(); }\n}"),
        });
        expect(found).toEqual(["src/A.php:8 call P::need()", "src/A.php:8 call Needs::both()"]);
    });

    it("leave a name a trait `use` block adapts, a trait's abstract method no class declares, and two traits giving one name", async () => {
        const found = await calls({
            "src/A.php": php("App", "class A\n{\n    use One, Two { One::run insteadof Two; Two::run as other; }\n    use Abs;\n\n    public function go(): void { $this->run(); $this->other(); $this->abs(); $this->shared(); }\n}"),
            "src/One.php": php("App", "trait One { public function run() {} public function shared() {} }"),
            "src/Two.php": php("App", "trait Two { public function run() {} public function shared() {} }"),
            "src/Abs.php": php("App", "trait Abs { abstract public function abs(); }"),
        });
        expect(found).toEqual([]);
    });

    it("leave `$this` and `self` in a closure, an arrow function, a static method, a trait and an anonymous class", async () => {
        const found = await calls({
            "src/Logs.php": trait,
            "src/A.php": php("App", "class A\n{\n    public function go(): void\n    {\n        $f = function () { $this->own(); self::make(); };\n        $g = fn () => $this->own();\n        $h = static fn () => static::make();\n        $i = new class { public function run() { $this->own(); } };\n    }\n    public static function make(): void { $this->own(); }\n    public function own(): void {}\n}"),
        });
        expect(found).toEqual([]);
    });

    it("leave a method `__call` may take: one not declared, or one the caller may not see", async () => {
        const found = await calls({
            "src/Magic.php": php("App", "class Magic\n{\n    public function defined(): void {}\n    protected function guarded(): void {}\n    public function __call($n, $a) {}\n}"),
            "src/A.php": php("App", "class A\n{\n    public function go(Magic $m): void { $m->defined(); $m->undeclared(); $m->guarded(); }\n}"),
        });
        expect(found).toEqual(["src/A.php:6 call Magic::defined()"]);
    });

    it("reach a private method only from its class, a protected one from its class and descendants", async () => {
        const found = await calls({
            "src/B.php": B,
            "src/A.php": php("App", "class A\n{\n    public function go(B $b): void { $b->secret(); $b->prot(); $b->pub(); }\n}"),
            "src/C.php": php("App", "class C extends B\n{\n    public function go(B $b): void { $b->prot(); $this->secret(); parent::prot(); }\n}"),
        });
        expect(found).toEqual(["src/A.php:6 call B::pub()", "src/C.php:6 call B::prot()", "src/C.php:6 call B::prot()"]);
    });

    it("read `self::`, `static::` and `parent::` in the class written, and `Foo::` by its name", async () => {
        const found = await calls({
            "src/P.php": php("App", "class P\n{\n    public static function make(): static { return new static(); }\n    public function run(): void {}\n}"),
            "src/A.php": php("App", "class A extends P\n{\n    public function go(): void\n    {\n        self::make()->run();\n        static::make();\n        parent::run();\n        P::make();\n        static::mine();\n        self::mine();\n    }\n    private static function mine(): void {}\n}"),
        });
        expect(found).toEqual(["src/P.php:6 call class P", "src/A.php:8 call P::make()", "src/A.php:8 call P::run()", "src/A.php:9 call P::make()", "src/A.php:10 call P::run()", "src/A.php:11 call P::make()", "src/A.php:12 call A::mine()", "src/A.php:13 call A::mine()"]);
    });
});

describe("PHP's class tests", () => {
    const rules = {
        "src/Rule.php": php("App", "class Rule\n{\n    public function literals(): array { return []; }\n    public function hash(): string { return ''; }\n}"),
        "src/Multi.php": php("App", "class Multi extends Rule\n{\n    public function literals(): array { return [1]; }\n}"),
    };

    it("leave a call whose receiver a test may narrow to a class that reaches another method, in the receiver's function", async () => {
        const found = await calls({
            ...rules,
            "src/A.php": php("App", "class A\n{\n    public function go(Rule $r, Rule $s): void\n    {\n        if ($r instanceof Multi) {\n            $r->literals();\n        }\n        $r->hash();\n        $s->literals();\n        is_a($s, Multi::class);\n    }\n\n    public function other(Rule $r): void { $r->literals(); }\n}"),
        });
        expect(found).toEqual(["src/A.php:11 call Rule::hash()", "src/A.php:16 call Rule::literals()"]);
    });

    // A test case and an assertion class the files read declare, as a board reads a repository's own: one not read may take its arguments by reference.
    const asserts = {
        "tests/TestCase.php": php("App\\Tests", "abstract class TestCase\n{\n    public static function assertInstanceOf(string $class, mixed $actual): void {}\n    public static function assertSame(mixed $expected, mixed $actual): void {}\n    public static function expectType(string $class, mixed $actual): void {}\n}"),
        "tests/Assert.php": php("App\\Tests", "final class Assert\n{\n    public static function isInstanceOf(mixed $value, string $class): void {}\n    public static function same(mixed $value, mixed $expect): void {}\n}"),
    };

    it("count a call given a class and the receiver as a test of it: `assertInstanceOf()`, webmozart's `isInstanceOf()`, a class written as a string or held in a variable", async () => {
        const found = await calls({
            ...rules,
            ...asserts,
            "tests/ATest.php": php(
                "App\\Tests",
                String.raw`use App\Multi;
use App\Rule;

class ATest extends TestCase
{
    public function test(Rule $a, Rule $b, Rule $c, Rule $d, Rule $e, Rule $f, Rule $g): void
    {
        $this->assertInstanceOf(Multi::class, $a);
        $a->literals();
        self::assertInstanceOf('App\Multi', $b);
        $b->literals();
        Assert::isInstanceOf($c, Multi::class);
        $c->literals();
        $class = Multi::class;
        $this->assertInstanceOf($class, $d);
        $d->literals();
        $this->assertInstanceOf(Multi::class, $e);
        $e->hash();
        $this->assertSame('x', $f);
        $f->literals();
        $this->expectType(Multi::class, $g);
        $g->literals();
    }
}`
            ),
        });
        expect(found.filter((l) => l.startsWith("tests/ATest.php") && !/assert|isInstanceOf|expectType/i.test(l))).toEqual(["tests/ATest.php:21 call Rule::hash()", "tests/ATest.php:23 call Rule::literals()"]);
    });

    it("count an assertion on a call's result as a test of the same call", async () => {
        const found = await calls({
            ...rules,
            ...asserts,
            "src/Box.php": php("App", "class Box\n{\n    public function rule(): Rule { return new Multi(); }\n}"),
            "tests/BoxTest.php": php("App\\Tests", String.raw`use App\Box;
use App\Multi;

class BoxTest extends TestCase
{
    public function test(Box $box): void
    {
        $this->assertInstanceOf(Multi::class, $box->rule());
        $box->rule()->literals();
    }
}`),
        });
        expect(found.filter((l) => l.startsWith("tests/BoxTest.php") && !l.includes("assert"))).toEqual(["tests/BoxTest.php:11 call Box::rule()", "tests/BoxTest.php:12 call Box::rule()"]);
    });

    it("count a helper's PHPDoc assertion of a parameter, \`$this\` or a property as a test of what the call passes, is called on, or hangs off it", async () => {
        const found = await calls({
            ...rules,
            "src/Guard.php": php("App", String.raw`final class Guard
{
    /** @phpstan-assert-if-true Multi $x */
    public static function isMulti(Rule $x): bool { return $x instanceof Multi; }

    /** @psalm-assert Multi $x */
    public static function multi(Rule $x): void {}
}`),
            "src/Node.php": php("App", String.raw`class Node
{
    public Rule $rule;

    /** @phpstan-assert-if-true Multi $this */
    public function isMulti(): bool { return false; }

    /** @phpstan-assert-if-true Multi $this->rule */
    public function hasMulti(): bool { return false; }

    public function literals(): array { return []; }
}`),
            "src/A.php": php("App", String.raw`class A
{
    public function go(Rule $x, Rule $y, Node $n, Node $o): void
    {
        if (Guard::isMulti($x)) {
            $x->literals();
        }
        Guard::multi($y);
        $y->literals();
        if ($n->isMulti()) {
            $n->literals();
        }
        if ($o->hasMulti()) {
            $o->rule->literals();
            $o->literals();
        }
    }
}`),
        });
        expect(found).toEqual(["src/A.php:8 call Guard::isMulti()", "src/A.php:11 call Guard::multi()", "src/A.php:13 call Node::isMulti()", "src/A.php:16 call Node::hasMulti()", "src/A.php:18 call Node::literals()"]);
    });

    it("count \`===\`, \`!==\`, a \`match\` arm and \`in_array()\` as tests of each side by the other's class; a scalar, or a class the receiver is anyway, tests nothing", async () => {
        const found = await calls({
            ...rules,
            "src/A.php": php("App", String.raw`class A
{
    public function __construct(private Multi $multi) {}

    public function go(Rule $a, Multi $b, Rule $c, Rule $d, Rule $e, Multi $f, ?Rule $g, Rule $h): void
    {
        if ($a === $b) {
            $a->literals();
        }
        if ($c !== $this->multi) {
            return;
        }
        $c->literals();
        $x = match ($d) { $b => $d->literals(), default => null };
        if (in_array($e, [$b], true)) {
            $e->literals();
        }
        if ($f === $h) {
            $f->literals();
        }
        if (null !== $g) {
            $g->literals();
        }
    }
}`),
        });
        expect(found).toEqual(["src/A.php:22 call Multi::literals()", "src/A.php:25 call Rule::literals()"]);
    });

    it("count \`get_debug_type()\` and \`get_parent_class()\`, which PHPStan compares as \`get_class()\`", async () => {
        const found = await calls({
            ...rules,
            "src/A.php": php("App", "class A\n{\n    public function go(Rule $a, Rule $b): void\n    {\n        if (get_debug_type($a) === Multi::class) {\n            $a->literals();\n        }\n        if (get_parent_class($b) === Rule::class) {\n            $b->literals();\n        }\n    }\n}"),
        });
        expect(found).toEqual([]);
    });

    it("leave a value an inline \`@var\` types with another class than its own, from there on: above its \`$x = …;\`, or alone", async () => {
        const found = await calls({
            ...rules,
            "src/Pool.php": php("App", "class Pool\n{\n    public function get(): Rule { return new Multi(); }\n}"),
            "src/A.php": php("App", String.raw`class A
{
    public function go(Pool $p, Rule $e): void
    {
        /** @var Multi $a */
        $a = $p->get();
        $a->hash();
        /** @var Multi */
        $b = $p->get();
        $b->hash();
        /** @var Rule|null $d */
        $d = $p->get();
        $d->literals();
        $e->literals();
        /** @var Multi $e */
        $e->literals();
        $f = $p->get();
        /** @var $f Multi */
        $f->literals();
    }
}`),
        });
        expect(found.filter((l) => l.startsWith("src/A.php"))).toEqual(["src/A.php:9 call Pool::get()", "src/A.php:12 call Pool::get()", "src/A.php:15 call Pool::get()", "src/A.php:16 call Rule::literals()", "src/A.php:17 call Rule::literals()", "src/A.php:20 call Pool::get()"]);
    });
});

describe("PHP's narrowing calls", () => {
    const rules = {
        "src/Rule.php": php("App", "class Rule\n{\n    public function literals(): array { return []; }\n    public function hash(): string { return ''; }\n}"),
        "src/Multi.php": php("App", "class Multi extends Rule\n{\n    public function literals(): array { return [1]; }\n}"),
        "src/Box.php": php("App", "class Box\n{\n    public Rule $rule;\n\n    public function rule(): Rule { return new Multi(); }\n}"),
        "src/Pool.php": php("App", "class Pool\n{\n    public function get(): Rule { return new Multi(); }\n    public function multi(): Multi { return new Multi(); }\n}"),
        "tests/TestCase.php": php("App\\Tests", "abstract class TestCase\n{\n    public static function assertSame(mixed $expected, mixed $actual, string $message = ''): void {}\n}"),
        "tests/Assert.php": php("App\\Tests", "final class Assert\n{\n    public static function same(mixed $value, mixed $expect): void {}\n}"),
    };

    it("count \`assertSame()\` and webmozart's \`same()\` as \`===\` between their two values: a variable, a call's result, a property", async () => {
        const found = await calls({
            ...rules,
            "tests/ATest.php": php("App\\Tests", String.raw`use App\Box;
use App\Multi;
use App\Rule;

class ATest extends TestCase
{
    public function test(Box $box, Rule $a, Multi $m, Rule $b): void
    {
        $this->assertSame($m, $a);
        $a->literals();
        self::assertSame($m, $box->rule());
        $box->rule()->literals();
        Assert::same($box->rule, $m);
        $box->rule->literals();
        $this->assertSame('x', $b->hash());
        $b->literals();
    }
}`),
        });
        expect(found.filter((l) => l.startsWith("tests/ATest.php") && !/::(assertSame|same)\(\)/.test(l))).toEqual(["tests/ATest.php:14 call Box::rule()", "tests/ATest.php:15 call Box::rule()", "tests/ATest.php:18 call Rule::hash()", "tests/ATest.php:19 call Rule::literals()"]);
    });

    it("take the other side of a comparison as unknown where anything else compares or tests it, another value of the same variable too, and name nothing on either side of an \`assertSame()\` given named arguments", async () => {
        const found = await calls({
            ...rules,
            "tests/ATest.php": php("App\\Tests", String.raw`use App\Box;
use App\Pool;

class ATest extends TestCase
{
    public function test(Pool $p, Box $box): void
    {
        $x = $p->multi();
        $y = $p->get();
        if ($y !== $x) {
            return;
        }
        $x = $p->get();
        if ($x === $y) {
            $x->literals();
        }
        $expected = $p->multi();
        $def = $p->get();
        $this->assertSame($expected, $def);
        $expected = $p->get();
        $this->assertSame($def, $expected);
        $expected->literals();
        $m = $p->multi();
        $named = $p->get();
        $this->assertSame(message: 'kept', expected: $m, actual: $named);
        $named->literals();
        self::assertSame(message: 'kept', actual: $box->rule(), expected: $m);
        $box->rule()->literals();
    }
}`),
        });
        expect(found.filter((l) => l.startsWith("tests/ATest.php") && !/::(assertSame|multi|get)\(\)/.test(l))).toEqual(["tests/ATest.php:30 call Box::rule()", "tests/ATest.php:31 call Box::rule()"]);
    });

    it("count a value a helper asserts, or a test narrows, where it is copied or compared: \`$z = $y\`, \`$x === $y\`, a property's value", async () => {
        const found = await calls({
            ...rules,
            "src/Guard.php": php("App", String.raw`final class Guard
{
    /** @phpstan-assert Multi $x */
    public static function multi(Rule $x): void {}
}`),
            "src/A.php": php("App", String.raw`class A
{
    public function go(Rule $y, Rule $x, Box $box, Rule $v, Rule $w): void
    {
        Guard::multi($y);
        $z = $y;
        $z->literals();
        if ($x === $y) {
            $x->literals();
        }
        Guard::multi($box->rule);
        $r = $box->rule;
        $r->literals();
        if ($v instanceof Multi && $w === $v) {
            $w->literals();
        }
    }
}`),
        });
        expect(found.filter((l) => l.startsWith("src/A.php"))).toEqual(["src/A.php:8 call Guard::multi()", "src/A.php:14 call Guard::multi()"]);
    });

    it("count a method's \`@phpstan-this-out\` as an assertion on what it is called on", async () => {
        const found = await calls({
            ...rules,
            "src/Node.php": php("App", "class Node extends Rule\n{\n    /** @phpstan-this-out Multi */\n    public function promote(): void {}\n}"),
            "src/A.php": php("App", "class A\n{\n    public function go(Node $x, Node $y): void\n    {\n        $x->promote();\n        $x->literals();\n        $y->literals();\n    }\n}"),
        });
        expect(found.filter((l) => l.startsWith("src/A.php"))).toEqual(["src/A.php:8 call Node::promote()", "src/A.php:10 call Rule::literals()"]);
    });

    it("test every argument of PHP's narrowing functions given a named one, and count a constructor's PHPDoc assertion and one written after a method's attributes", async () => {
        const found = await calls({
            ...rules,
            "src/Checker.php": php("App", String.raw`final class Checker
{
    /** @phpstan-assert Multi $x */
    public function __construct(Rule $x) {}

    #[\Deprecated]
    /** @phpstan-assert Multi $x */
    public static function multi(Rule $x): void {}
}`),
            "src/A.php": php("App", String.raw`class A
{
    public function go(Rule $x, array $subs, Rule $a, Rule $b): void
    {
        if (in_array(haystack: $subs, needle: $x, strict: true)) {
            $x->literals();
        }
        new Checker($a);
        $a->literals();
        Checker::multi($b);
        $b->literals();
    }
}`),
        });
        expect(found.filter((l) => l.startsWith("src/A.php"))).toEqual(["src/A.php:11 call Checker::__construct() (class Checker)", "src/A.php:13 call Checker::multi()"]);
    });
});

describe("PHP's \`static\` return type", () => {
    const base = php("App", "class Base\n{\n    public function fluent(): static { return $this; }\n    public function m(): void {}\n}");
    const sub = php("App", "class Sub extends Base\n{\n    public function m(): void {}\n\n    public function own(): void\n    {\n        Base::fluent()->m();\n        parent::fluent()->m();\n    }\n}");

    it("names nothing where a test may narrow the receiver, or where \`Base::m()\` passes \`$this\` on; \`parent::\` is the class written", async () => {
        const found = await calls({
            "src/Base.php": base,
            "src/Sub.php": sub,
            "src/A.php": php("App", String.raw`class A
{
    public function go(Base $x, Base $y, Base $w): void
    {
        if ($x instanceof Sub) {
            $x->fluent()->m();
        }
        if (!$y instanceof Sub) {
            return;
        }
        $z = $y->fluent();
        $z->m();
        $w->fluent()->m();
    }
}`),
        });
        expect(found).toEqual(["src/Sub.php:10 call Base::fluent()", "src/Sub.php:11 call Base::fluent()", "src/Sub.php:11 call Sub::m()", "src/A.php:9 call Base::fluent()", "src/A.php:14 call Base::fluent()", "src/A.php:16 call Base::fluent()", "src/A.php:16 call Base::m()"]);
    });
});

describe("PHP's private methods", () => {
    it("name nothing for \`$x->key()\` where the calling class has a private key, which PHP runs for an object of a class below it, but its own and an unrelated class's", async () => {
        const found = await calls({
            "src/Keyed.php": php("App", "interface Keyed\n{\n    public function key(): string;\n}"),
            "src/Leaf.php": php("App", "class Leaf extends Node implements Keyed\n{\n    public function key(): string { return ''; }\n}"),
            "src/Other.php": php("App", "class Other\n{\n    public function key(): string { return ''; }\n}"),
            "src/Uses.php": php("App", "trait Uses\n{\n    public function viaTrait(Leaf $o): string { return $o->key(); }\n}"),
            "src/Node.php": php("App", String.raw`class Node
{
    use Uses;

    private function key(): string { return ''; }

    public function go(Leaf $leaf, Keyed $keyed, Other $other, Node $node): void
    {
        $leaf->key();
        $keyed->key();
        $other->key();
        $node->key();
        $f = function () use ($leaf) { return $leaf->key(); };
    }
}`),
        });
        expect(found).toEqual(["src/Node.php:14 call Other::key()", "src/Node.php:15 call Node::key()"]);
    });
});

describe("PHP's enums", () => {
    it("leave \`cases\`, \`from\` and \`tryFrom\`, PHP's own, whatever an interface they implement declares", async () => {
        const found = await calls({
            "src/HasCases.php": php("App", "interface HasCases\n{\n    public static function cases(): array;\n    public static function from(int|string $v): static;\n    public static function tryFrom(int|string $v): ?static;\n    public function label(): string;\n}"),
            "src/Suit.php": php("App", "enum Suit: string implements HasCases\n{\n    case Hearts = 'h';\n\n    public function label(): string { return ''; }\n}"),
            "src/A.php": php("App", "class A\n{\n    public function go(Suit $s): void\n    {\n        Suit::cases();\n        Suit::from('h');\n        Suit::tryFrom('h');\n        $s->label();\n    }\n}"),
        });
        expect(found).toEqual(["src/A.php:11 call Suit::label()"]);
    });
});

describe("PHP's narrowed values", () => {
    it("leave a property the function assigns, and a variable given a value a test may narrow", async () => {
        const found = await calls({
            "src/Rule.php": php("App", "class Rule\n{\n    public function literals(): array { return []; }\n}"),
            "src/Multi.php": php("App", "class Multi extends Rule\n{\n    public function literals(): array { return [1]; }\n}"),
            "src/A.php": php("App", "class A\n{\n    private Rule $rule;\n\n    public function go(Rule $r): void\n    {\n        $this->rule = new Multi();\n        $this->rule->literals();\n        if ($r instanceof Multi) {\n            $s = $r;\n            $s->literals();\n        }\n    }\n\n    public function other(): void { $this->rule->literals(); }\n}"),
        });
        expect(found.filter((l) => !l.includes("call class"))).toEqual(["src/A.php:18 call Rule::literals()"]);
    });
});

describe("PHP's interfaces", () => {
    it("give their own method though a parent interface isn't read, and nothing where two interfaces declare it", async () => {
        const found = await calls({
            "src/IO.php": php("App", "interface IO extends \\Psr\\Log\\LoggerInterface\n{\n    public function write(): void;\n}"),
            "src/One.php": php("App", "interface One { public function run(): void; }"),
            "src/Two.php": php("App", "interface Two { public function run(): void; }"),
            "src/Both.php": php("App", "abstract class Both implements One, Two {}"),
            "src/A.php": php("App", "class A\n{\n    public function go(IO $io, Both $b): void { $io->write(); $io->log(); $b->run(); }\n}"),
        });
        expect(found).toEqual(["src/A.php:6 call IO::write()"]);
    });
});

describe("PHP's receivers", () => {
    it("are typed by a parameter its function never writes, a variable written once, a property's type, and a method's return type", async () => {
        const found = await calls({
            "src/B.php": B,
            "src/Pool.php": php("App", "class Pool\n{\n    public function fetch(): ?B { return null; }\n}"),
            "src/A.php": php(
                "App",
                "class A\n{\n    private Pool $pool;\n\n    public function __construct(private readonly ?B $b) {}\n\n    public function go(B $p, ?B $n, B|null $u): void\n    {\n        $p->pub();\n        $n->pub();\n        $u->pub();\n        $x = new B();\n        $x->pub()->pub();\n        $this->b->pub();\n        $this->pool->fetch()->pub();\n        (new B())->pub();\n        $y = $this->pool;\n        $y->fetch();\n    }\n}"
            ),
        });
        expect(found).toEqual([
            "src/A.php:12 call B::pub()",
            "src/A.php:13 call B::pub()",
            "src/A.php:14 call B::pub()",
            "src/A.php:15 call class B",
            "src/A.php:16 call B::pub()",
            "src/A.php:16 call B::pub()",
            "src/A.php:17 call B::pub()",
            "src/A.php:18 call Pool::fetch()",
            "src/A.php:18 call B::pub()",
            "src/A.php:19 call class B",
            "src/A.php:19 call B::pub()",
            "src/A.php:21 call Pool::fetch()",
        ]);
    });

    it("are what the nearest `$x = …` before them gives, where no other write runs between, a loop's included", async () => {
        const found = await calls({
            "src/B.php": B,
            "src/C.php": php("App", "class C\n{\n    public function next(): B { return new B(); }\n}"),
            "src/A.php": php(
                "App",
                "class A\n{\n    public function go(C $c): void\n    {\n        $x = new C();\n        $w = $x->next();\n        $x = $w;\n        $x->pub();\n        if ($c) {\n            $y = new B();\n        } else {\n            $y = new C();\n        }\n        $y->pub();\n        $z = new B();\n        while (true) {\n            $z->pub();\n            $z = new C();\n        }\n        $c->next();\n        $c = new B();\n        $c->pub();\n    }\n}"
            ),
        });
        expect(found.filter((l) => !l.includes("call class"))).toEqual(["src/A.php:9 call C::next()", "src/A.php:11 call B::pub()", "src/A.php:23 call C::next()", "src/A.php:25 call B::pub()"]);
    });

    it("are unknown past a write in an earlier \`elseif\`'s condition, but known past another branch's writes and through \`$x = $x->next()\`", async () => {
        const found = await calls({
            "src/B.php": B,
            "src/A.php": php("App", "class A\n{\n    public function go(B $x, $a): void\n    {\n        if ($a) {\n            $x = make();\n        } elseif ($x = make()) {\n        } elseif ($a > 1) {\n            $x->pub();\n        }\n    }\n\n    public function other(B $x, $a): void\n    {\n        if ($a) {\n            $x = make();\n        } else {\n            $x->pub();\n        }\n    }\n}"),
        });
        expect(found).toEqual(["src/A.php:21 call B::pub()"]);
    });

    it("are the value before a write in the expression, and the value one branch of a ternary gives the other", async () => {
        const found = await calls({
            "src/B.php": B,
            "src/C.php": php("App", "class C\n{\n    public function next(): B { return new B(); }\n}"),
            "src/A.php": php("App", "class A\n{\n    public function go(bool $f): void\n    {\n        $x = new C();\n        $x = $x->next();\n        $x->pub();\n        $y = new B();\n        $f ? $y = new C() : $y->pub();\n    }\n}"),
        });
        expect(found.filter((l) => !l.includes("call class"))).toEqual(["src/A.php:9 call C::next()", "src/A.php:10 call B::pub()", "src/A.php:12 call B::pub()"]);
    });

    it("are unknown for a variable written twice, by reference, by `foreach`, a list, `unset`, `global`, `static`, `catch` or `??=`, or in a function with `$$`, `extract` or `include`", async () => {
        const found = await calls({
            "src/B.php": B,
            "src/A.php": php(
                "App",
                "class A\n{\n    public function a(B $b): void { $b = make(); $b->pub(); }\n    public function b(B &$r): void { $r->pub(); }\n    public function c(): void { foreach ([] as $e) { $e = new B(); } $e->pub(); }\n    public function d(): void { $c = new B(); $f = function () use (&$c) {}; $c->pub(); }\n    public function e(): void { $d = new B(); $$name = 1; $d->pub(); }\n    public function f(B $b): void { try {} catch (\\Exception $b) {} $b->pub(); }\n    public function g(): void { [$x] = [new B()]; $x->pub(); $y = new B(); unset($y); $y->pub(); }\n    public function h(): void { global $g; $g = new B(); $g->pub(); static $s; $s = new B(); $s->pub(); }\n    public function i(): void { $z = new B(); $z ??= new B(); $z->pub(); $w = new B(); include 'x.php'; $w->pub(); }\n    public function j(): void { $v = new B(); extract([]); $v->pub(); }\n    public function k(B|A $both, B ...$many): void { $both->pub(); $many->pub(); }\n    public function l(): void { $q->pub(); }\n}"
            ),
        });
        expect(found.filter((l) => !l.endsWith("call class B"))).toEqual([]);
    });

    it("are unknown once passed to a function or method of a file read that takes a parameter by reference, or to `settype`", async () => {
        const found = await calls({
            "src/B.php": B,
            "src/A.php": php("App", "class A\n{\n    public function go(): void\n    {\n        $b = new B();\n        $c = new B();\n        reassign($b);\n        $this->keep($c);\n        $b->pub();\n        $c->pub();\n        $d = new B();\n        settype($d, 'array');\n        $d->pub();\n    }\n\n    private function keep(B $x): void {}\n}\n\nfunction reassign(&$v): void { $v = null; }"),
        });
        expect(found.filter((l) => !l.includes("call class"))).toEqual(["src/A.php:11 call A::keep()", "src/A.php:13 call B::pub()"]);
    });

    it("are unknown after a call that may take them by reference: a closure's or callable's, a function or method no file read declares, PHP's own not listed; a by-value one, or a read before the call or in its arguments, keeps them", async () => {
        const found = await calls({
            "src/B.php": B,
            "src/Swap.php": php("App", "class Swap\n{\n    public function __construct(&$out) {}\n\n    public function keep(B $b): void {}\n}"),
            "src/f.php": php("App", "function keep(B $b): void {}\nfunction swap(&$b): void {}"),
            "src/A.php": php("App", String.raw`use function App\swap as replace;

class A
{
    public function go(Swap $s, callable $f, array $xs): void
    {
        $a = new B();
        $a->pub();
        upgrade($a);
        $a->pub();
        $b = new B();
        $f($b);
        $b->pub();
        $c = new B();
        foreach ($xs as $x) {
            $c->pub();
            $s->unknown($c);
        }
        $d = new B();
        new Swap($d);
        $d->pub();
        $e = new B();
        keep($e);
        $s->keep($e);
        count([$e]);
        is_callable($e);
        $e->pub();
        $g = new B();
        replace($g);
        $g->pub();
        $h = new B();
        swap(b: $h);
        $h->pub();
        $i = new B();
        settype($i, 'object');
        $i->pub();
        $j = new B();
        keep2($j, $j->pub());
    }
}`),
        });
        expect(found.filter((l) => !l.includes("call class") && !/::(__construct|keep)\(\)/.test(l))).toEqual(["src/A.php:11 call B::pub()", "src/A.php:30 call B::pub()", "src/A.php:41 call B::pub()"]);
    });

    it("are unknown after given to a call no file read declares, which may assert their type, a property or a call's result as a variable; PHPUnit's assertions are known", async () => {
        const found = await calls({
            "src/B.php": B,
            "src/Holder.php": php("App", "class Holder\n{\n    public B $item;\n\n    public function get(): B { return $this->item; }\n}"),
            "tests/ATest.php": php("App\\Tests", String.raw`use App\B;
use App\Holder;

class ATest extends \PHPUnit\Framework\TestCase
{
    public function test(Holder $h, Holder $k, Holder $j, B $v): void
    {
        ensure_b($h->item);
        $h->item->pub();
        $k->item->pub();
        ensure_b($k->get());
        $k->get()->pub();
        $this->assertNotNull($j->item);
        $j->item->pub();
        $this->assertNotNull($v);
        $v->pub();
    }
}`),
        });
        expect(found.filter((l) => l.startsWith("tests/ATest.php") && !l.includes("call class"))).toEqual(["tests/ATest.php:13 call B::pub()", "tests/ATest.php:14 call Holder::get()", "tests/ATest.php:15 call Holder::get()", "tests/ATest.php:17 call B::pub()", "tests/ATest.php:19 call B::pub()"]);
    });

    it("are unknown, a property or call's result through \`$this\`, after \`$this\` is given to a call no file read declares; \`$this\` itself keeps its class", async () => {
        const found = await calls({
            "src/B.php": B,
            "src/f.php": php("App", "function keep(object $o): void {}"),
            "src/Holder.php": php("App", String.raw`class Holder
{
    public B $item;

    public function check(): void
    {
        $this->item->pub();
        ensure_item($this);
        $this->item->pub();
        $this->own();
    }

    public function known(): void
    {
        keep($this);
        $this->item->pub();
    }

    public function own(): void {}
}`),
        });
        expect(found.filter((l) => l.startsWith("src/Holder.php"))).toEqual(["src/Holder.php:10 call B::pub()", "src/Holder.php:13 call Holder::own()", "src/Holder.php:19 call B::pub()"]);
    });

    it("are unknown after passed to a method as an argument past its parameters, which an override may take by reference", async () => {
        const found = await calls({
            "src/B.php": B,
            "src/A.php": php("App", "class A\n{\n    public function take(B $x): void {}\n\n    public function go(): void\n    {\n        $a = new B();\n        $b = new B();\n        $this->take($a, $b);\n        $a->pub();\n        $b->pub();\n    }\n}"),
        });
        expect(found.filter((l) => !l.includes("call class"))).toEqual(["src/A.php:12 call A::take()", "src/A.php:13 call B::pub()"]);
    });

    it("are what a closure takes from the code around it: `use ($x)` and an arrow function's reads, never `use (&$x)`", async () => {
        const found = await calls({
            "src/B.php": B,
            "src/A.php": php("App", "class A\n{\n    public function go(B $b): void\n    {\n        $f = function () use ($b) { $b->pub(); };\n        $g = fn () => $b->pub();\n        $i = fn (B $c) => $c->pub();\n    }\n\n    public function byRef(B $b): void\n    {\n        $b->pub();\n        $h = function () use (&$b) { $b->pub(); };\n    }\n}"),
        });
        expect(found).toEqual(["src/A.php:8 call B::pub()", "src/A.php:9 call B::pub()", "src/A.php:10 call B::pub()"]);
    });

    it("read a property declared and visible, which `__get` never serves; leave a private one from another class, and an untyped one", async () => {
        const found = await calls({
            "src/B.php": B,
            "src/P.php": php("App", "class P\n{\n    private B $own;\n    protected B $shared;\n    public $loose;\n    public B $open;\n}"),
            "src/G.php": php("App", "class G\n{\n    public B $b;\n    public function __get($n) {}\n}"),
            "src/A.php": php("App", "class A extends P\n{\n    public function go(G $g): void { $this->own->pub(); $this->shared->pub(); $this->loose->pub(); $this->open->pub(); $g->b->pub(); }\n}"),
        });
        expect(found).toEqual(["src/A.php:6 call B::pub()", "src/A.php:6 call B::pub()", "src/A.php:6 call B::pub()"]);
    });
});

describe("PHP's first-class callables", () => {
    it("name their method as a value, not a call", async () => {
        const found = await links({ "src/B.php": B, "src/A.php": php("App", "class A\n{\n    public function go(B $b): void { $f = $b->pub(...); $b->pub(); }\n}") });
        expect(found.filter((l) => l.startsWith("src/A.php"))).toEqual(["src/A.php:6 type class B", "src/A.php:6 value B::pub()", "src/A.php:6 call B::pub()"]);
    });
});

describe("PHP's `new`", () => {
    it("names the class and the constructor it runs: its own, an inherited one, or the class where none is declared", async () => {
        const found = await links({
            "src/P.php": php("App", "class P\n{\n    public function __construct() {}\n}"),
            "src/C.php": php("App", "class C extends P {}"),
            "src/D.php": php("App", "class D {}"),
            "src/E.php": php("App", "class E extends Missing {}"),
            "src/F.php": php("App", "abstract class F {}"),
            "src/A.php": php("App", "class A\n{\n    public function go(): void { new P(); new C(); new D(); new E(); new F(); }\n}"),
        });
        expect(found.filter((l) => l.startsWith("src/A.php"))).toEqual([
            "src/A.php:6 type class P",
            "src/A.php:6 call P::__construct() (class P)",
            "src/A.php:6 type class C",
            "src/A.php:6 call P::__construct() (class C)",
            "src/A.php:6 type class D",
            "src/A.php:6 call class D",
            "src/A.php:6 type class E",
            "src/A.php:6 type class F",
        ]);
    });
});

describe("PHP's functions", () => {
    it("name nothing: a namespace's call may fall back to a global function, and only a `files` autoload or a `require` loads a function's file", async () => {
        const found = await calls({
            "src/f.php": "<?php\nnamespace App;\n\nuse function App\\twice as double;\n\nfunction twice($x) { return $x * 2; }\n\ntwice(1);\ndouble(2);\n\\App\\twice(3);\n",
            "src/g.php": "<?php\nfunction plain() {}\nplain();\n",
        });
        expect(found).toEqual([]);
    });
});

describe("PHP files the parser read with errors", () => {
    it("name nothing: a gap may hide a `use`, a namespace or a write", async () => {
        const found = await calls({ "src/B.php": B, "src/A.php": php("App", "class A\n{\n    public function go(B $b): void { $b->pub(); $x = ; }\n}") });
        expect(found).toEqual([]);
    });
});

describe("PHP's reads", () => {
    const want = async (files: Record<string, string>, exists: (path: string) => boolean | undefined) => {
        const all: Record<string, string> = { "composer.json": JSON.stringify({ autoload: { "psr-4": { "App\\": "src/", "App\\Support\\": ["src/Macroable/", "src/Collections/"] } } }), ...files };
        return phpWants(await parse(all), { known: Object.keys(all), text: (p) => all[p], exists }, (p) => p === "src/A.php");
    };

    it("want the file Composer would load for each class a changed file's sites reach, the first not known missing", async () => {
        const a = { "src/A.php": php("App", "use App\\Support\\Str;\n\nclass A extends Base\n{\n    public function go(Str $s): void { $this->run(); }\n}") };
        expect(await want(a, (p) => (p in a ? true : undefined))).toEqual(["src/Base.php", "src/Macroable/Str.php"]);
        expect(await want(a, (p) => (p in a ? true : p === "src/Macroable/Str.php" || p === "src/Collections/Str.php" ? false : undefined))).toEqual(["src/Base.php", "src/Support/Str.php"]);
    });

    it("want the parents of a receiver that trait or closure code calls: one may have a private method PHP runs instead", async () => {
        const files = {
            "src/A.php": php("App", "trait A\n{\n    public function same(Leaf $o): string { return $o->key(); }\n}"),
            "src/Leaf.php": php("App", "class Leaf extends Node\n{\n    public function key(): string { return ''; }\n}"),
        };
        expect(await want(files, (p) => (p in files ? true : undefined))).toEqual(["src/Node.php"]);
    });

    it("want a parent once its child is read and a lookup goes past it, never a package's class", async () => {
        const files = { "src/A.php": php("App", "use Psr\\Log\\LoggerInterface;\n\nclass A extends Base\n{\n    public function go(LoggerInterface $l): void { $this->run(); }\n}"), "src/Base.php": php("App", "class Base extends Root {}") };
        expect(await want(files, (p) => (p in files ? true : undefined))).toEqual(["src/Root.php"]);
    });
});
