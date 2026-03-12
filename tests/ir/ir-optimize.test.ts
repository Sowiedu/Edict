// =============================================================================
// IR Constant Folding Tests
// =============================================================================
// Tests the optimize() pass for correct constant folding behavior.
// Uses standalone IR node construction (same pattern as ir-types.test.ts).

import { describe, it, expect } from "vitest";
import { optimize } from "../../src/ir/optimize.js";
import { countIRNodes } from "../../src/ir/types.js";
import type {
    IRModule,
    IRExpr,
    IRLiteral,
    IRBinop,
    IRUnop,
    IRIf,
    IRFunction,
} from "../../src/ir/types.js";
import type { TypeExpr } from "../../src/ast/types.js";

// ── Type constants ──────────────────────────────────────────────────────────

const INT: TypeExpr = { kind: "basic", name: "Int" };
const FLOAT: TypeExpr = { kind: "basic", name: "Float" };
const STRING: TypeExpr = { kind: "basic", name: "String" };
const BOOL: TypeExpr = { kind: "basic", name: "Bool" };

// ── IR node helpers ─────────────────────────────────────────────────────────

function lit(value: number | string | boolean, type: TypeExpr = INT): IRLiteral {
    return { kind: "ir_literal", sourceId: `lit-${value}`, resolvedType: type, value };
}

function ident(name: string, type: TypeExpr = INT) {
    return { kind: "ir_ident" as const, sourceId: `id-${name}`, resolvedType: type, name, scope: "local" as const };
}

function binop(op: string, left: IRExpr, right: IRExpr, type: TypeExpr = INT, operandType: TypeExpr = INT): IRBinop {
    return {
        kind: "ir_binop", sourceId: `binop-${op}`, resolvedType: type,
        op: op as IRBinop["op"], left, right, resolvedOperandType: operandType,
    };
}

function unop(op: string, operand: IRExpr, type: TypeExpr = INT): IRUnop {
    return {
        kind: "ir_unop", sourceId: `unop-${op}`, resolvedType: type,
        op: op as IRUnop["op"], operand,
    };
}

function mkIf(condition: IRExpr, thenBody: IRExpr[], elseBody: IRExpr[], type: TypeExpr = INT): IRIf {
    return { kind: "ir_if", sourceId: "if-001", resolvedType: type, condition, then: thenBody, else: elseBody };
}

function mkFn(name: string, body: IRExpr[], returnType: TypeExpr = INT): IRFunction {
    return {
        sourceId: `fn-${name}`, name, params: [], resolvedReturnType: returnType,
        effects: ["pure"], contracts: [], body, closureEnv: [], isLambda: false,
    };
}

function mkModule(functions: IRFunction[], constants: IRModule["constants"] = []): IRModule {
    return { name: "Test", sourceId: "mod-test", imports: [], records: [], enums: [], functions, constants };
}

// =============================================================================
// Int Arithmetic Folding
// =============================================================================

describe("IR Optimize — Int arithmetic", () => {
    it("should fold addition: 1 + 2 → 3", () => {
        const ir = mkModule([mkFn("main", [binop("+", lit(1), lit(2))])]);
        const result = optimize(ir);
        const expr = result.functions[0]!.body[0]!;
        expect(expr.kind).toBe("ir_literal");
        expect((expr as IRLiteral).value).toBe(3);
    });

    it("should fold subtraction: 10 - 4 → 6", () => {
        const ir = mkModule([mkFn("main", [binop("-", lit(10), lit(4))])]);
        const result = optimize(ir);
        expect((result.functions[0]!.body[0]! as IRLiteral).value).toBe(6);
    });

    it("should fold multiplication: 3 * 4 → 12", () => {
        const ir = mkModule([mkFn("main", [binop("*", lit(3), lit(4))])]);
        const result = optimize(ir);
        expect((result.functions[0]!.body[0]! as IRLiteral).value).toBe(12);
    });

    it("should fold division: 10 / 3 → 3 (integer)", () => {
        const ir = mkModule([mkFn("main", [binop("/", lit(10), lit(3))])]);
        const result = optimize(ir);
        expect((result.functions[0]!.body[0]! as IRLiteral).value).toBe(3);
    });

    it("should fold modulo: 10 % 3 → 1", () => {
        const ir = mkModule([mkFn("main", [binop("%", lit(10), lit(3))])]);
        const result = optimize(ir);
        expect((result.functions[0]!.body[0]! as IRLiteral).value).toBe(1);
    });

    it("should NOT fold division by zero", () => {
        const ir = mkModule([mkFn("main", [binop("/", lit(10), lit(0))])]);
        const result = optimize(ir);
        expect(result.functions[0]!.body[0]!.kind).toBe("ir_binop");
    });

    it("should NOT fold modulo by zero", () => {
        const ir = mkModule([mkFn("main", [binop("%", lit(10), lit(0))])]);
        const result = optimize(ir);
        expect(result.functions[0]!.body[0]!.kind).toBe("ir_binop");
    });

    it("should wrap to 32-bit signed Int: 2147483647 + 1 → -2147483648", () => {
        const ir = mkModule([mkFn("main", [binop("+", lit(2147483647), lit(1))])]);
        const result = optimize(ir);
        expect((result.functions[0]!.body[0]! as IRLiteral).value).toBe(-2147483648);
    });
});

// =============================================================================
// Float Arithmetic Folding
// =============================================================================

describe("IR Optimize — Float arithmetic", () => {
    it("should fold float addition: 1.5 + 2.5 → 4.0", () => {
        const ir = mkModule([mkFn("main", [binop("+", lit(1.5, FLOAT), lit(2.5, FLOAT), FLOAT, FLOAT)], FLOAT)]);
        const result = optimize(ir);
        expect((result.functions[0]!.body[0]! as IRLiteral).value).toBe(4.0);
    });

    it("should fold float multiplication: 3.0 * 2.0 → 6.0", () => {
        const ir = mkModule([mkFn("main", [binop("*", lit(3.0, FLOAT), lit(2.0, FLOAT), FLOAT, FLOAT)], FLOAT)]);
        const result = optimize(ir);
        expect((result.functions[0]!.body[0]! as IRLiteral).value).toBe(6.0);
    });

    it("should NOT wrap floats to 32-bit", () => {
        const ir = mkModule([mkFn("main", [binop("+", lit(1e18, FLOAT), lit(1e18, FLOAT), FLOAT, FLOAT)], FLOAT)]);
        const result = optimize(ir);
        expect((result.functions[0]!.body[0]! as IRLiteral).value).toBe(2e18);
    });
});

// =============================================================================
// Comparison Folding
// =============================================================================

describe("IR Optimize — comparisons", () => {
    it("should fold 1 < 2 → true", () => {
        const ir = mkModule([mkFn("main", [binop("<", lit(1), lit(2), BOOL)], BOOL)]);
        const result = optimize(ir);
        expect((result.functions[0]!.body[0]! as IRLiteral).value).toBe(true);
    });

    it("should fold 3 == 3 → true", () => {
        const ir = mkModule([mkFn("main", [binop("==", lit(3), lit(3), BOOL)], BOOL)]);
        const result = optimize(ir);
        expect((result.functions[0]!.body[0]! as IRLiteral).value).toBe(true);
    });

    it("should fold 5 > 10 → false", () => {
        const ir = mkModule([mkFn("main", [binop(">", lit(5), lit(10), BOOL)], BOOL)]);
        const result = optimize(ir);
        expect((result.functions[0]!.body[0]! as IRLiteral).value).toBe(false);
    });

    it("should fold 4 != 4 → false", () => {
        const ir = mkModule([mkFn("main", [binop("!=", lit(4), lit(4), BOOL)], BOOL)]);
        const result = optimize(ir);
        expect((result.functions[0]!.body[0]! as IRLiteral).value).toBe(false);
    });

    it("should fold 3 >= 3 → true", () => {
        const ir = mkModule([mkFn("main", [binop(">=", lit(3), lit(3), BOOL)], BOOL)]);
        const result = optimize(ir);
        expect((result.functions[0]!.body[0]! as IRLiteral).value).toBe(true);
    });

    it("should fold 2 <= 5 → true", () => {
        const ir = mkModule([mkFn("main", [binop("<=", lit(2), lit(5), BOOL)], BOOL)]);
        const result = optimize(ir);
        expect((result.functions[0]!.body[0]! as IRLiteral).value).toBe(true);
    });
});

// =============================================================================
// Boolean Folding
// =============================================================================

describe("IR Optimize — boolean ops", () => {
    it("should fold true and false → false", () => {
        const ir = mkModule([mkFn("main", [binop("and", lit(true, BOOL), lit(false, BOOL), BOOL, BOOL)], BOOL)]);
        const result = optimize(ir);
        expect((result.functions[0]!.body[0]! as IRLiteral).value).toBe(false);
    });

    it("should fold true or false → true", () => {
        const ir = mkModule([mkFn("main", [binop("or", lit(true, BOOL), lit(false, BOOL), BOOL, BOOL)], BOOL)]);
        const result = optimize(ir);
        expect((result.functions[0]!.body[0]! as IRLiteral).value).toBe(true);
    });

    it("should fold false implies true → true", () => {
        const ir = mkModule([mkFn("main", [binop("implies", lit(false, BOOL), lit(true, BOOL), BOOL, BOOL)], BOOL)]);
        const result = optimize(ir);
        expect((result.functions[0]!.body[0]! as IRLiteral).value).toBe(true);
    });

    it("should fold true implies false → false", () => {
        const ir = mkModule([mkFn("main", [binop("implies", lit(true, BOOL), lit(false, BOOL), BOOL, BOOL)], BOOL)]);
        const result = optimize(ir);
        expect((result.functions[0]!.body[0]! as IRLiteral).value).toBe(false);
    });
});

// =============================================================================
// String Folding
// =============================================================================

describe("IR Optimize — string ops", () => {
    it("should fold string concatenation: 'hello' + ' world' → 'hello world'", () => {
        const ir = mkModule([mkFn("main", [binop("+", lit("hello", STRING), lit(" world", STRING), STRING, STRING)], STRING)]);
        const result = optimize(ir);
        expect((result.functions[0]!.body[0]! as IRLiteral).value).toBe("hello world");
    });

    it("should fold string equality: 'a' == 'a' → true", () => {
        const ir = mkModule([mkFn("main", [binop("==", lit("a", STRING), lit("a", STRING), BOOL, STRING)], BOOL)]);
        const result = optimize(ir);
        expect((result.functions[0]!.body[0]! as IRLiteral).value).toBe(true);
    });

    it("should fold string inequality: 'a' != 'b' → true", () => {
        const ir = mkModule([mkFn("main", [binop("!=", lit("a", STRING), lit("b", STRING), BOOL, STRING)], BOOL)]);
        const result = optimize(ir);
        expect((result.functions[0]!.body[0]! as IRLiteral).value).toBe(true);
    });
});

// =============================================================================
// Unary Operation Folding
// =============================================================================

describe("IR Optimize — unary ops", () => {
    it("should fold negation: -5 → -5", () => {
        const ir = mkModule([mkFn("main", [unop("-", lit(5))])]);
        const result = optimize(ir);
        expect((result.functions[0]!.body[0]! as IRLiteral).value).toBe(-5);
    });

    it("should fold logical not: not true → false", () => {
        const ir = mkModule([mkFn("main", [unop("not", lit(true, BOOL), BOOL)], BOOL)]);
        const result = optimize(ir);
        expect((result.functions[0]!.body[0]! as IRLiteral).value).toBe(false);
    });

    it("should fold double negation: -(-3) → 3", () => {
        const ir = mkModule([mkFn("main", [unop("-", unop("-", lit(3)))])]);
        const result = optimize(ir);
        expect((result.functions[0]!.body[0]! as IRLiteral).value).toBe(3);
    });

    it("should fold float negation: -1.5 → -1.5", () => {
        const ir = mkModule([mkFn("main", [unop("-", lit(1.5, FLOAT), FLOAT)], FLOAT)]);
        const result = optimize(ir);
        expect((result.functions[0]!.body[0]! as IRLiteral).value).toBe(-1.5);
    });
});

// =============================================================================
// If-Condition Folding
// =============================================================================

describe("IR Optimize — if folding", () => {
    it("should fold if true → then branch", () => {
        const ir = mkModule([mkFn("main", [mkIf(lit(true, BOOL), [lit(42)], [lit(0)])])]);
        const result = optimize(ir);
        // Single-element then branch should collapse to the literal
        const expr = result.functions[0]!.body[0]!;
        expect(expr.kind).toBe("ir_literal");
        expect((expr as IRLiteral).value).toBe(42);
    });

    it("should fold if false → else branch", () => {
        const ir = mkModule([mkFn("main", [mkIf(lit(false, BOOL), [lit(42)], [lit(0)])])]);
        const result = optimize(ir);
        const expr = result.functions[0]!.body[0]!;
        expect(expr.kind).toBe("ir_literal");
        expect((expr as IRLiteral).value).toBe(0);
    });

    it("should fold if true with multi-expression then → block", () => {
        const letExpr: IRExpr = {
            kind: "ir_let", sourceId: "let-x", resolvedType: INT,
            name: "x", boundType: INT, value: lit(1),
        };
        const ir = mkModule([mkFn("main", [mkIf(lit(true, BOOL), [letExpr, ident("x")], [lit(0)])])]);
        const result = optimize(ir);
        const expr = result.functions[0]!.body[0]!;
        // Multi-expression branches become a block
        expect(expr.kind).toBe("ir_block");
    });

    it("should fold cascading: if (1 < 2) → if true → then branch", () => {
        const cond = binop("<", lit(1), lit(2), BOOL);
        const ir = mkModule([mkFn("main", [mkIf(cond, [lit(10)], [lit(20)])])]);
        const result = optimize(ir);
        // The condition 1 < 2 folds to true, then if true folds to then branch
        const expr = result.functions[0]!.body[0]!;
        expect(expr.kind).toBe("ir_literal");
        expect((expr as IRLiteral).value).toBe(10);
    });

    it("should NOT fold if with non-literal condition", () => {
        const ir = mkModule([mkFn("main", [mkIf(ident("flag", BOOL), [lit(1)], [lit(0)])])]);
        const result = optimize(ir);
        expect(result.functions[0]!.body[0]!.kind).toBe("ir_if");
    });
});

// =============================================================================
// Identity Optimizations
// =============================================================================

describe("IR Optimize — identity ops", () => {
    it("should fold x + 0 → x", () => {
        const ir = mkModule([mkFn("main", [binop("+", ident("x"), lit(0))])]);
        const result = optimize(ir);
        const expr = result.functions[0]!.body[0]!;
        expect(expr.kind).toBe("ir_ident");
    });

    it("should fold 0 + x → x", () => {
        const ir = mkModule([mkFn("main", [binop("+", lit(0), ident("x"))])]);
        const result = optimize(ir);
        expect(result.functions[0]!.body[0]!.kind).toBe("ir_ident");
    });

    it("should fold x - 0 → x", () => {
        const ir = mkModule([mkFn("main", [binop("-", ident("x"), lit(0))])]);
        const result = optimize(ir);
        expect(result.functions[0]!.body[0]!.kind).toBe("ir_ident");
    });

    it("should fold x * 1 → x", () => {
        const ir = mkModule([mkFn("main", [binop("*", ident("x"), lit(1))])]);
        const result = optimize(ir);
        expect(result.functions[0]!.body[0]!.kind).toBe("ir_ident");
    });

    it("should fold 1 * x → x", () => {
        const ir = mkModule([mkFn("main", [binop("*", lit(1), ident("x"))])]);
        const result = optimize(ir);
        expect(result.functions[0]!.body[0]!.kind).toBe("ir_ident");
    });

    it("should fold x * 0 → 0", () => {
        const ir = mkModule([mkFn("main", [binop("*", ident("x"), lit(0))])]);
        const result = optimize(ir);
        const expr = result.functions[0]!.body[0]!;
        expect(expr.kind).toBe("ir_literal");
        expect((expr as IRLiteral).value).toBe(0);
    });

    it("should fold 0 * x → 0", () => {
        const ir = mkModule([mkFn("main", [binop("*", lit(0), ident("x"))])]);
        const result = optimize(ir);
        expect((result.functions[0]!.body[0]! as IRLiteral).value).toBe(0);
    });

    it("should fold float identity: x + 0.0 → x", () => {
        const ir = mkModule([mkFn("main", [binop("+", ident("x", FLOAT), lit(0, FLOAT), FLOAT, FLOAT)], FLOAT)]);
        const result = optimize(ir);
        expect(result.functions[0]!.body[0]!.kind).toBe("ir_ident");
    });
});

// =============================================================================
// Cascading Folds
// =============================================================================

describe("IR Optimize — cascading", () => {
    it("should cascade: (1 + 2) * (3 + 4) → 21", () => {
        const left = binop("+", lit(1), lit(2));
        const right = binop("+", lit(3), lit(4));
        const ir = mkModule([mkFn("main", [binop("*", left, right)])]);
        const result = optimize(ir);
        expect((result.functions[0]!.body[0]! as IRLiteral).value).toBe(21);
    });

    it("should cascade: -(1 + 2) → -3", () => {
        const sum = binop("+", lit(1), lit(2));
        const ir = mkModule([mkFn("main", [unop("-", sum)])]);
        const result = optimize(ir);
        expect((result.functions[0]!.body[0]! as IRLiteral).value).toBe(-3);
    });

    it("should cascade: not (3 == 4) → true", () => {
        const cmp = binop("==", lit(3), lit(4), BOOL);
        const ir = mkModule([mkFn("main", [unop("not", cmp, BOOL)], BOOL)]);
        const result = optimize(ir);
        expect((result.functions[0]!.body[0]! as IRLiteral).value).toBe(true);
    });
});

// =============================================================================
// Non-Foldable Preservation
// =============================================================================

describe("IR Optimize — non-foldable", () => {
    it("should preserve x + 1 (variable operand)", () => {
        const ir = mkModule([mkFn("main", [binop("+", ident("x"), lit(1))])]);
        const result = optimize(ir);
        const expr = result.functions[0]!.body[0]!;
        expect(expr.kind).toBe("ir_binop");
    });

    it("should preserve function calls even with literal args", () => {
        const call: IRExpr = {
            kind: "ir_call", sourceId: "call-001", resolvedType: INT,
            fn: { kind: "ir_ident", sourceId: "id-f", resolvedType: INT, name: "f", scope: "function" },
            args: [lit(1)], callKind: "direct", stringParamIndices: [], argCoercions: {},
        };
        const ir = mkModule([mkFn("main", [call])]);
        const result = optimize(ir);
        expect(result.functions[0]!.body[0]!.kind).toBe("ir_call");
    });

    it("should fold args inside preserved calls", () => {
        const call: IRExpr = {
            kind: "ir_call", sourceId: "call-001", resolvedType: INT,
            fn: { kind: "ir_ident", sourceId: "id-f", resolvedType: INT, name: "f", scope: "function" },
            args: [binop("+", lit(1), lit(2))],
            callKind: "direct", stringParamIndices: [], argCoercions: {},
        };
        const ir = mkModule([mkFn("main", [call])]);
        const result = optimize(ir);
        const resultCall = result.functions[0]!.body[0]!;
        expect(resultCall.kind).toBe("ir_call");
        if (resultCall.kind === "ir_call") {
            expect(resultCall.args[0]!.kind).toBe("ir_literal");
            expect((resultCall.args[0]! as IRLiteral).value).toBe(3);
        }
    });
});

// =============================================================================
// Module-Level Optimization
// =============================================================================

describe("IR Optimize — module level", () => {
    it("should fold constants", () => {
        const ir = mkModule(
            [mkFn("main", [lit(0)])],
            [{
                sourceId: "const-001", name: "ANSWER",
                resolvedType: INT,
                value: binop("*", lit(6), lit(7)),
            }],
        );
        const result = optimize(ir);
        const constVal = result.constants[0]!.value;
        expect(constVal.kind).toBe("ir_literal");
        expect((constVal as IRLiteral).value).toBe(42);
    });

    it("should fold across multiple functions", () => {
        const ir = mkModule([
            mkFn("f", [binop("+", lit(1), lit(2))]),
            mkFn("g", [binop("*", lit(3), lit(4))]),
        ]);
        const result = optimize(ir);
        expect((result.functions[0]!.body[0]! as IRLiteral).value).toBe(3);
        expect((result.functions[1]!.body[0]! as IRLiteral).value).toBe(12);
    });
});

// =============================================================================
// Node Count Reduction
// =============================================================================

describe("IR Optimize — node count reduction", () => {
    it("should reduce node count for foldable expressions", () => {
        const ir = mkModule([mkFn("main", [binop("+", lit(1), lit(2))])]);
        const before = countIRNodes(ir);
        const result = optimize(ir);
        const after = countIRNodes(result);
        // 3 nodes (binop + 2 lits) → 1 node (literal)
        expect(before).toBe(3);
        expect(after).toBe(1);
    });

    it("should reduce node count for cascading folds", () => {
        const left = binop("+", lit(1), lit(2));
        const right = binop("+", lit(3), lit(4));
        const ir = mkModule([mkFn("main", [binop("*", left, right)])]);
        const before = countIRNodes(ir);
        const result = optimize(ir);
        const after = countIRNodes(result);
        // 7 nodes → 1 node
        expect(before).toBe(7);
        expect(after).toBe(1);
    });

    it("should reduce node count for if-folding", () => {
        const ir = mkModule([mkFn("main", [mkIf(lit(true, BOOL), [lit(42)], [lit(0)])])]);
        const before = countIRNodes(ir);
        const result = optimize(ir);
        const after = countIRNodes(result);
        // 4 nodes (if + cond + then lit + else lit) → 1 node (literal)
        expect(before).toBe(4);
        expect(after).toBe(1);
    });
});

// =============================================================================
// sourceId Preservation
// =============================================================================

describe("IR Optimize — sourceId preservation", () => {
    it("should preserve sourceId from original binop node", () => {
        const ir = mkModule([mkFn("main", [binop("+", lit(1), lit(2))])]);
        const result = optimize(ir);
        const expr = result.functions[0]!.body[0]!;
        expect(expr.sourceId).toBe("binop-+");
    });

    it("should preserve sourceId from original unop node", () => {
        const ir = mkModule([mkFn("main", [unop("-", lit(5))])]);
        const result = optimize(ir);
        expect(result.functions[0]!.body[0]!.sourceId).toBe("unop--");
    });
});

// =============================================================================
// Nested Structure Folding  
// =============================================================================

describe("IR Optimize — nested structures", () => {
    it("should fold inside let bindings", () => {
        const letExpr: IRExpr = {
            kind: "ir_let", sourceId: "let-x", resolvedType: INT,
            name: "x", boundType: INT, value: binop("+", lit(1), lit(2)),
        };
        const ir = mkModule([mkFn("main", [letExpr, ident("x")])]);
        const result = optimize(ir);
        const expr = result.functions[0]!.body[0]!;
        expect(expr.kind).toBe("ir_let");
        if (expr.kind === "ir_let") {
            expect(expr.value.kind).toBe("ir_literal");
            expect((expr.value as IRLiteral).value).toBe(3);
        }
    });

    it("should fold inside block expressions", () => {
        const block: IRExpr = {
            kind: "ir_block", sourceId: "block-001", resolvedType: INT,
            body: [binop("*", lit(3), lit(4))],
        };
        const ir = mkModule([mkFn("main", [block])]);
        const result = optimize(ir);
        if (result.functions[0]!.body[0]!.kind === "ir_block") {
            expect(result.functions[0]!.body[0]!.body[0]!.kind).toBe("ir_literal");
        }
    });

    it("should fold inside match arm bodies", () => {
        const matchExpr: IRExpr = {
            kind: "ir_match", sourceId: "match-001", resolvedType: INT,
            target: ident("x"),
            arms: [{
                sourceId: "arm-001",
                pattern: { kind: "wildcard" },
                body: [binop("+", lit(10), lit(20))],
            }],
            targetTypeName: undefined,
        };
        const ir = mkModule([mkFn("main", [matchExpr])]);
        const result = optimize(ir);
        const match = result.functions[0]!.body[0]!;
        if (match.kind === "ir_match") {
            expect(match.arms[0]!.body[0]!.kind).toBe("ir_literal");
            expect((match.arms[0]!.body[0]! as IRLiteral).value).toBe(30);
        }
    });

    it("should fold inside array elements", () => {
        const arr: IRExpr = {
            kind: "ir_array", sourceId: "arr-001",
            resolvedType: { kind: "array", element: INT },
            elements: [binop("+", lit(1), lit(2)), binop("*", lit(3), lit(4))],
        };
        const ir = mkModule([mkFn("main", [arr])]);
        const result = optimize(ir);
        if (result.functions[0]!.body[0]!.kind === "ir_array") {
            const arr = result.functions[0]!.body[0]!;
            expect((arr.elements[0]! as IRLiteral).value).toBe(3);
            expect((arr.elements[1]! as IRLiteral).value).toBe(12);
        }
    });
});
