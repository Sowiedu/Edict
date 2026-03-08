// =============================================================================
// Contract Verification Cache Tests
// =============================================================================
// 8 tests covering cache hit/miss behavior, invalidation, and performance.

import { describe, it, expect, beforeEach } from "vitest";
import { contractVerify, clearVerificationCache } from "../../src/contracts/verify.js";
import type { EdictModule, FunctionDef, Expression, Contract, Param } from "../../src/ast/nodes.js";

// ---------------------------------------------------------------------------
// Helpers (mirror verify.test.ts conventions)
// ---------------------------------------------------------------------------

let idCounter = 0;
function uid(): string { return `cache-test-${++idCounter}`; }

function mkLit(value: number | boolean): Expression {
    const id = uid();
    if (typeof value === "number") {
        return { kind: "literal", id, value, type: { kind: "basic", name: "Int" } } as any;
    }
    return { kind: "literal", id, value, type: { kind: "basic", name: "Bool" } } as any;
}

function mkIdent(name: string): Expression {
    return { kind: "ident", id: uid(), name };
}

function mkBinop(op: string, left: Expression, right: Expression): Expression {
    return { kind: "binop", id: uid(), op, left, right } as any;
}

function mkParam(name: string, typeName: string): Param {
    return { kind: "param", id: uid(), name, type: { kind: "basic", name: typeName } } as any;
}

function mkPre(condition: Expression): Contract {
    return { kind: "pre", id: uid(), condition };
}

function mkPost(condition: Expression): Contract {
    return { kind: "post", id: uid(), condition };
}

function mkFn(opts: {
    name?: string;
    params?: Param[];
    contracts?: Contract[];
    body?: Expression[];
}): FunctionDef {
    return {
        kind: "fn",
        id: uid(),
        name: opts.name ?? "testFn",
        params: opts.params ?? [],
        effects: ["pure"],
        returnType: { kind: "basic", name: "Int" },
        contracts: opts.contracts ?? [],
        body: opts.body ?? [mkLit(0)],
    };
}

function mkModule(defs: FunctionDef[]): EdictModule {
    return {
        kind: "module",
        id: uid(),
        name: "test",
        imports: [],
        definitions: defs,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("contract verification cache", () => {
    beforeEach(() => {
        clearVerificationCache();
        idCounter = 0;
    });

    it("1. cache hit — same program verified twice has hits > 0", async () => {
        // Create a function with contracts — use fixed structure (no uid in
        // the structure that feeds the hash, only in `id` fields which are stripped)
        const mkFnFixed = () => mkFn({
            name: "f",
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
            ],
            body: [mkBinop("+", mkIdent("x"), mkLit(1))],
        });

        const r1 = await contractVerify(mkModule([mkFnFixed()]));
        expect(r1.errors).toHaveLength(0);
        expect(r1.cacheStats?.hits).toBe(0);
        expect(r1.cacheStats?.misses).toBeGreaterThan(0);

        const r2 = await contractVerify(mkModule([mkFnFixed()]));
        expect(r2.errors).toHaveLength(0);
        expect(r2.cacheStats?.hits).toBeGreaterThan(0);
    });

    it("2. cache miss on body change", async () => {
        const fn1 = mkFn({
            name: "f",
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
            ],
            body: [mkBinop("+", mkIdent("x"), mkLit(1))],
        });

        const r1 = await contractVerify(mkModule([fn1]));
        expect(r1.cacheStats?.misses).toBeGreaterThan(0);

        // Same structure but different body: x + 2 instead of x + 1
        const fn2 = mkFn({
            name: "f",
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
            ],
            body: [mkBinop("+", mkIdent("x"), mkLit(2))],
        });

        const r2 = await contractVerify(mkModule([fn2]));
        // Body changed → cache miss
        expect(r2.cacheStats?.hits).toBe(0);
        expect(r2.cacheStats?.misses).toBeGreaterThan(0);
    });

    it("3. cache miss on contract change", async () => {
        const fn1 = mkFn({
            name: "f",
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
            ],
            body: [mkIdent("x")],
        });

        await contractVerify(mkModule([fn1]));

        // Change postcondition: result >= 0 instead of result > 0
        const fn2 = mkFn({
            name: "f",
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">=", mkIdent("result"), mkLit(0))),
            ],
            body: [mkIdent("x")],
        });

        const r2 = await contractVerify(mkModule([fn2]));
        expect(r2.cacheStats?.hits).toBe(0);
    });

    it("4. cache miss on param change", async () => {
        const fn1 = mkFn({
            name: "f",
            params: [mkParam("x", "Int")],
            contracts: [mkPost(mkBinop(">=", mkIdent("result"), mkLit(0)))],
            body: [mkLit(42)],
        });

        await contractVerify(mkModule([fn1]));

        // Change param type: Float instead of Int
        const fn2 = mkFn({
            name: "f",
            params: [mkParam("x", "Float")],
            contracts: [mkPost(mkBinop(">=", mkIdent("result"), mkLit(0)))],
            body: [mkLit(42)],
        });

        const r2 = await contractVerify(mkModule([fn2]));
        expect(r2.cacheStats?.hits).toBe(0);
    });

    it("5. transitive invalidation — callee contract change invalidates caller", async () => {
        const callee1 = mkFn({
            name: "callee",
            params: [mkParam("x", "Int")],
            contracts: [mkPre(mkBinop(">", mkIdent("x"), mkLit(0)))],
            body: [mkIdent("x")],
        });

        const caller = mkFn({
            name: "caller",
            params: [mkParam("n", "Int")],
            contracts: [mkPre(mkBinop(">", mkIdent("n"), mkLit(0)))],
            body: [{ kind: "call", id: uid(), fn: mkIdent("callee"), args: [mkIdent("n")] } as any],
        });

        await contractVerify(mkModule([callee1, caller]));

        // Change callee precondition: x > 10 instead of x > 0
        const callee2 = mkFn({
            name: "callee",
            params: [mkParam("x", "Int")],
            contracts: [mkPre(mkBinop(">", mkIdent("x"), mkLit(10)))],
            body: [mkIdent("x")],
        });

        // Rebuild caller with fresh IDs (same structure)
        const caller2 = mkFn({
            name: "caller",
            params: [mkParam("n", "Int")],
            contracts: [mkPre(mkBinop(">", mkIdent("n"), mkLit(0)))],
            body: [{ kind: "call", id: uid(), fn: mkIdent("callee"), args: [mkIdent("n")] } as any],
        });

        const r2 = await contractVerify(mkModule([callee2, caller2]));
        // Callee contract changed → caller's callsite check cache invalidated
        // (caller's hash includes callee's contract AST)
        expect(r2.cacheStats?.hits).toBe(0);
    });

    it("6. clearVerificationCache resets cache", async () => {
        const mkFnFixed = () => mkFn({
            name: "f",
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
            ],
            body: [mkIdent("x")],
        });

        await contractVerify(mkModule([mkFnFixed()]));

        clearVerificationCache();

        const r2 = await contractVerify(mkModule([mkFnFixed()]));
        expect(r2.cacheStats?.hits).toBe(0);
        expect(r2.cacheStats?.misses).toBeGreaterThan(0);
    });

    it("7. mixed hit/miss — 2 functions, change one", async () => {
        const fn1 = () => mkFn({
            name: "unchanged",
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
            ],
            body: [mkIdent("x")],
        });

        const fn2v1 = mkFn({
            name: "changed",
            params: [mkParam("y", "Int")],
            contracts: [mkPost(mkBinop(">=", mkIdent("result"), mkLit(0)))],
            body: [mkLit(1)],
        });

        await contractVerify(mkModule([fn1(), fn2v1]));

        // Change fn2's body
        const fn2v2 = mkFn({
            name: "changed",
            params: [mkParam("y", "Int")],
            contracts: [mkPost(mkBinop(">=", mkIdent("result"), mkLit(0)))],
            body: [mkLit(2)],
        });

        const r2 = await contractVerify(mkModule([fn1(), fn2v2]));
        // "unchanged" should be a cache hit, "changed" should be a miss
        expect(r2.cacheStats?.hits).toBeGreaterThanOrEqual(1);
        expect(r2.cacheStats?.misses).toBeGreaterThanOrEqual(1);
    });

    it("8. performance — second verification is fast (cache hit)", async () => {
        // Use a function with multiple contracts to make Z3 work non-trivially
        const mkComplexFn = () => mkFn({
            name: "complex",
            params: [mkParam("a", "Int"), mkParam("b", "Int")],
            contracts: [
                mkPre(mkBinop("and",
                    mkBinop(">", mkIdent("a"), mkLit(0)),
                    mkBinop(">", mkIdent("b"), mkLit(0)),
                )),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkIdent("a"))),
            ],
            body: [mkBinop("+", mkBinop("+", mkIdent("a"), mkIdent("b")), mkLit(1))],
        });

        // First call — cold (Z3 runs)
        await contractVerify(mkModule([mkComplexFn()]));

        // Second call — should be cached (fast)
        const start = performance.now();
        const r2 = await contractVerify(mkModule([mkComplexFn()]));
        const elapsed = performance.now() - start;

        expect(r2.cacheStats?.hits).toBeGreaterThan(0);
        expect(elapsed).toBeLessThan(100); // Cache hit should be < 100ms
    });
});
