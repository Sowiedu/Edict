import { describe, it, expect } from "vitest";
import type {
    IRModule,
    IRFunction,
    IRExpr,
    IRLiteral,
    IRIdent,
    IRBinop,
    IRUnop,
    IRCall,
    IRIf,
    IRLet,
    IRBlock,
    IRMatch,
    IRArray,
    IRTuple,
    IRRecordExpr,
    IREnumConstructor,
    IRAccess,
    IRLambdaRef,
    IRStringInterp,
    IRParam,
    IRClosureVar,
    IRRecordDef,
    IREnumDef,
    IRConstant,
    IRImport,
    IRFieldInit,
    IRMatchArm,
    IRStringInterpPart,
} from "../../src/ir/types.js";
import { countIRNodes, irExprKindLabel } from "../../src/ir/types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

const INT = { kind: "basic" as const, name: "Int" as const };
const FLOAT = { kind: "basic" as const, name: "Float" as const };
const STRING = { kind: "basic" as const, name: "String" as const };
const BOOL = { kind: "basic" as const, name: "Bool" as const };
const VOID = { kind: "basic" as const, name: "Int" as const }; // IR let uses this as placeholder

function lit(value: number | string | boolean, type = INT): IRLiteral {
    return { kind: "ir_literal", sourceId: `lit-${value}`, resolvedType: type, value };
}

function ident(name: string, type = INT): IRIdent {
    return { kind: "ir_ident", sourceId: `id-${name}`, resolvedType: type, name, scope: "local" };
}

// ── Node Construction Tests ─────────────────────────────────────────────────

describe("IR Types — node construction", () => {
    it("should construct IRLiteral with resolved type", () => {
        const node: IRLiteral = {
            kind: "ir_literal",
            sourceId: "lit-001",
            resolvedType: INT,
            value: 42,
        };
        expect(node.kind).toBe("ir_literal");
        expect(node.resolvedType).toEqual(INT);
        expect(node.value).toBe(42);
    });

    it("should construct IRIdent with scope", () => {
        const node: IRIdent = {
            kind: "ir_ident",
            sourceId: "id-x",
            resolvedType: INT,
            name: "x",
            scope: "local",
        };
        expect(node.scope).toBe("local");

        const closureRef: IRIdent = { ...node, scope: "closure" };
        expect(closureRef.scope).toBe("closure");

        const globalRef: IRIdent = { ...node, scope: "global" };
        expect(globalRef.scope).toBe("global");

        const fnRef: IRIdent = { ...node, scope: "function" };
        expect(fnRef.scope).toBe("function");
    });

    it("should construct IRBinop with resolved operand type", () => {
        const node: IRBinop = {
            kind: "ir_binop",
            sourceId: "add-001",
            resolvedType: INT,
            op: "+",
            left: lit(1),
            right: lit(2),
            resolvedOperandType: INT,
        };
        expect(node.resolvedOperandType).toEqual(INT);
    });

    it("should construct IRBinop for float operations", () => {
        const node: IRBinop = {
            kind: "ir_binop",
            sourceId: "fadd-001",
            resolvedType: FLOAT,
            op: "+",
            left: lit(1.5, FLOAT),
            right: lit(2.5, FLOAT),
            resolvedOperandType: FLOAT,
        };
        expect(node.resolvedOperandType).toEqual(FLOAT);
    });

    it("should construct IRBinop for comparisons (result is Bool)", () => {
        const node: IRBinop = {
            kind: "ir_binop",
            sourceId: "cmp-001",
            resolvedType: BOOL,
            op: "<",
            left: lit(1),
            right: lit(2),
            resolvedOperandType: INT,
        };
        expect(node.resolvedType).toEqual(BOOL);
    });

    it("should construct IRUnop", () => {
        const node: IRUnop = {
            kind: "ir_unop",
            sourceId: "neg-001",
            resolvedType: INT,
            op: "-",
            operand: lit(5),
        };
        expect(node.op).toBe("-");
    });

    it("should construct IRCall with call kind classification", () => {
        const directCall: IRCall = {
            kind: "ir_call",
            sourceId: "call-001",
            resolvedType: INT,
            fn: ident("double"),
            args: [lit(21)],
            callKind: "direct",
            stringParamIndices: [],
            argCoercions: {},
        };
        expect(directCall.callKind).toBe("direct");

        const builtinCall: IRCall = {
            kind: "ir_call",
            sourceId: "call-002",
            resolvedType: STRING,
            fn: ident("print", { kind: "fn_type", params: [STRING], effects: ["io"], returnType: STRING }),
            args: [lit("hello", STRING)],
            callKind: "builtin",
            stringParamIndices: [0],
            argCoercions: {},
        };
        expect(builtinCall.callKind).toBe("builtin");
        expect(builtinCall.stringParamIndices).toEqual([0]);
    });

    it("should construct IRIf with then and else branches", () => {
        const node: IRIf = {
            kind: "ir_if",
            sourceId: "if-001",
            resolvedType: INT,
            condition: lit(true, BOOL),
            then: [lit(1)],
            else: [lit(2)],
        };
        expect(node.then.length).toBe(1);
        expect(node.else.length).toBe(1);
    });

    it("should construct IRLet with bound type", () => {
        const node: IRLet = {
            kind: "ir_let",
            sourceId: "let-001",
            resolvedType: INT, // void-like
            name: "x",
            boundType: INT,
            value: lit(42),
        };
        expect(node.boundType).toEqual(INT);
    });

    it("should construct IRBlock", () => {
        const node: IRBlock = {
            kind: "ir_block",
            sourceId: "block-001",
            resolvedType: INT,
            body: [
                { kind: "ir_let", sourceId: "let-x", resolvedType: INT, name: "x", boundType: INT, value: lit(1) },
                ident("x"),
            ],
        };
        expect(node.body.length).toBe(2);
    });

    it("should construct IRMatch with targetTypeName", () => {
        const node: IRMatch = {
            kind: "ir_match",
            sourceId: "match-001",
            resolvedType: INT,
            target: ident("opt"),
            arms: [
                {
                    sourceId: "arm-001",
                    pattern: { kind: "constructor", name: "Some", fields: [{ kind: "binding", name: "v" }] },
                    body: [ident("v")],
                },
                {
                    sourceId: "arm-002",
                    pattern: { kind: "constructor", name: "None", fields: [] },
                    body: [lit(0)],
                },
            ],
            targetTypeName: "Option",
        };
        expect(node.targetTypeName).toBe("Option");
        expect(node.arms.length).toBe(2);
    });

    it("should construct IRArray", () => {
        const node: IRArray = {
            kind: "ir_array",
            sourceId: "arr-001",
            resolvedType: { kind: "array", element: INT },
            elements: [lit(1), lit(2), lit(3)],
        };
        expect(node.elements.length).toBe(3);
    });

    it("should construct IRTuple", () => {
        const node: IRTuple = {
            kind: "ir_tuple",
            sourceId: "tup-001",
            resolvedType: { kind: "tuple", elements: [INT, STRING] },
            elements: [lit(42), lit("hello", STRING)],
        };
        expect(node.elements.length).toBe(2);
    });

    it("should construct IRRecordExpr with fields in order", () => {
        const node: IRRecordExpr = {
            kind: "ir_record",
            sourceId: "rec-001",
            resolvedType: { kind: "named", name: "Point" },
            name: "Point",
            fields: [
                { name: "x", value: lit(10), resolvedType: INT },
                { name: "y", value: lit(20), resolvedType: INT },
            ],
        };
        expect(node.fields.length).toBe(2);
        expect(node.fields[0]!.name).toBe("x");
    });

    it("should construct IREnumConstructor with tag", () => {
        const node: IREnumConstructor = {
            kind: "ir_enum_constructor",
            sourceId: "enum-001",
            resolvedType: { kind: "named", name: "Option" },
            enumName: "Option",
            variant: "Some",
            tag: 1,
            fields: [{ name: "value", value: lit(42), resolvedType: INT }],
        };
        expect(node.tag).toBe(1);
    });

    it("should construct IRAccess with pre-resolved target type", () => {
        const node: IRAccess = {
            kind: "ir_access",
            sourceId: "acc-001",
            resolvedType: INT,
            target: ident("point"),
            field: "x",
            targetTypeName: "Point",
        };
        expect(node.targetTypeName).toBe("Point");
    });

    it("should construct IRLambdaRef with captures", () => {
        const node: IRLambdaRef = {
            kind: "ir_lambda_ref",
            sourceId: "lam-001",
            resolvedType: { kind: "fn_type", params: [INT], effects: ["pure"], returnType: INT },
            liftedName: "__lambda_0",
            captures: [
                { name: "offset", resolvedType: INT },
            ],
        };
        expect(node.captures.length).toBe(1);
        expect(node.liftedName).toBe("__lambda_0");
    });

    it("should construct IRStringInterp with coercions", () => {
        const node: IRStringInterp = {
            kind: "ir_string_interp",
            sourceId: "interp-001",
            resolvedType: STRING,
            parts: [
                { expr: lit("x = ", STRING), coercionBuiltin: undefined },
                { expr: ident("x"), coercionBuiltin: "intToString" },
            ],
        };
        expect(node.parts.length).toBe(2);
        expect(node.parts[1]!.coercionBuiltin).toBe("intToString");
    });
});

// ── IRFunction Construction ─────────────────────────────────────────────────

describe("IR Types — IRFunction construction", () => {
    it("should construct a simple function", () => {
        const fn: IRFunction = {
            sourceId: "fn-double",
            name: "double",
            params: [{ sourceId: "p-x", name: "x", resolvedType: INT }],
            resolvedReturnType: INT,
            effects: ["pure"],
            contracts: [],
            body: [{
                kind: "ir_binop",
                sourceId: "mul-001",
                resolvedType: INT,
                op: "*",
                left: ident("x"),
                right: lit(2),
                resolvedOperandType: INT,
            }],
            closureEnv: [],
            isLambda: false,
        };
        expect(fn.closureEnv.length).toBe(0);
        expect(fn.isLambda).toBe(false);
    });

    it("should construct a closure with captured variables", () => {
        const fn: IRFunction = {
            sourceId: "fn-adder",
            name: "__lambda_0",
            params: [{ sourceId: "p-y", name: "y", resolvedType: INT }],
            resolvedReturnType: INT,
            effects: ["pure"],
            contracts: [],
            body: [{
                kind: "ir_binop",
                sourceId: "add-001",
                resolvedType: INT,
                op: "+",
                left: { kind: "ir_ident", sourceId: "id-x", resolvedType: INT, name: "x", scope: "closure" },
                right: ident("y"),
                resolvedOperandType: INT,
            }],
            closureEnv: [{ name: "x", resolvedType: INT }],
            isLambda: true,
        };
        expect(fn.closureEnv.length).toBe(1);
        expect(fn.closureEnv[0]!.name).toBe("x");
        expect(fn.isLambda).toBe(true);
    });
});

// ── IRModule Construction ───────────────────────────────────────────────────

describe("IR Types — IRModule construction", () => {
    it("should construct a complete module", () => {
        const module: IRModule = {
            name: "TestModule",
            sourceId: "mod-test",
            imports: [{
                module: "std",
                name: "map",
                paramTypes: [
                    { kind: "array", element: INT },
                    { kind: "fn_type", params: [INT], effects: ["pure"], returnType: INT },
                ],
                returnType: { kind: "array", element: INT },
                effects: ["pure"],
            }],
            functions: [{
                sourceId: "fn-main",
                name: "main",
                params: [],
                resolvedReturnType: INT,
                effects: ["pure"],
                contracts: [],
                body: [lit(42)],
                closureEnv: [],
                isLambda: false,
            }],
            records: [{
                name: "Point",
                fields: [
                    { name: "x", resolvedType: INT, hasDefault: false },
                    { name: "y", resolvedType: INT, hasDefault: false },
                ],
            }],
            enums: [{
                name: "Color",
                variants: [
                    { name: "Red", tag: 0, fields: [] },
                    { name: "Green", tag: 1, fields: [] },
                    { name: "Blue", tag: 2, fields: [] },
                ],
            }],
            constants: [{
                sourceId: "const-pi",
                name: "PI",
                resolvedType: FLOAT,
                value: lit(3.14159, FLOAT),
            }],
        };

        expect(module.name).toBe("TestModule");
        expect(module.functions.length).toBe(1);
        expect(module.records.length).toBe(1);
        expect(module.enums.length).toBe(1);
        expect(module.constants.length).toBe(1);
        expect(module.imports.length).toBe(1);
    });
});

// ── countIRNodes ─────────────────────────────────────────────────────────────

describe("IR Types — countIRNodes", () => {
    it("should count leaf nodes", () => {
        const module: IRModule = {
            name: "Test", sourceId: "mod-test",
            imports: [], records: [], enums: [], constants: [],
            functions: [{
                sourceId: "fn-main", name: "main",
                params: [], resolvedReturnType: INT, effects: ["pure"],
                contracts: [], closureEnv: [], isLambda: false,
                body: [lit(42)],
            }],
        };
        expect(countIRNodes(module)).toBe(1);
    });

    it("should count nested expressions", () => {
        const module: IRModule = {
            name: "Test", sourceId: "mod-test",
            imports: [], records: [], enums: [], constants: [],
            functions: [{
                sourceId: "fn-main", name: "main",
                params: [], resolvedReturnType: INT, effects: ["pure"],
                contracts: [], closureEnv: [], isLambda: false,
                body: [{
                    kind: "ir_binop",
                    sourceId: "add-001",
                    resolvedType: INT,
                    op: "+",
                    left: lit(1),
                    right: lit(2),
                    resolvedOperandType: INT,
                }],
            }],
        };
        // 1 binop + 2 literals = 3
        expect(countIRNodes(module)).toBe(3);
    });

    it("should count constants", () => {
        const module: IRModule = {
            name: "Test", sourceId: "mod-test",
            imports: [], records: [], enums: [],
            constants: [{
                sourceId: "const-001", name: "X", resolvedType: INT,
                value: lit(42),
            }],
            functions: [],
        };
        expect(countIRNodes(module)).toBe(1);
    });

    it("should count deeply nested if/match/call", () => {
        const module: IRModule = {
            name: "Test", sourceId: "mod-test",
            imports: [], records: [], enums: [], constants: [],
            functions: [{
                sourceId: "fn-main", name: "main",
                params: [], resolvedReturnType: INT, effects: ["pure"],
                contracts: [], closureEnv: [], isLambda: false,
                body: [{
                    kind: "ir_if",
                    sourceId: "if-001",
                    resolvedType: INT,
                    condition: lit(true, BOOL),
                    then: [{
                        kind: "ir_call",
                        sourceId: "call-001",
                        resolvedType: INT,
                        fn: ident("foo"),
                        args: [lit(1)],
                        callKind: "direct",
                        stringParamIndices: [],
                        argCoercions: {},
                    }],
                    else: [lit(0)],
                }],
            }],
        };
        // if(1) + condition(1) + call(1) + fn ident(1) + arg lit(1) + else lit(1) = 6
        expect(countIRNodes(module)).toBe(6);
    });
});

// ── irExprKindLabel ─────────────────────────────────────────────────────────

describe("IR Types — irExprKindLabel", () => {
    it("should return the kind string", () => {
        expect(irExprKindLabel(lit(42))).toBe("ir_literal");
        expect(irExprKindLabel(ident("x"))).toBe("ir_ident");
    });
});
