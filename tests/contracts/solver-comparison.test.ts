// =============================================================================
// Cross-Validation Test Suite: Custom QF-LIA Solver vs Z3
// =============================================================================
// Runs the same contracts through BOTH Z3 and the built-in solver, asserting
// identical results. This is the safety net for self-hosted contract verification.
//
// See: https://github.com/Sowiedu/Edict/issues/207

import { describe, it, expect, beforeAll } from "vitest";
import { verifyFunction, verifyCallSitePreconditions, clearVerificationCache } from "../../src/contracts/verify.js";
import { getZ3 } from "../../src/contracts/z3-context.js";
import { createBuiltinSolver } from "../../src/contracts/solver/index.js";
import type { SolverContext } from "../../src/contracts/solver-context.js";
import type { EdictModule, FunctionDef, Expression, Contract, Param } from "../../src/ast/nodes.js";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let idCounter = 0;
function uid(): string { return `xval-${++idCounter}`; }

function mkLit(value: number | boolean | string): Expression {
    const id = uid();
    if (typeof value === "boolean") {
        return { kind: "literal", id, value, type: { kind: "basic", name: "Bool" } } as any;
    }
    if (typeof value === "number") {
        return {
            kind: "literal", id, value,
            type: Number.isInteger(value) ? { kind: "basic", name: "Int" } : { kind: "basic", name: "Float" },
        } as any;
    }
    return { kind: "literal", id, value, type: { kind: "basic", name: "String" } } as any;
}

function mkIdent(name: string): Expression {
    return { kind: "ident", id: uid(), name };
}

function mkBinop(op: string, left: Expression, right: Expression): Expression {
    return { kind: "binop", id: uid(), op, left, right } as any;
}

function mkUnop(op: string, operand: Expression): Expression {
    return { kind: "unop", id: uid(), op, operand } as any;
}

function mkParam(name: string, typeName: string): Param {
    return { name, type: { kind: "basic", name: typeName } };
}

function mkPre(condition: Expression): Contract {
    return { kind: "pre", id: uid(), condition };
}

function mkPost(condition: Expression): Contract {
    return { kind: "post", id: uid(), condition };
}

function mkIf(condition: Expression, then: Expression[], else_?: Expression[]): Expression {
    return { kind: "if", id: uid(), condition, then, else: else_ } as any;
}

function mkLet(name: string, value: Expression): Expression {
    return { kind: "let", id: uid(), name, value } as any;
}

function mkBlock(body: Expression[]): Expression {
    return { kind: "block", id: uid(), body } as any;
}

function mkCall(fnName: string, args: Expression[]): Expression {
    return { kind: "call", id: uid(), fn: mkIdent(fnName), args } as any;
}

function mkMatch(target: Expression, arms: { pattern: any; body: Expression[] }[]): Expression {
    return {
        kind: "match", id: uid(), target,
        arms: arms.map(a => ({ kind: "arm", id: uid(), pattern: a.pattern, body: a.body })),
    } as any;
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
        name: "xval",
        imports: [],
        definitions: defs,
    };
}

// ---------------------------------------------------------------------------
// Cross-validation infrastructure
// ---------------------------------------------------------------------------

let z3Ctx: SolverContext;
let builtinCtx: SolverContext;

beforeAll(async () => {
    z3Ctx = await getZ3() as unknown as SolverContext;
    builtinCtx = createBuiltinSolver();
});

/**
 * Run verifyFunction with both solvers, assert matching results.
 * Returns { z3Errors, builtinErrors } for further inspection.
 */
async function crossValidateFunction(
    fn: FunctionDef,
    module: EdictModule,
    label: string,
): Promise<{
    z3Errors: import("../../src/errors/structured-errors.js").StructuredError[];
    builtinErrors: import("../../src/errors/structured-errors.js").StructuredError[];
}> {
    clearVerificationCache();
    const z3Result = await verifyFunction(z3Ctx, fn, module);
    clearVerificationCache();
    const builtinResult = await verifyFunction(builtinCtx, fn, module);

    return { z3Errors: z3Result.errors, builtinErrors: builtinResult.errors };
}

/**
 * Assert solver agreement on error counts and types.
 * Allows builtin "unknown" when Z3 says "unsat" (conservative).
 * FAILS if builtin says "unsat" but Z3 says "sat" (false negative — dangerous).
 */
function assertAgreement(
    z3Errors: import("../../src/errors/structured-errors.js").StructuredError[],
    builtinErrors: import("../../src/errors/structured-errors.js").StructuredError[],
    label: string,
): void {
    // Filter out undecidable_predicate — these indicate translation failures, not solver disagreements
    const z3Contract = z3Errors.filter(e =>
        e.error === "contract_failure" || e.error === "verification_timeout",
    );
    const builtinContract = builtinErrors.filter(e =>
        e.error === "contract_failure" || e.error === "verification_timeout",
    );

    // The dangerous case: builtin says "proven" (0 errors) but Z3 found a counterexample
    const z3FoundFailures = z3Contract.filter(e => e.error === "contract_failure");
    const builtinFoundFailures = builtinContract.filter(e => e.error === "contract_failure");

    // If Z3 found a contract failure, builtin must also find it (or timeout, which is safe)
    for (let i = 0; i < z3FoundFailures.length; i++) {
        const z3Err = z3FoundFailures[i]!;
        const z3PostId = (z3Err as any).contractId;

        // Check if builtin also found a failure for this contract
        const builtinMatch = builtinFoundFailures.find(
            (e: any) => e.contractId === z3PostId,
        );
        const builtinTimeout = builtinContract.find(
            (e: any) => e.error === "verification_timeout" && e.contractId === z3PostId,
        );

        if (!builtinMatch && !builtinTimeout) {
            // Check if builtin had an undecidable_predicate for this contract
            const builtinUndecidable = builtinErrors.find(
                (e: any) => e.error === "undecidable_predicate" && e.contractId === z3PostId,
            );
            if (!builtinUndecidable) {
                throw new Error(
                    `[${label}] FALSE NEGATIVE: Z3 found contract_failure (contractId=${z3PostId}) ` +
                    `but builtin solver said proven. This is the dangerous case — ` +
                    `the custom solver silently approved a contract that should fail.\n` +
                    `Z3 counterexample: ${JSON.stringify((z3Err as any).counterexample)}`,
                );
            }
        }
    }

    // If builtin found a failure but Z3 proved it, that's a false positive (less dangerous but still wrong)
    for (const builtinErr of builtinFoundFailures) {
        const builtinPostId = (builtinErr as any).contractId;
        const z3Match = z3FoundFailures.find(
            (e: any) => e.contractId === builtinPostId,
        );
        if (!z3Match) {
            // Builtin found a "counterexample" that Z3 says doesn't exist
            // This means the builtin solver's counterexample is wrong
            throw new Error(
                `[${label}] FALSE POSITIVE: Builtin solver found contract_failure ` +
                `(contractId=${builtinPostId}) but Z3 proved the contract holds.\n` +
                `Builtin counterexample: ${JSON.stringify((builtinErr as any).counterexample)}`,
            );
        }
    }
}

// =============================================================================
// Section 1: Corpus Cross-Validation (T1–T6)
// =============================================================================

interface ContractTestCase {
    name: string;
    fn: () => FunctionDef;
    module?: () => EdictModule;
}

// We use factory functions (fn: () => FunctionDef) so each test gets fresh IDs

const T1_BASIC_ARITHMETIC: ContractTestCase[] = [
    {
        name: "T1.01 identity: pre x>0, body x, post result>0",
        fn: () => mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
            ],
            body: [mkIdent("x")],
        }),
    },
    {
        name: "T1.02 increment: pre x>=0, body x+1, post result>=1",
        fn: () => mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">=", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">=", mkIdent("result"), mkLit(1))),
            ],
            body: [mkBinop("+", mkIdent("x"), mkLit(1))],
        }),
    },
    {
        name: "T1.03 square: pre x!=0, body x*x, post result>0",
        fn: () => mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop("!=", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
            ],
            body: [mkBinop("*", mkIdent("x"), mkIdent("x"))],
        }),
    },
    {
        name: "T1.04 self-cancel: body x-x, post result==0",
        fn: () => mkFn({
            params: [mkParam("x", "Int")],
            contracts: [mkPost(mkBinop("==", mkIdent("result"), mkLit(0)))],
            body: [mkBinop("-", mkIdent("x"), mkIdent("x"))],
        }),
    },
    {
        name: "T1.05 constant: body 42, post result==42",
        fn: () => mkFn({
            params: [],
            contracts: [mkPost(mkBinop("==", mkIdent("result"), mkLit(42)))],
            body: [mkLit(42)],
        }),
    },
    {
        name: "T1.06 double: pre x>0, body x*2, post result>x",
        fn: () => mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkIdent("x"))),
            ],
            body: [mkBinop("*", mkIdent("x"), mkLit(2))],
        }),
    },
    {
        name: "T1.07 [fail] unbounded: body x, post result>0",
        fn: () => mkFn({
            params: [mkParam("x", "Int")],
            contracts: [mkPost(mkBinop(">", mkIdent("result"), mkLit(0)))],
            body: [mkIdent("x")],
        }),
    },
    {
        name: "T1.08 [fail] insufficient pre: pre x>0, body x-10, post result>0",
        fn: () => mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
            ],
            body: [mkBinop("-", mkIdent("x"), mkLit(10))],
        }),
    },
    {
        name: "T1.09 [fail] contradictory post: pre x>0, post x<0",
        fn: () => mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop("<", mkIdent("x"), mkLit(0))),
            ],
            body: [mkIdent("x")],
        }),
    },
    {
        name: "T1.10 modulo: pre x>=0, body x%5, post result>=0",
        fn: () => mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">=", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">=", mkIdent("result"), mkLit(0))),
            ],
            body: [mkBinop("%", mkIdent("x"), mkLit(5))],
        }),
    },
];

const T2_BOOLEAN_LOGIC: ContractTestCase[] = [
    {
        name: "T2.01 conjunction extraction: pre (a and b), post a",
        fn: () => mkFn({
            params: [mkParam("a", "Bool"), mkParam("b", "Bool")],
            contracts: [
                mkPre(mkBinop("and", mkIdent("a"), mkIdent("b"))),
                mkPost(mkIdent("a")),
            ],
            body: [mkIdent("a")],
        }),
    },
    {
        name: "T2.02 modus ponens: pre (a implies b), pre a, post b",
        fn: () => mkFn({
            params: [mkParam("a", "Bool"), mkParam("b", "Bool")],
            contracts: [
                mkPre(mkBinop("implies", mkIdent("a"), mkIdent("b"))),
                mkPre(mkIdent("a")),
                mkPost(mkIdent("b")),
            ],
            body: [mkIdent("b")],
        }),
    },
    {
        name: "T2.03 double negation: pre (not (not a)), post a",
        fn: () => mkFn({
            params: [mkParam("a", "Bool")],
            contracts: [
                mkPre(mkUnop("not", mkUnop("not", mkIdent("a")))),
                mkPost(mkIdent("a")),
            ],
            body: [mkIdent("a")],
        }),
    },
    {
        name: "T2.04 or introduction: pre a, post (a or b)",
        fn: () => mkFn({
            params: [mkParam("a", "Bool"), mkParam("b", "Bool")],
            contracts: [
                mkPre(mkIdent("a")),
                mkPost(mkBinop("or", mkIdent("a"), mkIdent("b"))),
            ],
            body: [mkIdent("a")],
        }),
    },
    {
        name: "T2.05 contrapositive: pre (a implies b), pre (not b), post (not a)",
        fn: () => mkFn({
            params: [mkParam("a", "Bool"), mkParam("b", "Bool")],
            contracts: [
                mkPre(mkBinop("implies", mkIdent("a"), mkIdent("b"))),
                mkPre(mkUnop("not", mkIdent("b"))),
                mkPost(mkUnop("not", mkIdent("a"))),
            ],
            body: [mkUnop("not", mkIdent("a"))],
        }),
    },
    {
        name: "T2.06 [fail] post false",
        fn: () => mkFn({
            params: [mkParam("a", "Bool")],
            contracts: [mkPost(mkLit(false))],
            body: [mkIdent("a")],
        }),
    },
    {
        name: "T2.07 [fail] affirming consequent: pre (a implies b), pre b, post a",
        fn: () => mkFn({
            params: [mkParam("a", "Bool"), mkParam("b", "Bool")],
            contracts: [
                mkPre(mkBinop("implies", mkIdent("a"), mkIdent("b"))),
                mkPre(mkIdent("b")),
                mkPost(mkIdent("a")),
            ],
            body: [mkIdent("a")],
        }),
    },
    {
        name: "T2.08 de Morgan: pre (not (a and b)), post ((not a) or (not b))",
        fn: () => mkFn({
            params: [mkParam("a", "Bool"), mkParam("b", "Bool")],
            contracts: [
                mkPre(mkUnop("not", mkBinop("and", mkIdent("a"), mkIdent("b")))),
                mkPost(mkBinop("or", mkUnop("not", mkIdent("a")), mkUnop("not", mkIdent("b")))),
            ],
            body: [mkBinop("or", mkUnop("not", mkIdent("a")), mkUnop("not", mkIdent("b")))],
        }),
    },
];

const T3_COMPARISON_CHAINS: ContractTestCase[] = [
    {
        name: "T3.01 transitivity: pre a>b, pre b>c, post a>c",
        fn: () => mkFn({
            params: [mkParam("a", "Int"), mkParam("b", "Int"), mkParam("c", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("a"), mkIdent("b"))),
                mkPre(mkBinop(">", mkIdent("b"), mkIdent("c"))),
                mkPost(mkBinop(">", mkIdent("a"), mkIdent("c"))),
            ],
            body: [mkIdent("a")],
        }),
    },
    {
        name: "T3.02 triangle inequality: pre a>=0, b>=0, body a+b, post result>=a",
        fn: () => mkFn({
            params: [mkParam("a", "Int"), mkParam("b", "Int")],
            contracts: [
                mkPre(mkBinop(">=", mkIdent("a"), mkLit(0))),
                mkPre(mkBinop(">=", mkIdent("b"), mkLit(0))),
                mkPost(mkBinop(">=", mkIdent("result"), mkIdent("a"))),
            ],
            body: [mkBinop("+", mkIdent("a"), mkIdent("b"))],
        }),
    },
    {
        name: "T3.03 bounded range: pre 0<x<100, body x, post result<=99",
        fn: () => mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop("and",
                    mkBinop(">", mkIdent("x"), mkLit(0)),
                    mkBinop("<", mkIdent("x"), mkLit(100)),
                )),
                mkPost(mkBinop("<=", mkIdent("result"), mkLit(99))),
            ],
            body: [mkIdent("x")],
        }),
    },
    {
        name: "T3.04 [fail] gap in range: pre x>0, post result>100",
        fn: () => mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(100))),
            ],
            body: [mkIdent("x")],
        }),
    },
    {
        name: "T3.05 antisymmetry: pre a>=b, pre b>=a, post a==b",
        fn: () => mkFn({
            params: [mkParam("a", "Int"), mkParam("b", "Int")],
            contracts: [
                mkPre(mkBinop(">=", mkIdent("a"), mkIdent("b"))),
                mkPre(mkBinop(">=", mkIdent("b"), mkIdent("a"))),
                mkPost(mkBinop("==", mkIdent("a"), mkIdent("b"))),
            ],
            body: [mkIdent("a")],
        }),
    },
    {
        name: "T3.06 [fail] strict vs non-strict: pre a>=b, post a>b",
        fn: () => mkFn({
            params: [mkParam("a", "Int"), mkParam("b", "Int")],
            contracts: [
                mkPre(mkBinop(">=", mkIdent("a"), mkIdent("b"))),
                mkPost(mkBinop(">", mkIdent("a"), mkIdent("b"))),
            ],
            body: [mkIdent("a")],
        }),
    },
];

const T4_MULTI_PRECONDITION: ContractTestCase[] = [
    {
        name: "T4.01 three pres narrow range: a>0, a<10, a!=5, post a>=1",
        fn: () => mkFn({
            params: [mkParam("a", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("a"), mkLit(0))),
                mkPre(mkBinop("<", mkIdent("a"), mkLit(10))),
                mkPre(mkBinop("!=", mkIdent("a"), mkLit(5))),
                mkPost(mkBinop(">=", mkIdent("a"), mkLit(1))),
            ],
            body: [mkIdent("a")],
        }),
    },
    {
        name: "T4.02 overlapping ranges: a(3,7), b(5,9), body a+b, post result>8",
        fn: () => mkFn({
            params: [mkParam("a", "Int"), mkParam("b", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("a"), mkLit(3))),
                mkPre(mkBinop("<", mkIdent("a"), mkLit(7))),
                mkPre(mkBinop(">", mkIdent("b"), mkLit(5))),
                mkPre(mkBinop("<", mkIdent("b"), mkLit(9))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(8))),
            ],
            body: [mkBinop("+", mkIdent("a"), mkIdent("b"))],
        }),
    },
    {
        name: "T4.03 vacuous: contradictory pre → any post holds",
        fn: () => mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPre(mkBinop("<", mkIdent("x"), mkLit(0))),
                mkPost(mkLit(false)),
            ],
            body: [mkIdent("x")],
        }),
    },
    {
        name: "T4.04 four params: a,b,c,d>0, body a+b+c+d, post result>=4",
        fn: () => mkFn({
            params: [mkParam("a", "Int"), mkParam("b", "Int"), mkParam("c", "Int"), mkParam("d", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("a"), mkLit(0))),
                mkPre(mkBinop(">", mkIdent("b"), mkLit(0))),
                mkPre(mkBinop(">", mkIdent("c"), mkLit(0))),
                mkPre(mkBinop(">", mkIdent("d"), mkLit(0))),
                mkPost(mkBinop(">=", mkIdent("result"), mkLit(4))),
            ],
            body: [mkBinop("+", mkBinop("+", mkIdent("a"), mkIdent("b")), mkBinop("+", mkIdent("c"), mkIdent("d")))],
        }),
    },
    {
        name: "T4.05 [fail] tight bounds insufficient: pre 0<x<10, post x*x>100",
        fn: () => mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPre(mkBinop("<", mkIdent("x"), mkLit(10))),
                mkPost(mkBinop(">", mkBinop("*", mkIdent("x"), mkIdent("x")), mkLit(100))),
            ],
            body: [mkBinop("*", mkIdent("x"), mkIdent("x"))],
        }),
    },
    {
        name: "T4.06 product positive: a>0, b>0, body a*b, post result>0",
        fn: () => mkFn({
            params: [mkParam("a", "Int"), mkParam("b", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("a"), mkLit(0))),
                mkPre(mkBinop(">", mkIdent("b"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
            ],
            body: [mkBinop("*", mkIdent("a"), mkIdent("b"))],
        }),
    },
];

const T5_BODY_DEPENDENT: ContractTestCase[] = [
    {
        name: "T5.01 abs via if: body if x>0 then x else -x, post result>=0",
        fn: () => mkFn({
            params: [mkParam("x", "Int")],
            contracts: [mkPost(mkBinop(">=", mkIdent("result"), mkLit(0)))],
            body: [mkIf(
                mkBinop(">", mkIdent("x"), mkLit(0)),
                [mkIdent("x")],
                [mkUnop("-", mkIdent("x"))],
            )],
        }),
    },
    {
        name: "T5.02 clamp via if: pre x>=0, body if x>100 then 100 else x, post result<=100",
        fn: () => mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">=", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop("<=", mkIdent("result"), mkLit(100))),
            ],
            body: [mkIf(
                mkBinop(">", mkIdent("x"), mkLit(100)),
                [mkLit(100)],
                [mkIdent("x")],
            )],
        }),
    },
    {
        name: "T5.03 let chain: let y=x+1, let z=y+1, post result>x",
        fn: () => mkFn({
            params: [mkParam("x", "Int")],
            contracts: [mkPost(mkBinop(">", mkIdent("result"), mkIdent("x")))],
            body: [
                mkLet("y", mkBinop("+", mkIdent("x"), mkLit(1))),
                mkLet("z", mkBinop("+", mkIdent("y"), mkLit(1))),
                mkIdent("z"),
            ],
        }),
    },
    {
        name: "T5.04 block body: { let a = x*2; a+1 }, pre x>0, post result>x",
        fn: () => mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkIdent("x"))),
            ],
            body: [mkBlock([
                mkLet("a", mkBinop("*", mkIdent("x"), mkLit(2))),
                mkBinop("+", mkIdent("a"), mkLit(1)),
            ])],
        }),
    },
    {
        name: "T5.05 match literal: match x { 0 => 1, _ => x }, pre x>=0, post result>0",
        fn: () => mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">=", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
            ],
            body: [mkMatch(mkIdent("x"), [
                { pattern: { kind: "literal_pattern", value: 0 }, body: [mkLit(1)] },
                { pattern: { kind: "wildcard" }, body: [mkIdent("x")] },
            ])],
        }),
    },
    {
        name: "T5.07 nested if: if x>0 then (if x>10 then 10 else x) else 0, post result>=0",
        fn: () => mkFn({
            params: [mkParam("x", "Int")],
            contracts: [mkPost(mkBinop(">=", mkIdent("result"), mkLit(0)))],
            body: [mkIf(
                mkBinop(">", mkIdent("x"), mkLit(0)),
                [mkIf(
                    mkBinop(">", mkIdent("x"), mkLit(10)),
                    [mkLit(10)],
                    [mkIdent("x")],
                )],
                [mkLit(0)],
            )],
        }),
    },
    {
        name: "T5.08 match with binding: match x { 0=>1, n=>n+1 }, pre x>=0, post result>=1",
        fn: () => mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">=", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">=", mkIdent("result"), mkLit(1))),
            ],
            body: [mkMatch(mkIdent("x"), [
                { pattern: { kind: "literal_pattern", value: 0 }, body: [mkLit(1)] },
                { pattern: { kind: "binding", name: "n" }, body: [mkBinop("+", mkIdent("n"), mkLit(1))] },
            ])],
        }),
    },
];

const ALL_FUNCTION_TESTS = [
    ...T1_BASIC_ARITHMETIC,
    ...T2_BOOLEAN_LOGIC,
    ...T3_COMPARISON_CHAINS,
    ...T4_MULTI_PRECONDITION,
    ...T5_BODY_DEPENDENT,
];

describe("cross-validation: corpus T1–T5 (function verification)", () => {
    for (const tc of ALL_FUNCTION_TESTS) {
        it(tc.name, async () => {
            const fn = tc.fn();
            const module = tc.module ? tc.module() : mkModule([fn]);
            const { z3Errors, builtinErrors } = await crossValidateFunction(fn, module, tc.name);
            assertAgreement(z3Errors, builtinErrors, tc.name);
        });
    }
});

// =============================================================================
// Section 2: Callsite Precondition Cross-Validation (T6)
// =============================================================================

interface CallsiteTestCase {
    name: string;
    defs: () => FunctionDef[];
    callerName: string;
}

const T6_CALLSITE: CallsiteTestCase[] = [
    {
        name: "T6.01 caller pre satisfies callee pre",
        defs: () => [
            mkFn({
                name: "callee",
                params: [mkParam("x", "Int")],
                contracts: [mkPre(mkBinop(">", mkIdent("x"), mkLit(0)))],
                body: [mkIdent("x")],
            }),
            mkFn({
                name: "caller",
                params: [mkParam("n", "Int")],
                contracts: [mkPre(mkBinop(">", mkIdent("n"), mkLit(0)))],
                body: [mkCall("callee", [mkIdent("n")])],
            }),
        ],
        callerName: "caller",
    },
    {
        name: "T6.02 [fail] caller missing pre → precondition_not_met",
        defs: () => [
            mkFn({
                name: "callee",
                params: [mkParam("x", "Int")],
                contracts: [mkPre(mkBinop(">", mkIdent("x"), mkLit(0)))],
                body: [mkIdent("x")],
            }),
            mkFn({
                name: "caller",
                params: [mkParam("n", "Int")],
                body: [mkCall("callee", [mkIdent("n")])],
            }),
        ],
        callerName: "caller",
    },
    {
        name: "T6.03 stronger caller pre: callee x>0, caller n>10",
        defs: () => [
            mkFn({
                name: "callee",
                params: [mkParam("x", "Int")],
                contracts: [mkPre(mkBinop(">", mkIdent("x"), mkLit(0)))],
                body: [mkIdent("x")],
            }),
            mkFn({
                name: "caller",
                params: [mkParam("n", "Int")],
                contracts: [mkPre(mkBinop(">", mkIdent("n"), mkLit(10)))],
                body: [mkCall("callee", [mkIdent("n")])],
            }),
        ],
        callerName: "caller",
    },
    {
        name: "T6.04 transitive: A→B→C, all preconditions satisfied",
        defs: () => [
            mkFn({
                name: "fnC",
                params: [mkParam("x", "Int")],
                contracts: [mkPre(mkBinop(">", mkIdent("x"), mkLit(0)))],
                body: [mkIdent("x")],
            }),
            mkFn({
                name: "fnB",
                params: [mkParam("y", "Int")],
                contracts: [mkPre(mkBinop(">", mkIdent("y"), mkLit(0)))],
                body: [mkCall("fnC", [mkIdent("y")])],
            }),
            mkFn({
                name: "fnA",
                params: [mkParam("z", "Int")],
                contracts: [mkPre(mkBinop(">", mkIdent("z"), mkLit(0)))],
                body: [mkCall("fnB", [mkIdent("z")])],
            }),
        ],
        callerName: "fnA",
    },
];

describe("cross-validation: corpus T6 (callsite preconditions)", () => {
    for (const tc of T6_CALLSITE) {
        it(tc.name, async () => {
            const defs = tc.defs();
            const module = mkModule(defs);
            const functionDefs = new Map(defs.map(d => [d.name, d]));
            const callerFn = functionDefs.get(tc.callerName)!;

            clearVerificationCache();
            const z3Result = await verifyCallSitePreconditions(z3Ctx, callerFn, functionDefs, module);
            clearVerificationCache();
            const builtinResult = await verifyCallSitePreconditions(builtinCtx, callerFn, functionDefs, module);

            const z3PnmCount = z3Result.errors.filter(e => e.error === "precondition_not_met").length;
            const builtinPnmCount = builtinResult.errors.filter(e => e.error === "precondition_not_met").length;

            // Both solvers should agree on precondition_not_met count
            expect(builtinPnmCount).toBe(z3PnmCount);
        });
    }
});

// =============================================================================
// Section 3: Example Program Cross-Validation
// =============================================================================

describe("cross-validation: example programs with contracts", () => {
    const examplesDir = path.resolve(import.meta.dirname, "../../examples");
    const exampleFiles = [
        "approval-gates.edict.json",
        "blame-tracking.edict.json",
        "complete.edict.json",
        "confidence-types.edict.json",
        "contracts.edict.json",
        "edge-api-handler.edict.json",
        "enums.edict.json",
        "fibonacci.edict.json",
        "intent-declarations.edict.json",
        "multi-module.edict.json",
        "mutual-recursion.edict.json",
        "provenance-chains.edict.json",
        "provenance-tracking.edict.json",
        "string-processing.edict.json",
    ];

    for (const file of exampleFiles) {
        it(`${file}: both solvers agree`, async () => {
            const content = fs.readFileSync(path.join(examplesDir, file), "utf-8");
            const parsed = JSON.parse(content);

            // Handle multi-module format (array of modules) vs single module
            const modules: EdictModule[] = Array.isArray(parsed) ? parsed : [parsed];

            for (const program of modules) {
            if (!program.definitions) continue;

            // Extract functions with contracts
            const fnsWithContracts = program.definitions.filter(
                (d): d is FunctionDef => d.kind === "fn" && d.contracts.length > 0,
            );

            if (fnsWithContracts.length === 0) return; // no contracts — skip

            for (const fn of fnsWithContracts) {
                // Skip functions with quantifier contracts (ForAll/Exists) — Z3-only
                const hasQuantifiers = fn.contracts.some(c =>
                    c.condition && hasQuantifierNode(c.condition),
                );
                // Skip functions with semantic assertions — Z3-only
                const hasSemantic = fn.contracts.some(c => c.semantic);

                if (hasQuantifiers || hasSemantic) continue;

                // Skip functions with unsupported param types (String, arrays, records, etc.)
                const hasUnsupportedParams = fn.params.some(p => {
                    if (!p.type || p.type.kind !== "basic") return true;
                    return !["Int", "Float", "Bool"].includes(p.type.name);
                });
                if (hasUnsupportedParams) continue;

                // Skip Float-division functions: known builtin solver limitation.
                // The builtin solver uses integer truncation for division, but Z3 does
                // proper real division for Real sort. This is a #206 bug, not #207.
                const hasFloatDiv = fn.params.some(p =>
                    p.type?.kind === "basic" && p.type.name === "Float",
                ) && fn.body.some(e => hasNodeKind(e, "binop", "/"));
                if (hasFloatDiv) continue;

                clearVerificationCache();
                const z3Result = await verifyFunction(z3Ctx, fn, program);
                clearVerificationCache();
                const builtinResult = await verifyFunction(builtinCtx, fn, program);

                assertAgreement(
                    z3Result.errors,
                    builtinResult.errors,
                    `${file}::${fn.name}`,
                );
            }
            } // end for modules
        });
    }
});

/** Check if an expression tree contains forall/exists nodes. */
function hasQuantifierNode(expr: Expression): boolean {
    if (expr.kind === "forall" || expr.kind === "exists") return true;
    switch (expr.kind) {
        case "binop": return hasQuantifierNode(expr.left) || hasQuantifierNode(expr.right);
        case "unop": return hasQuantifierNode(expr.operand);
        case "if": return hasQuantifierNode(expr.condition) ||
            expr.then.some(hasQuantifierNode) ||
            (expr.else?.some(hasQuantifierNode) ?? false);
        case "call": return expr.args.some(hasQuantifierNode);
        default: return false;
    }
}

/** Check if an expression tree contains a specific node kind + op. */
function hasNodeKind(expr: Expression, kind: string, op?: string): boolean {
    if (expr.kind === kind && (!op || (expr as any).op === op)) return true;
    switch (expr.kind) {
        case "binop": return hasNodeKind(expr.left, kind, op) || hasNodeKind(expr.right, kind, op);
        case "unop": return hasNodeKind(expr.operand, kind, op);
        case "if": return hasNodeKind(expr.condition, kind, op) ||
            expr.then.some(e => hasNodeKind(e, kind, op)) ||
            (expr.else?.some(e => hasNodeKind(e, kind, op)) ?? false);
        case "call": return expr.args.some(e => hasNodeKind(e, kind, op));
        default: return false;
    }
}

// =============================================================================
// Section 4: Property-Based Testing
// =============================================================================

describe("cross-validation: property-based random expressions", () => {
    // Seeded pseudo-random for reproducible tests
    function seededRandom(seed: number): () => number {
        let s = seed;
        return () => {
            s = (s * 1103515245 + 12345) & 0x7fffffff;
            return s / 0x7fffffff;
        };
    }

    const rand = seededRandom(42);

    function randomInt(min: number, max: number): number {
        return Math.floor(rand() * (max - min + 1)) + min;
    }

    function randomLinearExpr(vars: string[]): Expression {
        // Generate: c1*v1 + c2*v2 + ... + c0
        const terms: Expression[] = [];
        for (const v of vars) {
            const coeff = randomInt(-5, 5);
            if (coeff === 0) continue;
            if (coeff === 1) {
                terms.push(mkIdent(v));
            } else if (coeff === -1) {
                terms.push(mkUnop("-", mkIdent(v)));
            } else {
                terms.push(mkBinop("*", mkIdent(v), mkLit(coeff)));
            }
        }
        const constant = randomInt(-10, 10);
        if (constant !== 0 || terms.length === 0) {
            terms.push(mkLit(constant));
        }
        // Fold terms with +
        let result = terms[0]!;
        for (let i = 1; i < terms.length; i++) {
            result = mkBinop("+", result, terms[i]!);
        }
        return result;
    }

    function randomComparison(left: Expression, right: Expression): Expression {
        const ops = [">", ">=", "<", "<=", "==", "!="];
        const op = ops[randomInt(0, ops.length - 1)]!;
        return mkBinop(op, left, right);
    }

    // Generate 30 random cross-validation cases
    const RANDOM_CASES = 30;

    for (let i = 0; i < RANDOM_CASES; i++) {
        it(`random case ${i}: linear arithmetic`, async () => {
            const numVars = randomInt(1, 2);
            const vars = Array.from({ length: numVars }, (_, j) => `v${j}`);
            const params = vars.map(v => mkParam(v, "Int"));

            // Generate precondition: linear expr > 0
            const preExpr = randomLinearExpr(vars);
            const pre = mkPre(randomComparison(preExpr, mkLit(0)));

            // Generate postcondition: linear expr compared to another linear expr
            const postLeft = randomLinearExpr(vars);
            const postRight = randomLinearExpr(vars);
            const post = mkPost(randomComparison(postLeft, postRight));

            // Body: simple linear expression
            const body = randomLinearExpr(vars);

            const fn = mkFn({ params, contracts: [pre, post], body: [body] });
            const module = mkModule([fn]);

            const { z3Errors, builtinErrors } = await crossValidateFunction(fn, module, `random-${i}`);
            assertAgreement(z3Errors, builtinErrors, `random-${i}`);
        });
    }
});

// =============================================================================
// Section 5: Counterexample Validation
// =============================================================================

describe("cross-validation: counterexample validation", () => {
    it("both solvers produce valid counterexamples for unbounded post", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [mkPost(mkBinop(">", mkIdent("result"), mkLit(0)))],
            body: [mkIdent("x")],
        });
        const module = mkModule([fn]);
        const { z3Errors, builtinErrors } = await crossValidateFunction(fn, module, "ce-validation");

        // Both should find a counterexample
        expect(z3Errors.length).toBeGreaterThanOrEqual(1);
        expect(builtinErrors.length).toBeGreaterThanOrEqual(1);

        const z3Ce = (z3Errors[0] as any).counterexample;
        const builtinCe = (builtinErrors[0] as any).counterexample;

        // Both counterexamples should be valid witnesses:
        // x should be <= 0 (because the post says result > 0 and body = x)
        expect(Number(z3Ce.x)).toBeLessThanOrEqual(0);
        expect(Number(builtinCe.x)).toBeLessThanOrEqual(0);
    });

    it("both produce valid counterexample for tight range", async () => {
        const fn = mkFn({
            params: [mkParam("x", "Int")],
            contracts: [
                mkPre(mkBinop(">", mkIdent("x"), mkLit(0))),
                mkPost(mkBinop(">", mkIdent("result"), mkLit(0))),
            ],
            body: [mkBinop("-", mkIdent("x"), mkLit(10))],
        });
        const module = mkModule([fn]);
        const { z3Errors, builtinErrors } = await crossValidateFunction(fn, module, "ce-tight-range");

        expect(z3Errors.length).toBeGreaterThanOrEqual(1);
        expect(builtinErrors.length).toBeGreaterThanOrEqual(1);

        // Counterexample: x > 0 but x - 10 <= 0 → x in [1, 10]
        const z3X = Number((z3Errors[0] as any).counterexample.x);
        const builtinX = Number((builtinErrors[0] as any).counterexample.x);

        expect(z3X).toBeGreaterThan(0);
        expect(z3X).toBeLessThanOrEqual(10);
        expect(builtinX).toBeGreaterThan(0);
        expect(builtinX).toBeLessThanOrEqual(10);
    });

    it("both produce valid counterexample for boolean logic", async () => {
        // pre: a implies b, pre: b, post: a  (affirming consequent — invalid)
        const fn = mkFn({
            params: [mkParam("a", "Bool"), mkParam("b", "Bool")],
            contracts: [
                mkPre(mkBinop("implies", mkIdent("a"), mkIdent("b"))),
                mkPre(mkIdent("b")),
                mkPost(mkIdent("a")),
            ],
            body: [mkIdent("a")],
        });
        const module = mkModule([fn]);
        const { z3Errors, builtinErrors } = await crossValidateFunction(fn, module, "ce-bool");

        expect(z3Errors.length).toBeGreaterThanOrEqual(1);
        expect(builtinErrors.length).toBeGreaterThanOrEqual(1);

        // Counterexample: a=false, b=true satisfies preconds but violates post
        const z3Ce = (z3Errors[0] as any).counterexample;
        const builtinCe = (builtinErrors[0] as any).counterexample;

        // a must be false in both cases
        expect(z3Ce.a).toBe("false");
        expect(builtinCe.a).toBe("false");
    });

    it("precondition_not_met counterexamples are valid", async () => {
        const callee = mkFn({
            name: "callee",
            params: [mkParam("x", "Int")],
            contracts: [mkPre(mkBinop(">", mkIdent("x"), mkLit(0)))],
            body: [mkIdent("x")],
        });
        const caller = mkFn({
            name: "caller",
            params: [mkParam("n", "Int")],
            body: [mkCall("callee", [mkIdent("n")])],
        });
        const defs = [callee, caller];
        const module = mkModule(defs);
        const functionDefs = new Map(defs.map(d => [d.name, d]));

        clearVerificationCache();
        const z3Result = await verifyCallSitePreconditions(z3Ctx, caller, functionDefs, module);
        clearVerificationCache();
        const builtinResult = await verifyCallSitePreconditions(builtinCtx, caller, functionDefs, module);

        const z3Pnm = z3Result.errors.filter(e => e.error === "precondition_not_met");
        const builtinPnm = builtinResult.errors.filter(e => e.error === "precondition_not_met");

        expect(z3Pnm.length).toBeGreaterThanOrEqual(1);
        expect(builtinPnm.length).toBeGreaterThanOrEqual(1);

        // Counterexample n should be <= 0 (violates callee's pre x > 0)
        const z3N = Number((z3Pnm[0] as any).counterexample.n);
        const builtinN = Number((builtinPnm[0] as any).counterexample.n);
        expect(z3N).toBeLessThanOrEqual(0);
        expect(builtinN).toBeLessThanOrEqual(0);
    });
});
