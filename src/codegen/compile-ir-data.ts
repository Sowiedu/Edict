// =============================================================================
// IR Data structure expression compilers — record, tuple, enum, access, array,
// string interpolation
// =============================================================================
// The IR counterpart to compile-data.ts. Key differences:
//
// - compileIRAccess: uses expr.targetTypeName (pre-resolved from IR) instead
//   of the 20-line edictTypeName probe chain.
//
// - compileIRTuple: uses irExprWasmType instead of inferExprWasmType for
//   element store dispatch.
//
// - compileIRStringInterp: reads coercionBuiltin from IRStringInterpPart
//   instead of looking up stringInterpCoercions Map at runtime.

import * as binaryen from "./wasm-encoder.js";
import type {
    IRRecordExpr,
    IRTuple,
    IREnumConstructor,
    IRAccess,
    IRArray,
    IRStringInterp,
} from "../ir/types.js";
import { wasmValidationError } from "../errors/structured-errors.js";
import {
    type CompilationContext,
    FunctionContext,
    edictTypeToWasm,
} from "./types.js";
import { compileIRExpr, irExprWasmType } from "./compile-ir-expr.js";


// =============================================================================
// Record construction
// =============================================================================

export function compileIRRecord(
    expr: IRRecordExpr,
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, errors } = cc;
    const layout = cc.recordLayouts.get(expr.name);
    if (!layout) {
        errors.push(wasmValidationError(`unknown record type: ${expr.name}`));
        return mod.unreachable();
    }

    // Allocate heap space: ptr = __heap_ptr; __heap_ptr += totalSize
    const ptrIndex = ctx.addLocal(`__record_ptr_${expr.sourceId}`, binaryen.i32);

    const setPtr = mod.local.set(ptrIndex, mod.global.get("__heap_ptr", binaryen.i32));
    const incrementHeap = mod.global.set(
        "__heap_ptr",
        mod.i32.add(
            mod.local.get(ptrIndex, binaryen.i32),
            mod.i32.const(layout.totalSize),
        ),
    );

    // Store each field at its layout offset
    const stores: binaryen.ExpressionRef[] = [];
    for (const fieldInit of expr.fields) {
        const fieldLayout = layout.fields.find(f => f.name === fieldInit.name);
        if (!fieldLayout) {
            errors.push(wasmValidationError(`unknown field '${fieldInit.name}' on record '${expr.name}'`));
            continue;
        }

        const valueExpr = compileIRExpr(fieldInit.value, cc, ctx);
        if (fieldLayout.wasmType === binaryen.f64) {
            stores.push(mod.f64.store(fieldLayout.offset, 0,
                mod.local.get(ptrIndex, binaryen.i32), valueExpr));
        } else {
            stores.push(mod.i32.store(fieldLayout.offset, 0,
                mod.local.get(ptrIndex, binaryen.i32), valueExpr));
        }
    }

    return mod.block(null, [
        setPtr, incrementHeap, ...stores,
        mod.local.get(ptrIndex, binaryen.i32),
    ], binaryen.i32);
}


// =============================================================================
// Tuple construction
// =============================================================================

export function compileIRTuple(
    expr: IRTuple,
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod } = cc;
    const totalSize = expr.elements.length * 8; // uniform 8-byte slots

    const ptrIndex = ctx.addLocal(`__tuple_ptr_${expr.sourceId}`, binaryen.i32);

    const setPtr = mod.local.set(ptrIndex, mod.global.get("__heap_ptr", binaryen.i32));
    const incrementHeap = mod.global.set(
        "__heap_ptr",
        mod.i32.add(
            mod.local.get(ptrIndex, binaryen.i32),
            mod.i32.const(totalSize),
        ),
    );

    const stores: binaryen.ExpressionRef[] = [];
    for (let i = 0; i < expr.elements.length; i++) {
        const el = expr.elements[i]!;
        const offset = i * 8;
        const ptrExpr = mod.local.get(ptrIndex, binaryen.i32);
        const valWasm = compileIRExpr(el, cc, ctx);
        // Use irExprWasmType instead of inferExprWasmType
        const valType = irExprWasmType(el);
        if (valType === binaryen.f64) {
            stores.push(mod.f64.store(offset, 0, ptrExpr, valWasm));
        } else {
            stores.push(mod.i32.store(offset, 0, ptrExpr, valWasm));
        }
    }

    return mod.block(null, [
        setPtr, incrementHeap, ...stores,
        mod.local.get(ptrIndex, binaryen.i32),
    ], binaryen.i32);
}


// =============================================================================
// Enum variant construction
// =============================================================================

export function compileIREnumConstructor(
    expr: IREnumConstructor,
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, errors } = cc;
    const enumLayout = cc.enumLayouts.get(expr.enumName);
    if (!enumLayout) {
        errors.push(wasmValidationError(`Enum layout not found for ${expr.enumName}`));
        return mod.unreachable();
    }

    const variantLayout = enumLayout.variants.find(v => v.name === expr.variant);
    if (!variantLayout) {
        errors.push(wasmValidationError(`Variant layout not found for ${expr.enumName}.${expr.variant}`));
        return mod.unreachable();
    }

    const ptrIndex = ctx.addLocal(`__enum_ptr_${expr.sourceId}`, binaryen.i32);

    const setPtr = mod.local.set(ptrIndex, mod.global.get("__heap_ptr", binaryen.i32));
    const incrementHeap = mod.global.set(
        "__heap_ptr",
        mod.i32.add(
            mod.local.get(ptrIndex, binaryen.i32),
            mod.i32.const(variantLayout.totalSize),
        ),
    );

    const stores: binaryen.ExpressionRef[] = [];

    // Store tag at offset 0
    stores.push(mod.i32.store(0, 0,
        mod.local.get(ptrIndex, binaryen.i32),
        mod.i32.const(variantLayout.tag)));

    // Store fields
    for (const fieldInit of expr.fields) {
        const fieldLayout = variantLayout.fields.find(f => f.name === fieldInit.name);
        if (!fieldLayout) continue;

        const valueExpr = compileIRExpr(fieldInit.value, cc, ctx);
        if (fieldLayout.wasmType === binaryen.f64) {
            stores.push(mod.f64.store(fieldLayout.offset, 0,
                mod.local.get(ptrIndex, binaryen.i32), valueExpr));
        } else {
            stores.push(mod.i32.store(fieldLayout.offset, 0,
                mod.local.get(ptrIndex, binaryen.i32), valueExpr));
        }
    }

    return mod.block(null, [
        setPtr, incrementHeap, ...stores,
        mod.local.get(ptrIndex, binaryen.i32),
    ], binaryen.i32);
}


// =============================================================================
// Field access — record and tuple
// =============================================================================

/**
 * Compile an IR field access expression.
 *
 * Uses expr.targetTypeName (pre-resolved from IR) instead of the 20-line
 * edictTypeName probe chain in the AST path. Dispatches tuple vs record access.
 */
export function compileIRAccess(
    expr: IRAccess,
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, errors } = cc;
    const targetTypeName = expr.targetTypeName;

    // Tuple access — targetTypeName is "__tuple", field is numeric index
    if (targetTypeName === "__tuple" && expr.resolvedType) {
        const index = parseInt(expr.field, 10);
        if (isNaN(index) || index < 0) {
            errors.push(wasmValidationError(`invalid tuple index: ${expr.field}`));
            return mod.unreachable();
        }

        const wasmType = edictTypeToWasm(expr.resolvedType);
        const offset = index * 8;
        const ptrExpr = compileIRExpr(expr.target, cc, ctx);

        if (wasmType === binaryen.f64) {
            return mod.f64.load(offset, 0, ptrExpr);
        } else {
            return mod.i32.load(offset, 0, ptrExpr);
        }
    }

    // Record access
    if (!targetTypeName || targetTypeName === "__tuple") {
        errors.push(wasmValidationError(`cannot resolve record type for field access '${expr.field}'`));
        return mod.unreachable();
    }

    const layout = cc.recordLayouts.get(targetTypeName);
    if (!layout) {
        errors.push(wasmValidationError(`unknown record type: ${targetTypeName}`));
        return mod.unreachable();
    }

    const fieldLayout = layout.fields.find(f => f.name === expr.field);
    if (!fieldLayout) {
        errors.push(wasmValidationError(`unknown field '${expr.field}' on record '${targetTypeName}'`));
        return mod.unreachable();
    }

    const ptrExpr = compileIRExpr(expr.target, cc, ctx);

    if (fieldLayout.wasmType === binaryen.f64) {
        return mod.f64.load(fieldLayout.offset, 0, ptrExpr);
    } else {
        return mod.i32.load(fieldLayout.offset, 0, ptrExpr);
    }
}


// =============================================================================
// Array construction
// =============================================================================

export function compileIRArray(
    expr: IRArray,
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod } = cc;
    const elements = expr.elements;
    // Layout: [length: i32] [elem0: i32] [elem1: i32] ...
    const headerSize = 4;
    const elemSize = 4;
    const totalSize = headerSize + elements.length * elemSize;

    const ptrIndex = ctx.addLocal(`__array_ptr_${expr.sourceId}`, binaryen.i32);

    const setPtr = mod.local.set(ptrIndex, mod.global.get("__heap_ptr", binaryen.i32));
    const incrementHeap = mod.global.set(
        "__heap_ptr",
        mod.i32.add(
            mod.local.get(ptrIndex, binaryen.i32),
            mod.i32.const(totalSize),
        ),
    );

    const storeLength = mod.i32.store(
        0, 0,
        mod.local.get(ptrIndex, binaryen.i32),
        mod.i32.const(elements.length),
    );

    const stores: binaryen.ExpressionRef[] = [];
    for (let i = 0; i < elements.length; i++) {
        const valueExpr = compileIRExpr(elements[i]!, cc, ctx);
        stores.push(
            mod.i32.store(
                headerSize + i * elemSize,
                0,
                mod.local.get(ptrIndex, binaryen.i32),
                valueExpr,
            ),
        );
    }

    return mod.block(null, [
        setPtr,
        incrementHeap,
        storeLength,
        ...stores,
        mod.local.get(ptrIndex, binaryen.i32),
    ], binaryen.i32);
}


// =============================================================================
// String interpolation
// =============================================================================

/**
 * Compile an IR string interpolation to a chain of string_concat calls.
 *
 * Uses IRStringInterpPart.coercionBuiltin (pre-resolved during lowering)
 * instead of looking up stringInterpCoercions Map at runtime.
 */
export function compileIRStringInterp(
    expr: IRStringInterp,
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, strings } = cc;
    const parts = expr.parts;

    // Edge case: no parts → empty string
    if (parts.length === 0) {
        const empty = strings.intern("");
        return mod.i32.const(empty.offset);
    }

    // Compile a single part, wrapping with coercion if needed
    const compilePart = (part: typeof parts[number]): binaryen.ExpressionRef => {
        const compiled = compileIRExpr(part.expr, cc, ctx);
        if (!part.coercionBuiltin) return compiled;
        return mod.call(part.coercionBuiltin, [compiled], binaryen.i32);
    };

    // Single part → no concat needed
    if (parts.length === 1) {
        return compilePart(parts[0]!);
    }

    // Left-fold: concat(concat(parts[0], parts[1]), parts[2]), ...)
    const stmts: binaryen.ExpressionRef[] = [];
    const accPtrIdx = ctx.addLocal(`__interp_ptr_${expr.sourceId}`, binaryen.i32);
    stmts.push(mod.local.set(accPtrIdx, compilePart(parts[0]!)));

    for (let i = 1; i < parts.length; i++) {
        const partExpr = compilePart(parts[i]!);
        const tmpPartPtrIdx = ctx.addLocal(`__interp_p${i}_ptr_${expr.sourceId}`, binaryen.i32);
        stmts.push(mod.local.set(tmpPartPtrIdx, partExpr));

        const concatResult = mod.call("string_concat", [
            mod.local.get(accPtrIdx, binaryen.i32),
            mod.local.get(tmpPartPtrIdx, binaryen.i32),
        ], binaryen.i32);

        stmts.push(mod.local.set(accPtrIdx, concatResult));
    }

    stmts.push(mod.local.get(accPtrIdx, binaryen.i32));
    return mod.block(null, stmts, binaryen.i32);
}
