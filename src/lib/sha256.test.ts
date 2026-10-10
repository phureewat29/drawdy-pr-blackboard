import { describe, expect, it } from "@jest/globals";
import { createHash } from "node:crypto";
import { PINS } from "../driver/grammars.ts";
import { wasmBytes } from "../test/parser.ts";
import { sha256 } from "./sha256.ts";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("sha256", () => {
    it("gives the standard test vectors", () => {
        expect(sha256(bytes(""))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        expect(sha256(bytes("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        expect(sha256(bytes("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
        expect(sha256(bytes("a".repeat(1_000_000)))).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
    });

    it("agrees with Node's at every length around a block's padding", () => {
        for (let n = 50; n < 70; n++) {
            const data = Uint8Array.from({ length: n }, (_, i) => (i * 31) & 255);
            expect(sha256(data)).toBe(createHash("sha256").update(data).digest("hex"));
        }
    });

    it("hashes each pinned devDependency's wasm to its pin, so the bytes tested are the bytes shipped", () => {
        for (const name of ["runtime", "typescript", "tsx", "javascript"] as const) expect([name, sha256(wasmBytes(name))]).toEqual([name, PINS[name].sha256]);
    });
});
