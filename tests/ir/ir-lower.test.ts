// =============================================================================
// IR Lowering Pass Tests — unit-level tests for lowerModule
// =============================================================================
// Tests lowering of AST + TypedModuleInfo → IRModule for each expression kind.

import { describe, it, expect } from "vitest";
import { lowerModule } from "../../src/ir/lower.js";
import { validate, resolve, typeCheck } from "../../src/index.js";
import type { EdictModule } from "../../src/ast/nodes.js";
import type { TypedModuleInfo } from "../../src/checker/check.js";
import type { IRModule, IRExpr, IRFunction, IRIdent, IRCall, IRLambdaRef } from "../../src/ir/types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Run a module through validate → resolve → typeCheck → lowerModule */
function lowerFromAst(ast: Record<string, unknown>): { ir: IRModule; typeInfo: TypedModuleInfo } {
    const vResult = validate(ast);
    if (!vResult.ok) {
        throw new Error(`Validation failed: ${JSON.stringify(vResult.errors)}`);
    }
    const module = ast as EdictModule;
    const resolveErrors = resolve(module);
    if (resolveErrors.length > 0) {
        throw new Error(`Resolution failed: ${JSON.stringify(resolveErrors)}`);
    }
    const { errors: typeErrors, typeInfo } = typeCheck(module);
    if (typeErrors.length > 0) {
        throw new Error(`Type check failed: ${JSON.stringify(typeErrors)}`);
    }
    const ir = lowerModule(module, typeInfo);
    return { ir, typeInfo };
}

/** Build a minimal module AST with one function */
function moduleWith(fn: Record<string, unknown>, extra?: Record<string, unknown>[]): Record<string, unknown> {
    return {
        kind: "module",
        id: "mod-test",
        name: "Test",
        imports: [],
        definitions: [fn, ...(extra ?? [])],
    };
}

/** Get a function by name from the IR module */
function getIRFn(ir: IRModule, name: string): IRFunction {
    const fn = ir.functions.find(f => f.name === name);
    if (!fn) throw new Error(`No function named "${name}" in IR`);
    return fn;
}

/** Get the last expression of a function body */
function lastExpr(fn: IRFunction): IRExpr {
    return fn.body[fn.body.length - 1]!;
}

// =============================================================================
// Literal Lowering
// =============================================================================

describe("IR Lower — literals", () => {
    it("should lower Int literal with correct type", () => {
        const { ir } = lowerFromAst(moduleWith({
            kind: "fn", id: "fn-main", name: "main", params: [],
            returnType: { kind: "basic", name: "Int" }, effects: ["pure"], contracts: [],
            body: [{ kind: "literal", id: "lit-001", value: 42 }],
        }));
        const expr = lastExpr(getIRFn(ir, "main"));
        expect(expr.kind).toBe("ir_literal");
        if (expr.kind === "ir_literal") {
            expect(expr.value).toBe(42);
            expect(expr.resolvedType).toEqual({ kind: "basic", name: "Int" });
            expect(expr.sourceId).toBe("lit-001");
        }
    });

    it("should lower Float literal", () => {
        const { ir } = lowerFromAst(moduleWith({
            kind: "fn", id: "fn-main", name: "main", params: [],
            returnType: { kind: "basic", name: "Float" }, effects: ["pure"], contracts: [],
            body: [{ kind: "literal", id: "lit-f", value: 3.14, type: { kind: "basic", name: "Float" } }],
        }));
        const expr = lastExpr(getIRFn(ir, "main"));
        expect(expr.kind).toBe("ir_literal");
        if (expr.kind === "ir_literal") {
            expect(expr.resolvedType).toEqual({ kind: "basic", name: "Float" });
        }
    });

    it("should lower String literal", () => {
        const { ir } = lowerFromAst(moduleWith({
            kind: "fn", id: "fn-main", name: "main", params: [],
            returnType: { kind: "basic", name: "String" }, effects: ["pure"], contracts: [],
            body: [{ kind: "literal", id: "lit-s", value: "hello" }],
        }));
        const expr = lastExpr(getIRFn(ir, "main"));
        if (expr.kind === "ir_literal") {
            expect(expr.resolvedType).toEqual({ kind: "basic", name: "String" });
        }
    });

    it("should lower Bool literal", () => {
        const { ir } = lowerFromAst(moduleWith({
            kind: "fn", id: "fn-main", name: "main", params: [],
            returnType: { kind: "basic", name: "Bool" }, effects: ["pure"], contracts: [],
            body: [{ kind: "literal", id: "lit-b", value: true }],
        }));
        const expr = lastExpr(getIRFn(ir, "main"));
        if (expr.kind === "ir_literal") {
            expect(expr.resolvedType).toEqual({ kind: "basic", name: "Bool" });
        }
    });
});

// =============================================================================
// Identifier Lowering
// =============================================================================

describe("IR Lower — identifiers", () => {
    it("should classify parameter as local scope", () => {
        const { ir } = lowerFromAst(moduleWith({
            kind: "fn", id: "fn-f", name: "f", params: [
                { kind: "param", id: "p-x", name: "x", type: { kind: "basic", name: "Int" } },
            ],
            returnType: { kind: "basic", name: "Int" }, effects: ["pure"], contracts: [],
            body: [{ kind: "ident", id: "id-x", name: "x" }],
        }));
        const expr = lastExpr(getIRFn(ir, "f")) as IRIdent;
        expect(expr.kind).toBe("ir_ident");
        expect(expr.scope).toBe("local");
        expect(expr.resolvedType).toEqual({ kind: "basic", name: "Int" });
    });

    it("should classify let-bound variable as local scope", () => {
        const { ir } = lowerFromAst(moduleWith({
            kind: "fn", id: "fn-f", name: "f", params: [],
            returnType: { kind: "basic", name: "Int" }, effects: ["pure"], contracts: [],
            body: [
                { kind: "let", id: "let-x", name: "x", type: { kind: "basic", name: "Int" },
                  value: { kind: "literal", id: "lit-1", value: 10 } },
                { kind: "ident", id: "id-x", name: "x" },
            ],
        }));
        const fn = getIRFn(ir, "f");
        const expr = lastExpr(fn) as IRIdent;
        expect(expr.scope).toBe("local");
    });

    it("should classify function reference as function scope", () => {
        const { ir } = lowerFromAst(moduleWith(
            {
                kind: "fn", id: "fn-helper", name: "helper", params: [],
                returnType: { kind: "basic", name: "Int" }, effects: ["pure"], contracts: [],
                body: [{ kind: "literal", id: "lit-h", value: 1 }],
            },
            [{
                kind: "fn", id: "fn-main", name: "main", params: [],
                returnType: { kind: "basic", name: "Int" }, effects: ["pure"], contracts: [],
                body: [{
                    kind: "call", id: "call-h", fn: { kind: "ident", id: "id-h", name: "helper" }, args: [],
                }],
            }],
        ));
        const mainFn = getIRFn(ir, "main");
        const call = lastExpr(mainFn);
        if (call.kind === "ir_call") {
            const fnRef = call.fn as IRIdent;
            expect(fnRef.scope).toBe("function");
        }
    });
});

// =============================================================================
// Binop and Unop
// =============================================================================

describe("IR Lower — operators", () => {
    it("should lower binop with correct operand type", () => {
        const { ir } = lowerFromAst(moduleWith({
            kind: "fn", id: "fn-main", name: "main", params: [
                { kind: "param", id: "p-x", name: "x", type: { kind: "basic", name: "Int" } },
            ],
            returnType: { kind: "basic", name: "Int" }, effects: ["pure"], contracts: [],
            body: [{
                kind: "binop", id: "bin-001", op: "+",
                left: { kind: "ident", id: "id-x", name: "x" },
                right: { kind: "literal", id: "lit-2", value: 2 },
            }],
        }));
        const expr = lastExpr(getIRFn(ir, "main"));
        expect(expr.kind).toBe("ir_binop");
        if (expr.kind === "ir_binop") {
            expect(expr.resolvedType).toEqual({ kind: "basic", name: "Int" });
            expect(expr.resolvedOperandType).toEqual({ kind: "basic", name: "Int" });
        }
    });

    it("should lower comparison with Bool result type", () => {
        const { ir } = lowerFromAst(moduleWith({
            kind: "fn", id: "fn-main", name: "main", params: [
                { kind: "param", id: "p-x", name: "x", type: { kind: "basic", name: "Int" } },
            ],
            returnType: { kind: "basic", name: "Bool" }, effects: ["pure"], contracts: [],
            body: [{
                kind: "binop", id: "bin-cmp", op: "<",
                left: { kind: "ident", id: "id-x", name: "x" },
                right: { kind: "literal", id: "lit-10", value: 10 },
            }],
        }));
        const expr = lastExpr(getIRFn(ir, "main"));
        if (expr.kind === "ir_binop") {
            expect(expr.resolvedType).toEqual({ kind: "basic", name: "Bool" });
            expect(expr.resolvedOperandType).toEqual({ kind: "basic", name: "Int" });
        }
    });

    it("should lower unop negation", () => {
        const { ir } = lowerFromAst(moduleWith({
            kind: "fn", id: "fn-main", name: "main", params: [],
            returnType: { kind: "basic", name: "Int" }, effects: ["pure"], contracts: [],
            body: [{
                kind: "unop", id: "unop-001", op: "-",
                operand: { kind: "literal", id: "lit-5", value: 5 },
            }],
        }));
        const expr = lastExpr(getIRFn(ir, "main"));
        expect(expr.kind).toBe("ir_unop");
        if (expr.kind === "ir_unop") {
            expect(expr.op).toBe("-");
            expect(expr.resolvedType).toEqual({ kind: "basic", name: "Int" });
        }
    });
});

// =============================================================================
// Call Lowering
// =============================================================================

describe("IR Lower — calls", () => {
    it("should classify builtin call as builtin", () => {
        const { ir } = lowerFromAst(moduleWith({
            kind: "fn", id: "fn-main", name: "main", params: [],
            returnType: { kind: "basic", name: "String" }, effects: ["io"], contracts: [],
            body: [{
                kind: "call", id: "call-print", fn: { kind: "ident", id: "id-print", name: "print" },
                args: [{ kind: "literal", id: "lit-msg", value: "hello" }],
            }],
        }));
        const expr = lastExpr(getIRFn(ir, "main")) as IRCall;
        expect(expr.callKind).toBe("builtin");
    });

    it("should classify direct function call", () => {
        const { ir } = lowerFromAst(moduleWith(
            {
                kind: "fn", id: "fn-helper", name: "helper", params: [],
                returnType: { kind: "basic", name: "Int" }, effects: ["pure"], contracts: [],
                body: [{ kind: "literal", id: "lit-1", value: 1 }],
            },
            [{
                kind: "fn", id: "fn-main", name: "main", params: [],
                returnType: { kind: "basic", name: "Int" }, effects: ["pure"], contracts: [],
                body: [{
                    kind: "call", id: "call-helper",
                    fn: { kind: "ident", id: "id-helper", name: "helper" },
                    args: [],
                }],
            }],
        ));
        const expr = lastExpr(getIRFn(ir, "main")) as IRCall;
        expect(expr.callKind).toBe("direct");
    });

    it("should track string param indices for builtins", () => {
        const { ir } = lowerFromAst(moduleWith({
            kind: "fn", id: "fn-main", name: "main", params: [],
            returnType: { kind: "basic", name: "String" }, effects: ["io"], contracts: [],
            body: [{
                kind: "call", id: "call-print", fn: { kind: "ident", id: "id-print", name: "print" },
                args: [{ kind: "literal", id: "lit-msg", value: "test" }],
            }],
        }));
        const expr = lastExpr(getIRFn(ir, "main")) as IRCall;
        // print takes a String param at index 0
        expect(expr.stringParamIndices).toContain(0);
    });
});

// =============================================================================
// If / Let / Block
// =============================================================================

describe("IR Lower — control flow", () => {
    it("should lower if/else with branches", () => {
        const { ir } = lowerFromAst(moduleWith({
            kind: "fn", id: "fn-main", name: "main", params: [
                { kind: "param", id: "p-x", name: "x", type: { kind: "basic", name: "Int" } },
            ],
            returnType: { kind: "basic", name: "Int" }, effects: ["pure"], contracts: [],
            body: [{
                kind: "if", id: "if-001",
                condition: { kind: "binop", id: "bin-cmp", op: ">",
                    left: { kind: "ident", id: "id-x", name: "x" },
                    right: { kind: "literal", id: "lit-0", value: 0 },
                },
                then: [{ kind: "literal", id: "lit-1", value: 1 }],
                else: [{ kind: "literal", id: "lit-neg", value: -1 }],
            }],
        }));
        const expr = lastExpr(getIRFn(ir, "main"));
        expect(expr.kind).toBe("ir_if");
        if (expr.kind === "ir_if") {
            expect(expr.then.length).toBe(1);
            expect(expr.else.length).toBe(1);
        }
    });

    it("should lower let with bound type", () => {
        const { ir } = lowerFromAst(moduleWith({
            kind: "fn", id: "fn-main", name: "main", params: [],
            returnType: { kind: "basic", name: "Int" }, effects: ["pure"], contracts: [],
            body: [
                { kind: "let", id: "let-x", name: "x", type: { kind: "basic", name: "Int" },
                  value: { kind: "literal", id: "lit-v", value: 42 } },
                { kind: "ident", id: "id-x", name: "x" },
            ],
        }));
        const fn = getIRFn(ir, "main");
        expect(fn.body[0]!.kind).toBe("ir_let");
        if (fn.body[0]!.kind === "ir_let") {
            expect(fn.body[0]!.boundType).toEqual({ kind: "basic", name: "Int" });
        }
    });

    it("should lower block with result type from last expression", () => {
        const { ir } = lowerFromAst(moduleWith({
            kind: "fn", id: "fn-main", name: "main", params: [],
            returnType: { kind: "basic", name: "Int" }, effects: ["pure"], contracts: [],
            body: [{
                kind: "block", id: "block-001", body: [
                    { kind: "let", id: "let-a", name: "a", type: { kind: "basic", name: "Int" },
                      value: { kind: "literal", id: "lit-a", value: 1 } },
                    { kind: "ident", id: "id-a", name: "a" },
                ],
            }],
        }));
        const expr = lastExpr(getIRFn(ir, "main"));
        expect(expr.kind).toBe("ir_block");
        if (expr.kind === "ir_block") {
            expect(expr.body.length).toBe(2);
            expect(expr.resolvedType).toEqual({ kind: "basic", name: "Int" });
        }
    });
});

// =============================================================================
// Lambda Lifting
// =============================================================================

describe("IR Lower — lambdas", () => {
    it("should lift lambda to top-level function", () => {
        const { ir } = lowerFromAst(moduleWith({
            kind: "fn", id: "fn-main", name: "main", params: [],
            returnType: { kind: "fn_type", params: [{ kind: "basic", name: "Int" }], effects: ["pure"], returnType: { kind: "basic", name: "Int" } },
            effects: ["pure"], contracts: [],
            body: [{
                kind: "lambda", id: "lam-001",
                params: [{ kind: "param", id: "p-x", name: "x", type: { kind: "basic", name: "Int" } }],
                body: [{ kind: "ident", id: "id-x", name: "x" }],
            }],
        }));
        // The lambda should be lifted and referenced
        const mainExpr = lastExpr(getIRFn(ir, "main"));
        expect(mainExpr.kind).toBe("ir_lambda_ref");
        if (mainExpr.kind === "ir_lambda_ref") {
            expect(mainExpr.liftedName).toMatch(/^__lambda_\d+$/);
            expect(mainExpr.captures.length).toBe(0);
        }

        // The lifted function should exist
        const lifted = ir.functions.find(f => f.name.startsWith("__lambda_"));
        expect(lifted).toBeDefined();
        expect(lifted!.isLambda).toBe(true);
    });

    it("should capture free variables in closure env", () => {
        const { ir } = lowerFromAst(moduleWith({
            kind: "fn", id: "fn-make-adder", name: "makeAdder", params: [
                { kind: "param", id: "p-offset", name: "offset", type: { kind: "basic", name: "Int" } },
            ],
            returnType: { kind: "fn_type", params: [{ kind: "basic", name: "Int" }], effects: ["pure"], returnType: { kind: "basic", name: "Int" } },
            effects: ["pure"], contracts: [],
            body: [{
                kind: "lambda", id: "lam-001",
                params: [{ kind: "param", id: "p-x", name: "x", type: { kind: "basic", name: "Int" } }],
                body: [{
                    kind: "binop", id: "bin-add", op: "+",
                    left: { kind: "ident", id: "id-x", name: "x" },
                    right: { kind: "ident", id: "id-offset", name: "offset" },
                }],
            }],
        }));

        // Lambda ref should have captures
        const mainExpr = lastExpr(getIRFn(ir, "makeAdder")) as IRLambdaRef;
        expect(mainExpr.captures.length).toBe(1);
        expect(mainExpr.captures[0]!.name).toBe("offset");

        // Lifted function should have closureEnv
        const lifted = ir.functions.find(f => f.isLambda)!;
        expect(lifted.closureEnv.length).toBe(1);
        expect(lifted.closureEnv[0]!.name).toBe("offset");

        // Inside the lambda, 'offset' should have closure scope
        const body = lifted.body;
        const binop = body[body.length - 1]!;
        if (binop.kind === "ir_binop") {
            const right = binop.right as IRIdent;
            expect(right.scope).toBe("closure");
        }
    });
});

// =============================================================================
// Match
// =============================================================================

describe("IR Lower — match", () => {
    it("should lower match with targetTypeName", () => {
        const { ir } = lowerFromAst(moduleWith(
            {
                kind: "enum", id: "enum-Color", name: "Color",
                variants: [
                    { kind: "variant", id: "v-r", name: "Red", fields: [] },
                    { kind: "variant", id: "v-g", name: "Green", fields: [] },
                    { kind: "variant", id: "v-b", name: "Blue", fields: [] },
                ],
            },
            [{
                kind: "fn", id: "fn-main", name: "main", params: [
                    { kind: "param", id: "p-c", name: "c", type: { kind: "named", name: "Color" } },
                ],
                returnType: { kind: "basic", name: "Int" }, effects: ["pure"], contracts: [],
                body: [{
                    kind: "match", id: "match-001",
                    target: { kind: "ident", id: "id-c", name: "c" },
                    arms: [
                        { kind: "arm", id: "arm-r", pattern: { kind: "constructor", name: "Red", fields: [] },
                          body: [{ kind: "literal", id: "lit-1", value: 1 }] },
                        { kind: "arm", id: "arm-g", pattern: { kind: "constructor", name: "Green", fields: [] },
                          body: [{ kind: "literal", id: "lit-2", value: 2 }] },
                        { kind: "arm", id: "arm-b", pattern: { kind: "constructor", name: "Blue", fields: [] },
                          body: [{ kind: "literal", id: "lit-3", value: 3 }] },
                    ],
                }],
            }],
        ));
        const expr = lastExpr(getIRFn(ir, "main"));
        expect(expr.kind).toBe("ir_match");
        if (expr.kind === "ir_match") {
            expect(expr.targetTypeName).toBe("Color");
            expect(expr.arms.length).toBe(3);
        }
    });
});

// =============================================================================
// Records and Enums
// =============================================================================

describe("IR Lower — records and enums", () => {
    it("should lower record definition to IRRecordDef", () => {
        const { ir } = lowerFromAst(moduleWith(
            {
                kind: "record", id: "rec-Point", name: "Point",
                fields: [
                    { kind: "field", id: "f-x2", name: "x", type: { kind: "basic", name: "Int" } },
                    { kind: "field", id: "f-y2", name: "y", type: { kind: "basic", name: "Int" } },
                ],
            },
            [{
                kind: "fn", id: "fn-main", name: "main", params: [],
                returnType: { kind: "basic", name: "Int" }, effects: ["pure"], contracts: [],
                body: [{ kind: "literal", id: "lit-1", value: 0 }],
            }],
        ));
        expect(ir.records.length).toBe(1);
        expect(ir.records[0]!.name).toBe("Point");
        expect(ir.records[0]!.fields.length).toBe(2);
        expect(ir.records[0]!.fields[0]!.name).toBe("x");
    });

    it("should lower enum definition with tags", () => {
        const { ir } = lowerFromAst(moduleWith(
            {
                kind: "enum", id: "enum-Color", name: "Color",
                variants: [
                    { kind: "variant", id: "v-r2", name: "Red", fields: [] },
                    { kind: "variant", id: "v-g2", name: "Green", fields: [] },
                    { kind: "variant", id: "v-b2", name: "Blue", fields: [] },
                ],
            },
            [{
                kind: "fn", id: "fn-main", name: "main", params: [],
                returnType: { kind: "basic", name: "Int" }, effects: ["pure"], contracts: [],
                body: [{ kind: "literal", id: "lit-1", value: 0 }],
            }],
        ));
        expect(ir.enums.length).toBe(1);
        expect(ir.enums[0]!.name).toBe("Color");
        expect(ir.enums[0]!.variants[0]!.tag).toBe(0);
        expect(ir.enums[0]!.variants[1]!.tag).toBe(1);
        expect(ir.enums[0]!.variants[2]!.tag).toBe(2);
    });

    it("should lower record construction with fields in definition order", () => {
        const { ir } = lowerFromAst(moduleWith(
            {
                kind: "record", id: "rec-Point", name: "Point",
                fields: [
                    { kind: "field", id: "f-x", name: "x", type: { kind: "basic", name: "Int" } },
                    { kind: "field", id: "f-y", name: "y", type: { kind: "basic", name: "Int" } },
                ],
            },
            [{
                kind: "fn", id: "fn-main", name: "main", params: [],
                returnType: { kind: "named", name: "Point" }, effects: ["pure"], contracts: [],
                body: [{
                    kind: "record_expr", id: "rec-expr-001", name: "Point",
                    fields: [
                        { kind: "field_init", name: "y", value: { kind: "literal", id: "lit-y", value: 20 } },
                        { kind: "field_init", name: "x", value: { kind: "literal", id: "lit-x", value: 10 } },
                    ],
                }],
            }],
        ));
        const expr = lastExpr(getIRFn(ir, "main"));
        expect(expr.kind).toBe("ir_record");
        if (expr.kind === "ir_record") {
            // Fields should be in definition order (x, y), not construction order (y, x)
            expect(expr.fields[0]!.name).toBe("x");
            expect(expr.fields[1]!.name).toBe("y");
        }
    });

    it("should lower enum constructor with correct tag", () => {
        const { ir } = lowerFromAst(moduleWith(
            {
                kind: "enum", id: "enum-Option", name: "MyOption",
                variants: [
                    { kind: "variant", id: "v-none", name: "None", fields: [] },
                    { kind: "variant", id: "v-some", name: "Some", fields: [{ kind: "field", id: "f-val", name: "value", type: { kind: "basic", name: "Int" } }] },
                ],
            },
            [{
                kind: "fn", id: "fn-main", name: "main", params: [],
                returnType: { kind: "named", name: "MyOption" }, effects: ["pure"], contracts: [],
                body: [{
                    kind: "enum_constructor", id: "ec-001",
                    enumName: "MyOption", variant: "Some",
                    fields: [{ kind: "field_init", name: "value", value: { kind: "literal", id: "lit-42", value: 42 } }],
                }],
            }],
        ));
        const expr = lastExpr(getIRFn(ir, "main"));
        expect(expr.kind).toBe("ir_enum_constructor");
        if (expr.kind === "ir_enum_constructor") {
            expect(expr.tag).toBe(1); // Some is index 1
            expect(expr.variant).toBe("Some");
            expect(expr.fields.length).toBe(1);
        }
    });
});

// =============================================================================
// Field Access
// =============================================================================

describe("IR Lower — field access", () => {
    it("should lower field access with targetTypeName", () => {
        const { ir } = lowerFromAst(moduleWith(
            {
                kind: "record", id: "rec-Point", name: "Point",
                fields: [
                    { kind: "field", id: "f-x3", name: "x", type: { kind: "basic", name: "Int" } },
                    { kind: "field", id: "f-y3", name: "y", type: { kind: "basic", name: "Int" } },
                ],
            },
            [{
                kind: "fn", id: "fn-main", name: "main", params: [
                    { kind: "param", id: "p-p", name: "p", type: { kind: "named", name: "Point" } },
                ],
                returnType: { kind: "basic", name: "Int" }, effects: ["pure"], contracts: [],
                body: [{
                    kind: "access", id: "acc-001",
                    target: { kind: "ident", id: "id-p", name: "p" },
                    field: "x",
                }],
            }],
        ));
        const expr = lastExpr(getIRFn(ir, "main"));
        expect(expr.kind).toBe("ir_access");
        if (expr.kind === "ir_access") {
            expect(expr.targetTypeName).toBe("Point");
            expect(expr.field).toBe("x");
            expect(expr.resolvedType).toEqual({ kind: "basic", name: "Int" });
        }
    });
});

// =============================================================================
// Arrays and Tuples
// =============================================================================

describe("IR Lower — arrays and tuples", () => {
    it("should lower array with element type", () => {
        const { ir } = lowerFromAst(moduleWith({
            kind: "fn", id: "fn-main", name: "main", params: [],
            returnType: { kind: "array", element: { kind: "basic", name: "Int" } },
            effects: ["pure"], contracts: [],
            body: [{
                kind: "array", id: "arr-001",
                elements: [
                    { kind: "literal", id: "lit-1", value: 1 },
                    { kind: "literal", id: "lit-2", value: 2 },
                    { kind: "literal", id: "lit-3", value: 3 },
                ],
            }],
        }));
        const expr = lastExpr(getIRFn(ir, "main"));
        expect(expr.kind).toBe("ir_array");
        if (expr.kind === "ir_array") {
            expect(expr.elements.length).toBe(3);
            expect(expr.resolvedType).toEqual({ kind: "array", element: { kind: "basic", name: "Int" } });
        }
    });

    it("should lower tuple with element types", () => {
        const { ir } = lowerFromAst(moduleWith({
            kind: "fn", id: "fn-main", name: "main", params: [],
            returnType: { kind: "tuple", elements: [{ kind: "basic", name: "Int" }, { kind: "basic", name: "String" }] },
            effects: ["pure"], contracts: [],
            body: [{
                kind: "tuple_expr", id: "tup-001",
                elements: [
                    { kind: "literal", id: "lit-42", value: 42 },
                    { kind: "literal", id: "lit-hello", value: "hello" },
                ],
            }],
        }));
        const expr = lastExpr(getIRFn(ir, "main"));
        expect(expr.kind).toBe("ir_tuple");
        if (expr.kind === "ir_tuple") {
            expect(expr.elements.length).toBe(2);
            expect(expr.resolvedType).toEqual({
                kind: "tuple",
                elements: [
                    { kind: "basic", name: "Int" },
                    { kind: "basic", name: "String" },
                ],
            });
        }
    });
});

// =============================================================================
// Module-Level Structure
// =============================================================================

describe("IR Lower — module structure", () => {
    it("should preserve module name and sourceId", () => {
        const { ir } = lowerFromAst({
            kind: "module", id: "mod-001", name: "MyModule", imports: [],
            definitions: [{
                kind: "fn", id: "fn-main", name: "main", params: [],
                returnType: { kind: "basic", name: "Int" }, effects: ["pure"], contracts: [],
                body: [{ kind: "literal", id: "lit-1", value: 0 }],
            }],
        });
        expect(ir.name).toBe("MyModule");
        expect(ir.sourceId).toBe("mod-001");
    });

    it("should lower constants", () => {
        const { ir } = lowerFromAst({
            kind: "module", id: "mod-001", name: "Test", imports: [],
            definitions: [
                {
                    kind: "const", id: "const-pi", name: "PI",
                    type: { kind: "basic", name: "Float" },
                    value: { kind: "literal", id: "lit-pi", value: 3.14159, type: { kind: "basic", name: "Float" } },
                },
                {
                    kind: "fn", id: "fn-main", name: "main", params: [],
                    returnType: { kind: "basic", name: "Int" }, effects: ["pure"], contracts: [],
                    body: [{ kind: "literal", id: "lit-1", value: 0 }],
                },
            ],
        });
        expect(ir.constants.length).toBe(1);
        expect(ir.constants[0]!.name).toBe("PI");
        expect(ir.constants[0]!.resolvedType).toEqual({ kind: "basic", name: "Float" });
    });

    it("should lower function params with resolved types", () => {
        const { ir } = lowerFromAst(moduleWith({
            kind: "fn", id: "fn-add", name: "add", params: [
                { kind: "param", id: "p-a", name: "a", type: { kind: "basic", name: "Int" } },
                { kind: "param", id: "p-b", name: "b", type: { kind: "basic", name: "Int" } },
            ],
            returnType: { kind: "basic", name: "Int" }, effects: ["pure"], contracts: [],
            body: [{
                kind: "binop", id: "bin-add", op: "+",
                left: { kind: "ident", id: "id-a", name: "a" },
                right: { kind: "ident", id: "id-b", name: "b" },
            }],
        }));
        const fn = getIRFn(ir, "add");
        expect(fn.params.length).toBe(2);
        expect(fn.params[0]!.name).toBe("a");
        expect(fn.params[0]!.resolvedType).toEqual({ kind: "basic", name: "Int" });
        expect(fn.resolvedReturnType).toEqual({ kind: "basic", name: "Int" });
        expect(fn.effects).toEqual(["pure"]);
    });
});
