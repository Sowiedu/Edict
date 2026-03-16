// =============================================================================
// IR Codegen Tests — compile IR expressions to WASM
// =============================================================================
// Tests the parallel IR-based codegen path (compile-ir-{expr,scalars,calls,data,match}.ts).
// Verifies that IR nodes with pre-resolved types produce correct binaryen output,
// and that the heuristic-free IR path matches the AST path's behavior.

import { describe, it, expect, afterEach } from "vitest";
import * as binaryen from "../../src/codegen/wasm-encoder.js";
import { validate, resolve, typeCheck, lowerModule } from "../../src/index.js";
import { compileIRExpr, irExprWasmType } from "../../src/codegen/compile-ir-expr.js";
import {
    compileIRLiteral,
    compileIRIdent,
    compileIRBinop,
    compileIRLet,
    compileIRBlock,
} from "../../src/codegen/compile-ir-scalars.js";
import { compileIRCall, compileIRLambdaRef } from "../../src/codegen/compile-ir-calls.js";
import {
    compileIRRecord,
    compileIRTuple,
    compileIREnumConstructor,
    compileIRAccess,
    compileIRArray,
    compileIRStringInterp,
} from "../../src/codegen/compile-ir-data.js";
import { compileIRMatch } from "../../src/codegen/compile-ir-match.js";
import { FunctionContext, edictTypeToWasm } from "../../src/codegen/types.js";
import { StringTable } from "../../src/codegen/string-table.js";
import type { CompilationContext } from "../../src/codegen/types.js";
import type { EdictModule } from "../../src/ast/nodes.js";
import type { TypedModuleInfo } from "../../src/checker/check.js";
import type {
    IRModule, IRFunction, IRExpr, IRLiteral, IRIdent, IRBinop,
    IRCall, IRMatch, IRRecordExpr, IREnumConstructor, IRAccess,
    IRArray, IRTuple, IRLambdaRef, IRStringInterp,
} from "../../src/ir/types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Run a module through the full pipeline to get an IR module */
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

/** Create a minimal CompilationContext for testing */
function makeCC(mod: binaryen.Module): CompilationContext {
    return {
        mod,
        strings: new StringTable(),
        fnSigs: new Map(),
        errors: [],
        constGlobals: new Map(),
        recordLayouts: new Map(),
        enumLayouts: new Map(),
        fnTableIndices: new Map(),
        tableFunctions: [],
        lambdaCounter: 0,
    };
}

// Track binaryen modules for cleanup
const modules: binaryen.Module[] = [];
function createMod(): binaryen.Module {
    const mod = new binaryen.Module();
    // Add memory so string operations work
    mod.setMemory(1, 16, "memory", []);
    // Add heap globals needed by if-without-else
    mod.addGlobal("__heap_ptr", binaryen.i32, true, mod.i32.const(1024));
    mod.addGlobal("__heap_start", binaryen.i32, false, mod.i32.const(1024));
    modules.push(mod);
    return mod;
}

afterEach(() => {
    for (const mod of modules) {
        mod.dispose();
    }
    modules.length = 0;
});


// =============================================================================
// irExprWasmType — trivial type resolution
// =============================================================================

describe("irExprWasmType", () => {
    it("should return i32 for Int type", () => {
        const expr: IRLiteral = {
            kind: "ir_literal", sourceId: "lit-1",
            resolvedType: { kind: "basic", name: "Int" }, value: 42,
        };
        expect(irExprWasmType(expr)).toBe(binaryen.i32);
    });

    it("should return f64 for Float type", () => {
        const expr: IRLiteral = {
            kind: "ir_literal", sourceId: "lit-1",
            resolvedType: { kind: "basic", name: "Float" }, value: 3.14,
        };
        expect(irExprWasmType(expr)).toBe(binaryen.f64);
    });

    it("should return i64 for Int64 type", () => {
        const expr: IRLiteral = {
            kind: "ir_literal", sourceId: "lit-1",
            resolvedType: { kind: "basic", name: "Int64" }, value: 100,
        };
        expect(irExprWasmType(expr)).toBe(binaryen.i64);
    });

    it("should return i32 for Bool type", () => {
        const expr: IRLiteral = {
            kind: "ir_literal", sourceId: "lit-1",
            resolvedType: { kind: "basic", name: "Bool" }, value: true,
        };
        expect(irExprWasmType(expr)).toBe(binaryen.i32);
    });

    it("should return i32 for String type (pointer)", () => {
        const expr: IRLiteral = {
            kind: "ir_literal", sourceId: "lit-1",
            resolvedType: { kind: "basic", name: "String" }, value: "hello",
        };
        expect(irExprWasmType(expr)).toBe(binaryen.i32);
    });

    it("should return i32 for named types (heap pointer)", () => {
        const expr: IRLiteral = {
            kind: "ir_literal", sourceId: "lit-1",
            resolvedType: { kind: "named", name: "Point" }, value: 0,
        };
        expect(irExprWasmType(expr)).toBe(binaryen.i32);
    });
});


// =============================================================================
// Literal compilation
// =============================================================================

describe("compileIRLiteral", () => {
    it("should compile Int literal to i32.const", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const expr: IRLiteral = {
            kind: "ir_literal", sourceId: "lit-1",
            resolvedType: { kind: "basic", name: "Int" }, value: 42,
        };
        const ref = compileIRLiteral(expr, cc);
        // Wrap in a function to get WAT
        mod.addFunction("test", binaryen.none, binaryen.i32, [], ref);
        const wat = mod.emitText();
        expect(wat).toContain("i32.const 42");
    });

    it("should compile Float literal to f64.const", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const expr: IRLiteral = {
            kind: "ir_literal", sourceId: "lit-1",
            resolvedType: { kind: "basic", name: "Float" }, value: 3.14,
        };
        const ref = compileIRLiteral(expr, cc);
        mod.addFunction("test", binaryen.none, binaryen.f64, [], ref);
        const wat = mod.emitText();
        expect(wat).toContain("f64.const 3.14");
    });

    it("should compile Bool true to i32.const 1", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const expr: IRLiteral = {
            kind: "ir_literal", sourceId: "lit-1",
            resolvedType: { kind: "basic", name: "Bool" }, value: true,
        };
        const ref = compileIRLiteral(expr, cc);
        mod.addFunction("test", binaryen.none, binaryen.i32, [], ref);
        const wat = mod.emitText();
        expect(wat).toContain("i32.const 1");
    });

    it("should compile Bool false to i32.const 0", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const expr: IRLiteral = {
            kind: "ir_literal", sourceId: "lit-1",
            resolvedType: { kind: "basic", name: "Bool" }, value: false,
        };
        const ref = compileIRLiteral(expr, cc);
        mod.addFunction("test", binaryen.none, binaryen.i32, [], ref);
        const wat = mod.emitText();
        expect(wat).toContain("i32.const 0");
    });

    it("should compile String literal to i32.const (interned offset)", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const expr: IRLiteral = {
            kind: "ir_literal", sourceId: "lit-1",
            resolvedType: { kind: "basic", name: "String" }, value: "hello",
        };
        const ref = compileIRLiteral(expr, cc);
        mod.addFunction("test", binaryen.none, binaryen.i32, [], ref);
        const wat = mod.emitText();
        // String produces an i32 pointer
        expect(wat).toContain("i32.const");
    });
});


// =============================================================================
// Identifier compilation
// =============================================================================

describe("compileIRIdent", () => {
    it("should compile local scope ident to local.get", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([
            { name: "x", wasmType: binaryen.i32 },
        ]);
        const expr: IRIdent = {
            kind: "ir_ident", sourceId: "id-1",
            resolvedType: { kind: "basic", name: "Int" },
            name: "x", scope: "local",
        };
        const ref = compileIRIdent(expr, cc, ctx);
        mod.addFunction("test", binaryen.createType([binaryen.i32]), binaryen.i32, [], ref);
        const wat = mod.emitText();
        expect(wat).toContain("local.get");
    });

    it("should compile global scope ident to global.get", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        cc.constGlobals.set("MAX", binaryen.i32);
        mod.addGlobal("MAX", binaryen.i32, false, mod.i32.const(100));
        const ctx = new FunctionContext([]);
        const expr: IRIdent = {
            kind: "ir_ident", sourceId: "id-1",
            resolvedType: { kind: "basic", name: "Int" },
            name: "MAX", scope: "global",
        };
        const ref = compileIRIdent(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.i32, [], ref);
        const wat = mod.emitText();
        expect(wat).toContain("global.get $MAX");
    });

    it("should produce error for unknown local ident", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([]);
        const expr: IRIdent = {
            kind: "ir_ident", sourceId: "id-1",
            resolvedType: { kind: "basic", name: "Int" },
            name: "missing", scope: "local",
        };
        compileIRIdent(expr, cc, ctx);
        expect(cc.errors.length).toBe(1);
        expect(cc.errors[0]!.error).toBe("wasm_validation_error");
    });
});


// =============================================================================
// Binop compilation
// =============================================================================

describe("compileIRBinop", () => {
    it("should compile i32 addition", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([]);
        const expr: IRBinop = {
            kind: "ir_binop", sourceId: "bin-1",
            resolvedType: { kind: "basic", name: "Int" },
            resolvedOperandType: { kind: "basic", name: "Int" },
            op: "+",
            left: { kind: "ir_literal", sourceId: "l-1", resolvedType: { kind: "basic", name: "Int" }, value: 10 },
            right: { kind: "ir_literal", sourceId: "l-2", resolvedType: { kind: "basic", name: "Int" }, value: 20 },
        };
        const ref = compileIRBinop(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.i32, [], ref);
        const wat = mod.emitText();
        expect(wat).toContain("i32.add");
    });

    it("should compile f64 addition for Float operands", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([]);
        const expr: IRBinop = {
            kind: "ir_binop", sourceId: "bin-1",
            resolvedType: { kind: "basic", name: "Float" },
            resolvedOperandType: { kind: "basic", name: "Float" },
            op: "+",
            left: { kind: "ir_literal", sourceId: "l-1", resolvedType: { kind: "basic", name: "Float" }, value: 1.5 },
            right: { kind: "ir_literal", sourceId: "l-2", resolvedType: { kind: "basic", name: "Float" }, value: 2.5 },
        };
        const ref = compileIRBinop(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.f64, [], ref);
        const wat = mod.emitText();
        expect(wat).toContain("f64.add");
    });

    it("should compile comparison to i32 result", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([]);
        const expr: IRBinop = {
            kind: "ir_binop", sourceId: "bin-1",
            resolvedType: { kind: "basic", name: "Bool" },
            resolvedOperandType: { kind: "basic", name: "Int" },
            op: "<",
            left: { kind: "ir_literal", sourceId: "l-1", resolvedType: { kind: "basic", name: "Int" }, value: 1 },
            right: { kind: "ir_literal", sourceId: "l-2", resolvedType: { kind: "basic", name: "Int" }, value: 2 },
        };
        const ref = compileIRBinop(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.i32, [], ref);
        const wat = mod.emitText();
        expect(wat).toContain("i32.lt_s");
    });

    it("should compile string concat via resolvedOperandType (eliminates isStringExpr)", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        // Need to import string_concat for this to work
        mod.addFunctionImport("string_concat", "host", "string_concat",
            binaryen.createType([binaryen.i32, binaryen.i32]), binaryen.i32);
        const ctx = new FunctionContext([]);
        const expr: IRBinop = {
            kind: "ir_binop", sourceId: "bin-1",
            resolvedType: { kind: "basic", name: "String" },
            resolvedOperandType: { kind: "basic", name: "String" },
            op: "+",
            left: { kind: "ir_literal", sourceId: "l-1", resolvedType: { kind: "basic", name: "String" }, value: "hello" },
            right: { kind: "ir_literal", sourceId: "l-2", resolvedType: { kind: "basic", name: "String" }, value: " world" },
        };
        const ref = compileIRBinop(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.i32, [], ref);
        const wat = mod.emitText();
        expect(wat).toContain("call $string_concat");
    });

    it("should compile implies operator", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([]);
        const expr: IRBinop = {
            kind: "ir_binop", sourceId: "bin-1",
            resolvedType: { kind: "basic", name: "Bool" },
            resolvedOperandType: { kind: "basic", name: "Bool" },
            op: "implies",
            left: { kind: "ir_literal", sourceId: "l-1", resolvedType: { kind: "basic", name: "Bool" }, value: true },
            right: { kind: "ir_literal", sourceId: "l-2", resolvedType: { kind: "basic", name: "Bool" }, value: false },
        };
        const ref = compileIRBinop(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.i32, [], ref);
        const wat = mod.emitText();
        // implies = (not A) or B = i32.or(i32.eqz(A), B)
        expect(wat).toContain("i32.eqz");
        expect(wat).toContain("i32.or");
    });
});


// =============================================================================
// Unop compilation
// =============================================================================

describe("compileIRExpr — unop", () => {
    it("should compile i32 negation", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([]);
        const expr: IRExpr = {
            kind: "ir_unop", sourceId: "un-1",
            resolvedType: { kind: "basic", name: "Int" },
            op: "-",
            operand: { kind: "ir_literal", sourceId: "l-1", resolvedType: { kind: "basic", name: "Int" }, value: 7 },
        };
        const ref = compileIRExpr(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.i32, [], ref);
        const wat = mod.emitText();
        expect(wat).toContain("i32.sub");
    });

    it("should compile logical not", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([]);
        const expr: IRExpr = {
            kind: "ir_unop", sourceId: "un-1",
            resolvedType: { kind: "basic", name: "Bool" },
            op: "not",
            operand: { kind: "ir_literal", sourceId: "l-1", resolvedType: { kind: "basic", name: "Bool" }, value: true },
        };
        const ref = compileIRExpr(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.i32, [], ref);
        const wat = mod.emitText();
        expect(wat).toContain("i32.eqz");
    });
});


// =============================================================================
// If expression compilation
// =============================================================================

describe("compileIRExpr — if", () => {
    it("should compile if/else with correct branch types", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([]);
        const expr: IRExpr = {
            kind: "ir_if", sourceId: "if-1",
            resolvedType: { kind: "basic", name: "Int" },
            condition: { kind: "ir_literal", sourceId: "l-c", resolvedType: { kind: "basic", name: "Bool" }, value: true },
            then: [{ kind: "ir_literal", sourceId: "l-t", resolvedType: { kind: "basic", name: "Int" }, value: 1 }],
            else: [{ kind: "ir_literal", sourceId: "l-e", resolvedType: { kind: "basic", name: "Int" }, value: 0 }],
        };
        const ref = compileIRExpr(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.i32, [], ref);
        const wat = mod.emitText();
        expect(wat).toContain("if");
        expect(cc.errors).toHaveLength(0);
    });

    it("should compile if-without-else to Option heap allocation", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        // Register Option enum layout
        cc.enumLayouts.set("Option", {
            variants: [
                { name: "None", tag: 0, fields: [], totalSize: 8 },
                { name: "Some", tag: 1, fields: [{ name: "value", offset: 8, wasmType: binaryen.i32 }], totalSize: 16 },
            ],
        });
        const ctx = new FunctionContext([]);
        const expr: IRExpr = {
            kind: "ir_if", sourceId: "if-1",
            resolvedType: { kind: "option", inner: { kind: "basic", name: "Int" } },
            condition: { kind: "ir_literal", sourceId: "l-c", resolvedType: { kind: "basic", name: "Bool" }, value: true },
            then: [{ kind: "ir_literal", sourceId: "l-t", resolvedType: { kind: "basic", name: "Int" }, value: 42 }],
            else: [],
        };
        const ref = compileIRExpr(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.i32, ctx.varTypes, ref);
        const wat = mod.emitText();
        expect(wat).toContain("global.get $__heap_ptr");
        expect(cc.errors).toHaveLength(0);
    });
});


// =============================================================================
// Let binding compilation
// =============================================================================

describe("compileIRExpr — let", () => {
    it("should compile let binding with correct WASM type from boundType", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([]);
        const expr: IRExpr = {
            kind: "ir_let", sourceId: "let-1",
            resolvedType: { kind: "basic", name: "Int" },
            name: "x",
            boundType: { kind: "basic", name: "Int" },
            value: { kind: "ir_literal", sourceId: "l-1", resolvedType: { kind: "basic", name: "Int" }, value: 42 },
        };
        const ref = compileIRExpr(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.none, ctx.varTypes, ref);
        const wat = mod.emitText();
        expect(wat).toContain("local.set");
        // Verify the local was registered with correct type
        const local = ctx.getLocal("x");
        expect(local).toBeDefined();
        expect(local!.type).toBe(binaryen.i32);
    });

    it("should derive edictTypeName from boundType (eliminates heuristic)", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([]);
        // String type
        const expr: IRExpr = {
            kind: "ir_let", sourceId: "let-1",
            resolvedType: { kind: "basic", name: "String" },
            name: "s",
            boundType: { kind: "basic", name: "String" },
            value: { kind: "ir_literal", sourceId: "l-1", resolvedType: { kind: "basic", name: "String" }, value: "hello" },
        };
        compileIRExpr(expr, cc, ctx);
        const local = ctx.getLocal("s");
        expect(local?.edictTypeName).toBe("String");
    });

    it("should derive edictTypeName for named types", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([]);
        const expr: IRExpr = {
            kind: "ir_let", sourceId: "let-1",
            resolvedType: { kind: "named", name: "Point" },
            name: "p",
            boundType: { kind: "named", name: "Point" },
            value: { kind: "ir_literal", sourceId: "l-1", resolvedType: { kind: "named", name: "Point" }, value: 0 },
        };
        compileIRExpr(expr, cc, ctx);
        expect(ctx.getLocal("p")?.edictTypeName).toBe("Point");
    });

    it("should derive edictTypeName for Option types", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([]);
        const expr: IRExpr = {
            kind: "ir_let", sourceId: "let-1",
            resolvedType: { kind: "option", inner: { kind: "basic", name: "Int" } },
            name: "opt",
            boundType: { kind: "option", inner: { kind: "basic", name: "Int" } },
            value: { kind: "ir_literal", sourceId: "l-1", resolvedType: { kind: "option", inner: { kind: "basic", name: "Int" } }, value: 0 },
        };
        compileIRExpr(expr, cc, ctx);
        expect(ctx.getLocal("opt")?.edictTypeName).toBe("Option");
    });

    it("should derive edictTypeName for tuple types", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([]);
        const tupleType = { kind: "tuple" as const, elements: [{ kind: "basic" as const, name: "Int" as const }, { kind: "basic" as const, name: "String" as const }] };
        const expr: IRExpr = {
            kind: "ir_let", sourceId: "let-1",
            resolvedType: tupleType,
            name: "t",
            boundType: tupleType,
            value: { kind: "ir_literal", sourceId: "l-1", resolvedType: tupleType, value: 0 },
        };
        compileIRExpr(expr, cc, ctx);
        const local = ctx.getLocal("t");
        expect(local?.edictTypeName).toBe("__tuple");
        expect(local?.edictType).toEqual(tupleType);
    });
});


// =============================================================================
// Block compilation
// =============================================================================

describe("compileIRExpr — block", () => {
    it("should compile empty block to nop", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([]);
        const expr: IRExpr = {
            kind: "ir_block", sourceId: "blk-1",
            resolvedType: { kind: "basic", name: "Int" },
            body: [],
        };
        const ref = compileIRExpr(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.none, [], ref);
        const wat = mod.emitText();
        expect(wat).toContain("nop");
    });

    it("should compile single-expr block", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([]);
        const expr: IRExpr = {
            kind: "ir_block", sourceId: "blk-1",
            resolvedType: { kind: "basic", name: "Int" },
            body: [
                { kind: "ir_literal", sourceId: "l-1", resolvedType: { kind: "basic", name: "Int" }, value: 99 },
            ],
        };
        const ref = compileIRExpr(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.i32, [], ref);
        const wat = mod.emitText();
        expect(wat).toContain("i32.const 99");
    });

    it("should compile block with let followed by read-back", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([]);
        const expr: IRExpr = {
            kind: "ir_block", sourceId: "blk-1",
            resolvedType: { kind: "basic", name: "Int" },
            body: [
                {
                    kind: "ir_let", sourceId: "let-1",
                    resolvedType: { kind: "basic", name: "Int" },
                    name: "x",
                    boundType: { kind: "basic", name: "Int" },
                    value: { kind: "ir_literal", sourceId: "l-1", resolvedType: { kind: "basic", name: "Int" }, value: 42 },
                },
                {
                    kind: "ir_ident", sourceId: "id-1",
                    resolvedType: { kind: "basic", name: "Int" },
                    name: "x", scope: "local",
                },
            ],
        };
        const ref = compileIRExpr(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.i32, ctx.varTypes, ref);
        const wat = mod.emitText();
        expect(wat).toContain("local.set");
        expect(wat).toContain("local.get");
    });
});


// =============================================================================
// Call compilation
// =============================================================================

describe("compileIRCall", () => {
    it("should compile direct call with __env prepended", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        // Register a user function sig and table index
        cc.fnSigs.set("add", { returnType: binaryen.i32, paramTypes: [binaryen.i32, binaryen.i32, binaryen.i32] });
        cc.fnTableIndices.set("add", 0);
        cc.tableFunctions.push("add");
        // Add dummy function so mod.call works
        mod.addFunction("add",
            binaryen.createType([binaryen.i32, binaryen.i32, binaryen.i32]),
            binaryen.i32, [],
            mod.i32.add(mod.local.get(1, binaryen.i32), mod.local.get(2, binaryen.i32)));

        const ctx = new FunctionContext([]);
        const expr: IRCall = {
            kind: "ir_call", sourceId: "call-1",
            resolvedType: { kind: "basic", name: "Int" },
            fn: { kind: "ir_ident", sourceId: "id-1", resolvedType: { kind: "basic", name: "Int" }, name: "add", scope: "function" },
            args: [
                { kind: "ir_literal", sourceId: "l-1", resolvedType: { kind: "basic", name: "Int" }, value: 10 },
                { kind: "ir_literal", sourceId: "l-2", resolvedType: { kind: "basic", name: "Int" }, value: 20 },
            ],
            callKind: "direct",
            stringParamIndices: [],
            argCoercions: {},
        };
        const ref = compileIRCall(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.i32, ctx.varTypes, ref);
        expect(cc.errors).toHaveLength(0);
        const wat = mod.emitText();
        expect(wat).toContain("call $add");
    });

    it("should compile builtin call without __env", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        cc.fnSigs.set("intToString", { returnType: binaryen.i32, paramTypes: [binaryen.i32] });
        mod.addFunctionImport("intToString", "host", "intToString",
            binaryen.createType([binaryen.i32]), binaryen.i32);

        const ctx = new FunctionContext([]);
        const expr: IRCall = {
            kind: "ir_call", sourceId: "call-1",
            resolvedType: { kind: "basic", name: "String" },
            fn: { kind: "ir_ident", sourceId: "id-1", resolvedType: { kind: "basic", name: "String" }, name: "intToString", scope: "function" },
            args: [{ kind: "ir_literal", sourceId: "l-1", resolvedType: { kind: "basic", name: "Int" }, value: 42 }],
            callKind: "builtin",
            stringParamIndices: [],
            argCoercions: {},
        };
        const ref = compileIRCall(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.i32, ctx.varTypes, ref);
        expect(cc.errors).toHaveLength(0);
        const wat = mod.emitText();
        expect(wat).toContain("call $intToString");
    });

    it("should apply argCoercions from IR (pre-resolved)", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        cc.fnSigs.set("println", { returnType: binaryen.i32, paramTypes: [binaryen.i32] });
        mod.addFunctionImport("println", "host", "println",
            binaryen.createType([binaryen.i32]), binaryen.i32);
        mod.addFunctionImport("intToString", "host", "intToString",
            binaryen.createType([binaryen.i32]), binaryen.i32);

        const ctx = new FunctionContext([]);
        const expr: IRCall = {
            kind: "ir_call", sourceId: "call-1",
            resolvedType: { kind: "basic", name: "Int" },
            fn: { kind: "ir_ident", sourceId: "id-1", resolvedType: { kind: "basic", name: "Int" }, name: "println", scope: "function" },
            args: [{ kind: "ir_literal", sourceId: "l-1", resolvedType: { kind: "basic", name: "Int" }, value: 42 }],
            callKind: "builtin",
            stringParamIndices: [],
            argCoercions: { 0: "intToString" },
        };
        const ref = compileIRCall(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.i32, ctx.varTypes, ref);
        expect(cc.errors).toHaveLength(0);
        const wat = mod.emitText();
        expect(wat).toContain("call $intToString");
        expect(wat).toContain("call $println");
    });

    it("should produce error for non-ident fn in direct call", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([]);
        const expr: IRCall = {
            kind: "ir_call", sourceId: "call-1",
            resolvedType: { kind: "basic", name: "Int" },
            fn: { kind: "ir_literal", sourceId: "l-1", resolvedType: { kind: "basic", name: "Int" }, value: 0 },
            args: [],
            callKind: "direct",
            stringParamIndices: [],
            argCoercions: {},
        };
        compileIRCall(expr, cc, ctx);
        expect(cc.errors.length).toBeGreaterThan(0);
        expect(cc.errors[0]!.error).toBe("wasm_validation_error");
    });
});


// =============================================================================
// Record compilation
// =============================================================================

describe("compileIRRecord", () => {
    it("should compile record with field stores at correct offsets", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        cc.recordLayouts.set("Point", {
            fields: [
                { name: "x", offset: 0, wasmType: binaryen.i32 },
                { name: "y", offset: 4, wasmType: binaryen.i32 },
            ],
            totalSize: 8,
        });
        const ctx = new FunctionContext([]);
        const expr: IRRecordExpr = {
            kind: "ir_record", sourceId: "rec-1",
            resolvedType: { kind: "named", name: "Point" },
            name: "Point",
            fields: [
                { name: "x", value: { kind: "ir_literal", sourceId: "l-1", resolvedType: { kind: "basic", name: "Int" }, value: 10 }, resolvedType: { kind: "basic", name: "Int" } },
                { name: "y", value: { kind: "ir_literal", sourceId: "l-2", resolvedType: { kind: "basic", name: "Int" }, value: 20 }, resolvedType: { kind: "basic", name: "Int" } },
            ],
        };
        const ref = compileIRRecord(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.i32, ctx.varTypes, ref);
        expect(cc.errors).toHaveLength(0);
        const wat = mod.emitText();
        expect(wat).toContain("i32.store");
        expect(wat).toContain("global.get $__heap_ptr");
    });

    it("should produce error for unknown record type", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([]);
        const expr: IRRecordExpr = {
            kind: "ir_record", sourceId: "rec-1",
            resolvedType: { kind: "named", name: "Unknown" },
            name: "Unknown",
            fields: [],
        };
        compileIRRecord(expr, cc, ctx);
        expect(cc.errors.length).toBeGreaterThan(0);
    });
});


// =============================================================================
// Enum constructor compilation
// =============================================================================

describe("compileIREnumConstructor", () => {
    it("should compile enum variant with tag and field stores", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        cc.enumLayouts.set("Color", {
            variants: [
                { name: "Red", tag: 0, fields: [], totalSize: 8 },
                { name: "Rgb", tag: 1, fields: [
                    { name: "r", offset: 8, wasmType: binaryen.i32 },
                    { name: "g", offset: 12, wasmType: binaryen.i32 },
                    { name: "b", offset: 16, wasmType: binaryen.i32 },
                ], totalSize: 24 },
            ],
        });
        const ctx = new FunctionContext([]);
        const expr: IREnumConstructor = {
            kind: "ir_enum_constructor", sourceId: "enum-1",
            resolvedType: { kind: "named", name: "Color" },
            enumName: "Color",
            variant: "Rgb",
            tag: 1,
            fields: [
                { name: "r", value: { kind: "ir_literal", sourceId: "l-1", resolvedType: { kind: "basic", name: "Int" }, value: 255 }, resolvedType: { kind: "basic", name: "Int" } },
                { name: "g", value: { kind: "ir_literal", sourceId: "l-2", resolvedType: { kind: "basic", name: "Int" }, value: 128 }, resolvedType: { kind: "basic", name: "Int" } },
                { name: "b", value: { kind: "ir_literal", sourceId: "l-3", resolvedType: { kind: "basic", name: "Int" }, value: 0 }, resolvedType: { kind: "basic", name: "Int" } },
            ],
        };
        const ref = compileIREnumConstructor(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.i32, ctx.varTypes, ref);
        expect(cc.errors).toHaveLength(0);
        const wat = mod.emitText();
        expect(wat).toContain("i32.store"); // tag and field stores
        expect(wat).toContain("global.get $__heap_ptr");
    });

    it("should produce error for unknown enum layout", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([]);
        const expr: IREnumConstructor = {
            kind: "ir_enum_constructor", sourceId: "enum-1",
            resolvedType: { kind: "named", name: "Missing" },
            enumName: "Missing",
            variant: "A",
            tag: 0,
            fields: [],
        };
        compileIREnumConstructor(expr, cc, ctx);
        expect(cc.errors.length).toBeGreaterThan(0);
    });
});


// =============================================================================
// Access compilation
// =============================================================================

describe("compileIRAccess", () => {
    it("should compile record field access using pre-resolved targetTypeName", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        cc.recordLayouts.set("Point", {
            fields: [
                { name: "x", offset: 0, wasmType: binaryen.i32 },
                { name: "y", offset: 4, wasmType: binaryen.i32 },
            ],
            totalSize: 8,
        });
        const ctx = new FunctionContext([{ name: "p", wasmType: binaryen.i32, edictTypeName: "Point" }]);
        const expr: IRAccess = {
            kind: "ir_access", sourceId: "acc-1",
            resolvedType: { kind: "basic", name: "Int" },
            target: { kind: "ir_ident", sourceId: "id-1", resolvedType: { kind: "named", name: "Point" }, name: "p", scope: "local" },
            field: "x",
            targetTypeName: "Point",
        };
        const ref = compileIRAccess(expr, cc, ctx);
        mod.addFunction("test", binaryen.createType([binaryen.i32]), binaryen.i32, ctx.varTypes, ref);
        expect(cc.errors).toHaveLength(0);
        const wat = mod.emitText();
        expect(wat).toContain("i32.load");
    });

    it("should compile tuple access using __tuple targetTypeName", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const tupleType = { kind: "tuple" as const, elements: [{ kind: "basic" as const, name: "Int" as const }, { kind: "basic" as const, name: "Float" as const }] };
        const ctx = new FunctionContext([{ name: "t", wasmType: binaryen.i32, edictTypeName: "__tuple" }]);
        const expr: IRAccess = {
            kind: "ir_access", sourceId: "acc-1",
            resolvedType: { kind: "basic", name: "Float" },
            target: { kind: "ir_ident", sourceId: "id-1", resolvedType: tupleType, name: "t", scope: "local" },
            field: "1",
            targetTypeName: "__tuple",
        };
        const ref = compileIRAccess(expr, cc, ctx);
        mod.addFunction("test", binaryen.createType([binaryen.i32]), binaryen.f64, ctx.varTypes, ref);
        expect(cc.errors).toHaveLength(0);
        const wat = mod.emitText();
        expect(wat).toContain("f64.load");
    });
});


// =============================================================================
// Tuple compilation
// =============================================================================

describe("compileIRTuple", () => {
    it("should compile tuple with uniform 8-byte slots", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([]);
        const expr: IRTuple = {
            kind: "ir_tuple", sourceId: "tup-1",
            resolvedType: { kind: "tuple", elements: [{ kind: "basic", name: "Int" }, { kind: "basic", name: "Int" }] },
            elements: [
                { kind: "ir_literal", sourceId: "l-1", resolvedType: { kind: "basic", name: "Int" }, value: 1 },
                { kind: "ir_literal", sourceId: "l-2", resolvedType: { kind: "basic", name: "Int" }, value: 2 },
            ],
        };
        const ref = compileIRTuple(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.i32, ctx.varTypes, ref);
        expect(cc.errors).toHaveLength(0);
        const wat = mod.emitText();
        expect(wat).toContain("i32.store");
        expect(wat).toContain("global.get $__heap_ptr");
    });
});


// =============================================================================
// Array compilation
// =============================================================================

describe("compileIRArray", () => {
    it("should compile array with length header + element stores", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([]);
        const expr: IRArray = {
            kind: "ir_array", sourceId: "arr-1",
            resolvedType: { kind: "array", element: { kind: "basic", name: "Int" } },
            elements: [
                { kind: "ir_literal", sourceId: "l-1", resolvedType: { kind: "basic", name: "Int" }, value: 10 },
                { kind: "ir_literal", sourceId: "l-2", resolvedType: { kind: "basic", name: "Int" }, value: 20 },
                { kind: "ir_literal", sourceId: "l-3", resolvedType: { kind: "basic", name: "Int" }, value: 30 },
            ],
        };
        const ref = compileIRArray(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.i32, ctx.varTypes, ref);
        expect(cc.errors).toHaveLength(0);
        const wat = mod.emitText();
        // Verify length store and element stores
        expect(wat).toContain("i32.store");
        expect(wat).toContain("global.get $__heap_ptr");
    });
});


// =============================================================================
// Match compilation
// =============================================================================

describe("compileIRMatch", () => {
    it("should compile match with literal patterns", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([]);
        const expr: IRMatch = {
            kind: "ir_match", sourceId: "match-1",
            resolvedType: { kind: "basic", name: "Int" },
            target: { kind: "ir_literal", sourceId: "l-1", resolvedType: { kind: "basic", name: "Int" }, value: 42 },
            targetTypeName: undefined,
            arms: [
                {
                    sourceId: "arm-1",
                    pattern: { kind: "literal_pattern", value: 1 },
                    body: [{ kind: "ir_literal", sourceId: "l-2", resolvedType: { kind: "basic", name: "Int" }, value: 100 }],
                },
                {
                    sourceId: "arm-2",
                    pattern: { kind: "wildcard" },
                    body: [{ kind: "ir_literal", sourceId: "l-3", resolvedType: { kind: "basic", name: "Int" }, value: 0 }],
                },
            ],
        };
        const ref = compileIRMatch(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.i32, ctx.varTypes, ref);
        expect(cc.errors).toHaveLength(0);
        const wat = mod.emitText();
        expect(wat).toContain("if");
        expect(wat).toContain("i32.eq");
    });

    it("should compile match with constructor patterns using targetTypeName", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        cc.enumLayouts.set("Option", {
            variants: [
                { name: "None", tag: 0, fields: [], totalSize: 8 },
                { name: "Some", tag: 1, fields: [{ name: "value", offset: 8, wasmType: binaryen.i32 }], totalSize: 16 },
            ],
        });
        const ctx = new FunctionContext([]);
        const expr: IRMatch = {
            kind: "ir_match", sourceId: "match-1",
            resolvedType: { kind: "basic", name: "Int" },
            target: { kind: "ir_literal", sourceId: "l-1", resolvedType: { kind: "named", name: "Option" }, value: 0 },
            targetTypeName: "Option",
            arms: [
                {
                    sourceId: "arm-1",
                    pattern: { kind: "constructor", name: "Some", fields: [{ kind: "binding", name: "v" }] },
                    body: [{ kind: "ir_literal", sourceId: "l-2", resolvedType: { kind: "basic", name: "Int" }, value: 1 }],
                },
                {
                    sourceId: "arm-2",
                    pattern: { kind: "constructor", name: "None", fields: [] },
                    body: [{ kind: "ir_literal", sourceId: "l-3", resolvedType: { kind: "basic", name: "Int" }, value: 0 }],
                },
            ],
        };
        const ref = compileIRMatch(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.i32, ctx.varTypes, ref);
        expect(cc.errors).toHaveLength(0);
        const wat = mod.emitText();
        expect(wat).toContain("i32.load"); // tag load
        expect(wat).toContain("if");
    });

    it("should compile match with binding pattern", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([]);
        const expr: IRMatch = {
            kind: "ir_match", sourceId: "match-1",
            resolvedType: { kind: "basic", name: "Int" },
            target: { kind: "ir_literal", sourceId: "l-1", resolvedType: { kind: "basic", name: "Int" }, value: 42 },
            targetTypeName: undefined,
            arms: [
                {
                    sourceId: "arm-1",
                    pattern: { kind: "binding", name: "x" },
                    body: [{ kind: "ir_ident", sourceId: "id-1", resolvedType: { kind: "basic", name: "Int" }, name: "x", scope: "local" }],
                },
            ],
        };
        const ref = compileIRMatch(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.i32, ctx.varTypes, ref);
        expect(cc.errors).toHaveLength(0);
        const wat = mod.emitText();
        expect(wat).toContain("local.set"); // binding store
        expect(wat).toContain("local.get"); // binding use
    });
});


// =============================================================================
// String interpolation compilation
// =============================================================================

describe("compileIRStringInterp", () => {
    it("should compile string interp with coercion builtin", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        mod.addFunctionImport("intToString", "host", "intToString",
            binaryen.createType([binaryen.i32]), binaryen.i32);
        mod.addFunctionImport("string_concat", "host", "string_concat",
            binaryen.createType([binaryen.i32, binaryen.i32]), binaryen.i32);

        const ctx = new FunctionContext([]);
        const expr: IRStringInterp = {
            kind: "ir_string_interp", sourceId: "interp-1",
            resolvedType: { kind: "basic", name: "String" },
            parts: [
                {
                    expr: { kind: "ir_literal", sourceId: "l-1", resolvedType: { kind: "basic", name: "String" }, value: "value: " },
                    coercionBuiltin: undefined,
                },
                {
                    expr: { kind: "ir_literal", sourceId: "l-2", resolvedType: { kind: "basic", name: "Int" }, value: 42 },
                    coercionBuiltin: "intToString",
                },
            ],
        };
        const ref = compileIRStringInterp(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.i32, ctx.varTypes, ref);
        expect(cc.errors).toHaveLength(0);
        const wat = mod.emitText();
        expect(wat).toContain("call $intToString");
        expect(wat).toContain("call $string_concat");
    });

    it("should compile single-part string interp without concat", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([]);
        const expr: IRStringInterp = {
            kind: "ir_string_interp", sourceId: "interp-1",
            resolvedType: { kind: "basic", name: "String" },
            parts: [
                {
                    expr: { kind: "ir_literal", sourceId: "l-1", resolvedType: { kind: "basic", name: "String" }, value: "hello" },
                    coercionBuiltin: undefined,
                },
            ],
        };
        const ref = compileIRStringInterp(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.i32, ctx.varTypes, ref);
        expect(cc.errors).toHaveLength(0);
        const wat = mod.emitText();
        expect(wat).toContain("i32.const");
        expect(wat).not.toContain("string_concat");
    });

    it("should compile empty string interp to empty string", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([]);
        const expr: IRStringInterp = {
            kind: "ir_string_interp", sourceId: "interp-1",
            resolvedType: { kind: "basic", name: "String" },
            parts: [],
        };
        const ref = compileIRStringInterp(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.i32, ctx.varTypes, ref);
        expect(cc.errors).toHaveLength(0);
    });
});


// =============================================================================
// Lambda ref compilation
// =============================================================================

describe("compileIRLambdaRef", () => {
    it("should produce error if lifted function not in table", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([]);
        const expr: IRLambdaRef = {
            kind: "ir_lambda_ref", sourceId: "lam-1",
            resolvedType: { kind: "fn_type", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" } },
            liftedName: "__lambda_0",
            captures: [],
        };
        compileIRLambdaRef(expr, cc, ctx);
        expect(cc.errors.length).toBeGreaterThan(0);
        expect(cc.errors[0]!.error).toBe("wasm_validation_error");
    });

    it("should compile lambda ref with no captures to closure pair", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        cc.fnTableIndices.set("__lambda_0", 0);
        const ctx = new FunctionContext([]);
        const expr: IRLambdaRef = {
            kind: "ir_lambda_ref", sourceId: "lam-1",
            resolvedType: { kind: "fn_type", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" } },
            liftedName: "__lambda_0",
            captures: [],
        };
        const ref = compileIRLambdaRef(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.i32, ctx.varTypes, ref);
        expect(cc.errors).toHaveLength(0);
        const wat = mod.emitText();
        // Closure pair stores table index and env pointer
        expect(wat).toContain("i32.store");
        expect(wat).toContain("global.get $__heap_ptr");
    });

    it("should compile lambda ref with captures (env allocation)", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        cc.fnTableIndices.set("__lambda_0", 0);
        const ctx = new FunctionContext([{ name: "x", wasmType: binaryen.i32 }]);
        const expr: IRLambdaRef = {
            kind: "ir_lambda_ref", sourceId: "lam-1",
            resolvedType: { kind: "fn_type", params: [], effects: ["pure"], returnType: { kind: "basic", name: "Int" } },
            liftedName: "__lambda_0",
            captures: [{ name: "x", resolvedType: { kind: "basic", name: "Int" } }],
        };
        const ref = compileIRLambdaRef(expr, cc, ctx);
        mod.addFunction("test", binaryen.createType([binaryen.i32]), binaryen.i32, ctx.varTypes, ref);
        expect(cc.errors).toHaveLength(0);
        const wat = mod.emitText();
        expect(wat).toContain("i32.store"); // env field store + closure pair stores
        expect(wat).toContain("global.get $__heap_ptr");
    });
});


// =============================================================================
// compileIRExpr dispatcher — all kinds produce valid output
// =============================================================================

describe("compileIRExpr — all kinds dispatch", () => {
    it("should dispatch ir_record through compileIRExpr", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        cc.recordLayouts.set("P", { fields: [{ name: "x", offset: 0, wasmType: binaryen.i32 }], totalSize: 4 });
        const ctx = new FunctionContext([]);
        const expr: IRExpr = {
            kind: "ir_record", sourceId: "rec-1",
            resolvedType: { kind: "named", name: "P" },
            name: "P",
            fields: [{ name: "x", value: { kind: "ir_literal", sourceId: "l-1", resolvedType: { kind: "basic", name: "Int" }, value: 1 }, resolvedType: { kind: "basic", name: "Int" } }],
        };
        const ref = compileIRExpr(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.i32, ctx.varTypes, ref);
        expect(cc.errors).toHaveLength(0);
    });

    it("should dispatch ir_array through compileIRExpr", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([]);
        const expr: IRExpr = {
            kind: "ir_array", sourceId: "arr-1",
            resolvedType: { kind: "array", element: { kind: "basic", name: "Int" } },
            elements: [{ kind: "ir_literal", sourceId: "l-1", resolvedType: { kind: "basic", name: "Int" }, value: 1 }],
        };
        const ref = compileIRExpr(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.i32, ctx.varTypes, ref);
        expect(cc.errors).toHaveLength(0);
    });

    it("should dispatch ir_tuple through compileIRExpr", () => {
        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([]);
        const expr: IRExpr = {
            kind: "ir_tuple", sourceId: "tup-1",
            resolvedType: { kind: "tuple", elements: [{ kind: "basic", name: "Int" }] },
            elements: [{ kind: "ir_literal", sourceId: "l-1", resolvedType: { kind: "basic", name: "Int" }, value: 1 }],
        };
        const ref = compileIRExpr(expr, cc, ctx);
        mod.addFunction("test", binaryen.none, binaryen.i32, ctx.varTypes, ref);
        expect(cc.errors).toHaveLength(0);
    });
});


// =============================================================================
// Integration — full pipeline lowering + IR compilation
// =============================================================================

describe("IR codegen — pipeline integration", () => {
    it("should compile IR from a full pipeline (literal)", () => {
        const { ir } = lowerFromAst(moduleWith({
            kind: "fn", id: "fn-main", name: "main", params: [],
            returnType: { kind: "basic", name: "Int" }, effects: ["pure"], contracts: [],
            body: [{ kind: "literal", id: "lit-1", value: 42 }],
        }));
        const fn = getIRFn(ir, "main");
        const irExpr = lastExpr(fn);
        
        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([{ name: "__env", wasmType: binaryen.i32 }]);
        
        const ref = compileIRExpr(irExpr, cc, ctx);
        mod.addFunction("test", binaryen.createType([binaryen.i32]), binaryen.i32, ctx.varTypes, ref);
        expect(cc.errors).toHaveLength(0);
        const wat = mod.emitText();
        expect(wat).toContain("42");
    });

    it("should compile IR from a full pipeline (binop with resolved types)", () => {
        const { ir } = lowerFromAst(moduleWith({
            kind: "fn", id: "fn-main", name: "main", params: [
                { kind: "param", id: "p-x", name: "x", type: { kind: "basic", name: "Int" } },
            ],
            returnType: { kind: "basic", name: "Int" }, effects: ["pure"], contracts: [],
            body: [{
                kind: "binop", id: "bin-1", op: "+",
                left: { kind: "ident", id: "id-x", name: "x" },
                right: { kind: "literal", id: "lit-2", value: 2 },
            }],
        }));
        const fn = getIRFn(ir, "main");
        const irExpr = lastExpr(fn);

        expect(irExpr.kind).toBe("ir_binop");
        if (irExpr.kind === "ir_binop") {
            expect(irExpr.resolvedOperandType).toEqual({ kind: "basic", name: "Int" });
        }

        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([
            { name: "__env", wasmType: binaryen.i32 },
            { name: "x", wasmType: binaryen.i32 },
        ]);

        const ref = compileIRExpr(irExpr, cc, ctx);
        mod.addFunction("test",
            binaryen.createType([binaryen.i32, binaryen.i32]),
            binaryen.i32, ctx.varTypes, ref);
        expect(cc.errors).toHaveLength(0);
        const wat = mod.emitText();
        expect(wat).toContain("i32.add");
    });

    it("should compile IR from a full pipeline (let + ident)", () => {
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

        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([{ name: "__env", wasmType: binaryen.i32 }]);

        // Compile all body expressions
        const refs = fn.body.map(e => compileIRExpr(e, cc, ctx));
        expect(cc.errors).toHaveLength(0);
        expect(refs.length).toBe(2);
    });

    it("should compile IR from a full pipeline (Float binop uses f64)", () => {
        const { ir } = lowerFromAst(moduleWith({
            kind: "fn", id: "fn-main", name: "main", params: [],
            returnType: { kind: "basic", name: "Float" }, effects: ["pure"], contracts: [],
            body: [{
                kind: "binop", id: "bin-1", op: "+",
                left: { kind: "literal", id: "lit-a", value: 1.5, type: { kind: "basic", name: "Float" } },
                right: { kind: "literal", id: "lit-b", value: 2.5, type: { kind: "basic", name: "Float" } },
            }],
        }));
        const fn = getIRFn(ir, "main");
        const irExpr = lastExpr(fn);

        expect(irExpr.kind).toBe("ir_binop");
        if (irExpr.kind === "ir_binop") {
            expect(irExpr.resolvedOperandType).toEqual({ kind: "basic", name: "Float" });
        }

        const mod = createMod();
        const cc = makeCC(mod);
        const ctx = new FunctionContext([{ name: "__env", wasmType: binaryen.i32 }]);

        const ref = compileIRExpr(irExpr, cc, ctx);
        mod.addFunction("test", binaryen.createType([binaryen.i32]), binaryen.f64, ctx.varTypes, ref);
        expect(cc.errors).toHaveLength(0);
        const wat = mod.emitText();
        expect(wat).toContain("f64.add");
    });
});
