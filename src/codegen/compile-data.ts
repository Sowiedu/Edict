// =============================================================================
// Data structure expression compilers — record, tuple, enum, access, array,
// string interpolation
// =============================================================================

import binaryen from "binaryen";
import type { Expression } from "../ast/nodes.js";
import { wasmValidationError } from "../errors/structured-errors.js";
import {
    type CompilationContext,
    FunctionContext,
} from "./types.js";
import { compileExpr, inferExprWasmType } from "./compile-expr.js";

export function compileRecordExpr(
    expr: Expression & { kind: "record_expr" },
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, errors } = cc;
    const layout = cc.recordLayouts.get(expr.name);
    if (!layout) {
        errors.push(wasmValidationError(`unknown record type: ${expr.name}`));
        return mod.unreachable();
    }

    // Allocate heap space
    // ptr = __heap_ptr
    // __heap_ptr = ptr + layout.totalSize
    const ptrIndex = ctx.addLocal(`__record_ptr_${expr.id}`, binaryen.i32);

    const setPtr = mod.local.set(ptrIndex, mod.global.get("__heap_ptr", binaryen.i32));
    const incrementHeap = mod.global.set(
        "__heap_ptr",
        mod.i32.add(
            mod.local.get(ptrIndex, binaryen.i32),
            mod.i32.const(layout.totalSize)
        )
    );

    // Evaluate and store each field
    const stores: binaryen.ExpressionRef[] = [];
    for (const fieldInit of expr.fields) {
        const fieldLayout = layout.fields.find((f) => f.name === fieldInit.name);
        if (!fieldLayout) {
            errors.push(wasmValidationError(`unknown field '${fieldInit.name}' on record '${expr.name}'`));
            continue;
        }

        const valueExpr = compileExpr(fieldInit.value, cc, ctx);

        if (fieldLayout.wasmType === binaryen.f64) {
            stores.push(
                mod.f64.store(
                    fieldLayout.offset,
                    0, // align
                    mod.local.get(ptrIndex, binaryen.i32),
                    valueExpr
                )
            );
        } else {
            stores.push(
                mod.i32.store(
                    fieldLayout.offset,
                    0, // align
                    mod.local.get(ptrIndex, binaryen.i32),
                    valueExpr
                )
            );
        }
    }

    // Return the pointer
    const returnPtr = mod.local.get(ptrIndex, binaryen.i32);

    return mod.block(null, [setPtr, incrementHeap, ...stores, returnPtr], binaryen.i32);
}

export function compileTupleExpr(
    expr: Expression & { kind: "tuple_expr" },
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod } = cc;
    const totalSize = expr.elements.length * 8;
    const ptrIndex = ctx.addLocal(`__tuple_ptr_${expr.id}`, binaryen.i32);

    const setPtr = mod.local.set(ptrIndex, mod.global.get("__heap_ptr", binaryen.i32));
    const incrementHeap = mod.global.set(
        "__heap_ptr",
        mod.i32.add(
            mod.local.get(ptrIndex, binaryen.i32),
            mod.i32.const(totalSize)
        )
    );

    const stores: binaryen.ExpressionRef[] = [];
    for (let i = 0; i < expr.elements.length; i++) {
        const elExpr = expr.elements[i]!;
        const valWasm = compileExpr(elExpr, cc, ctx);
        const valType = inferExprWasmType(elExpr, cc, ctx);
        const offset = i * 8;

        const ptrExpr = mod.local.get(ptrIndex, binaryen.i32);
        if (valType === binaryen.f64) {
            stores.push(mod.f64.store(offset, 0, ptrExpr, valWasm));
        } else {
            stores.push(mod.i32.store(offset, 0, ptrExpr, valWasm));
        }
    }

    const returnPtr = mod.local.get(ptrIndex, binaryen.i32);
    return mod.block(null, [setPtr, incrementHeap, ...stores, returnPtr], binaryen.i32);
}

export function compileEnumConstructor(
    expr: Expression & { kind: "enum_constructor" },
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

    const ptrIndex = ctx.addLocal(`__enum_ptr_${expr.id}`, binaryen.i32);

    const setPtr = mod.local.set(ptrIndex, mod.global.get("__heap_ptr", binaryen.i32));
    const incrementHeap = mod.global.set(
        "__heap_ptr",
        mod.i32.add(
            mod.local.get(ptrIndex, binaryen.i32),
            mod.i32.const(variantLayout.totalSize)
        )
    );

    const stores: binaryen.ExpressionRef[] = [];

    // Store tag
    const ptrExpr = mod.local.get(ptrIndex, binaryen.i32);
    stores.push(mod.i32.store(0, 0, ptrExpr, mod.i32.const(variantLayout.tag)));

    // Store fields
    for (const fieldInit of expr.fields) {
        const valWasm = compileExpr(fieldInit.value, cc, ctx);
        const fieldLayout = variantLayout.fields.find(f => f.name === fieldInit.name);
        if (!fieldLayout) continue; // Should be caught by type checker

        const ptrExprForField = mod.local.get(ptrIndex, binaryen.i32);
        if (fieldLayout.wasmType === binaryen.f64) {
            stores.push(mod.f64.store(fieldLayout.offset, 0, ptrExprForField, valWasm));
        } else {
            stores.push(mod.i32.store(fieldLayout.offset, 0, ptrExprForField, valWasm));
        }
    }

    const returnPtr = mod.local.get(ptrIndex, binaryen.i32);
    return mod.block(null, [setPtr, incrementHeap, ...stores, returnPtr], binaryen.i32);
}

export function compileAccess(
    expr: Expression & { kind: "access" },
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, errors } = cc;
    let recordTypeName: string | undefined;

    // Try to infer record type from target
    if (expr.target.kind === "ident") {
        const local = ctx.getLocal(expr.target.name);
        if (local && local.edictTypeName) {
            recordTypeName = local.edictTypeName;
        }
    } else if (expr.target.kind === "record_expr") {
        recordTypeName = expr.target.name;
    }

    if (!recordTypeName) {
        errors.push(wasmValidationError(`cannot resolve record type for field access '${expr.field}'`));
        return mod.unreachable();
    }

    const layout = cc.recordLayouts.get(recordTypeName);
    if (!layout) {
        errors.push(wasmValidationError(`unknown record type: ${recordTypeName}`));
        return mod.unreachable();
    }

    const fieldLayout = layout.fields.find((f) => f.name === expr.field);
    if (!fieldLayout) {
        errors.push(wasmValidationError(`unknown field '${expr.field}' on record '${recordTypeName}'`));
        return mod.unreachable();
    }

    const ptrExpr = compileExpr(expr.target, cc, ctx);

    if (fieldLayout.wasmType === binaryen.f64) {
        return mod.f64.load(fieldLayout.offset, 0, ptrExpr);
    } else {
        return mod.i32.load(fieldLayout.offset, 0, ptrExpr);
    }
}


// =============================================================================
// Array expression compilation
// =============================================================================

export function compileArrayExpr(
    expr: Expression & { kind: "array" },
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod } = cc;
    const elements = expr.elements;
    // Layout: [length: i32] [elem0: i32] [elem1: i32] ...
    const headerSize = 4; // i32 for length
    const elemSize = 4;   // i32 per element
    const totalSize = headerSize + elements.length * elemSize;

    const ptrIndex = ctx.addLocal(`__array_ptr_${expr.id}`, binaryen.i32);

    const setPtr = mod.local.set(ptrIndex, mod.global.get("__heap_ptr", binaryen.i32));
    const incrementHeap = mod.global.set(
        "__heap_ptr",
        mod.i32.add(
            mod.local.get(ptrIndex, binaryen.i32),
            mod.i32.const(totalSize),
        ),
    );

    // Store length at offset 0
    const storeLength = mod.i32.store(
        0, 0,
        mod.local.get(ptrIndex, binaryen.i32),
        mod.i32.const(elements.length),
    );

    // Store each element
    const stores: binaryen.ExpressionRef[] = [];
    for (let i = 0; i < elements.length; i++) {
        const valueExpr = compileExpr(elements[i]!, cc, ctx);
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
        mod.local.get(ptrIndex, binaryen.i32), // return pointer
    ], binaryen.i32);
}

export function compileStringInterp(
    expr: Expression & { kind: "string_interp" },
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, strings } = cc;
    const parts = expr.parts;

    // Edge case: no parts → empty string
    if (parts.length === 0) {
        const empty = strings.intern("");
        // Set __str_ret_len so downstream consumers read correct length
        return mod.block(null, [
            mod.global.set("__str_ret_len", mod.i32.const(empty.length)),
            mod.i32.const(empty.offset),
        ], binaryen.i32);
    }

    // Single part → compile directly (no concat needed)
    // For string literals, must also set __str_ret_len
    if (parts.length === 1) {
        const part = parts[0]!;
        if (part.kind === "literal" && typeof part.value === "string") {
            const interned = strings.intern(part.value);
            return mod.block(null, [
                mod.global.set("__str_ret_len", mod.i32.const(interned.length)),
                mod.i32.const(interned.offset),
            ], binaryen.i32);
        }
        // Non-literal — __str_ret_len already set by callee
        return compileExpr(part, cc, ctx);
    }

    // Helper: compile a part and return [ptrExpr, lenExpr]
    function compilePart(part: Expression): [binaryen.ExpressionRef, binaryen.ExpressionRef] {
        if (part.kind === "literal" && typeof part.value === "string") {
            const interned = strings.intern(part.value);
            return [mod.i32.const(interned.offset), mod.i32.const(interned.length)];
        }
        if (part.kind === "ident") {
            // String variable — use companion __str_len_ local if available
            const ptrExpr = compileExpr(part, cc, ctx);
            const lenLocal = ctx.getLocal(`__str_len_${part.name}`);
            if (lenLocal) {
                return [ptrExpr, mod.local.get(lenLocal.index, binaryen.i32)];
            }
            return [ptrExpr, mod.global.get("__str_ret_len", binaryen.i32)];
        }
        const ptrExpr = compileExpr(part, cc, ctx);
        return [ptrExpr, mod.global.get("__str_ret_len", binaryen.i32)];
    }

    // Left-fold: concat(concat(concat(parts[0], parts[1]), parts[2]), ...)
    // Must save intermediate results to temp locals to prevent __str_ret_len clobbering.
    const stmts: binaryen.ExpressionRef[] = [];

    // Compile first part, save ptr+len to temp locals
    const [ptr0, len0] = compilePart(parts[0]!);
    const accPtrIdx = ctx.addLocal(`__interp_ptr_${expr.id}`, binaryen.i32);
    const accLenIdx = ctx.addLocal(`__interp_len_${expr.id}`, binaryen.i32);
    stmts.push(mod.local.set(accPtrIdx, ptr0));
    stmts.push(mod.local.set(accLenIdx, len0));

    // For each subsequent part, concat with accumulator
    for (let i = 1; i < parts.length; i++) {
        const [partPtr, partLen] = compilePart(parts[i]!);

        // Save part ptr+len to temp locals (partLen may reference __str_ret_len
        // which gets overwritten by the concat call)
        const tmpPartPtrIdx = ctx.addLocal(`__interp_p${i}_ptr_${expr.id}`, binaryen.i32);
        const tmpPartLenIdx = ctx.addLocal(`__interp_p${i}_len_${expr.id}`, binaryen.i32);
        stmts.push(mod.local.set(tmpPartPtrIdx, partPtr));
        stmts.push(mod.local.set(tmpPartLenIdx, partLen));

        // Call string_concat(accPtr, accLen, partPtr, partLen)
        const concatResult = mod.call("string_concat", [
            mod.local.get(accPtrIdx, binaryen.i32),
            mod.local.get(accLenIdx, binaryen.i32),
            mod.local.get(tmpPartPtrIdx, binaryen.i32),
            mod.local.get(tmpPartLenIdx, binaryen.i32),
        ], binaryen.i32);

        // Save result ptr and new __str_ret_len
        stmts.push(mod.local.set(accPtrIdx, concatResult));
        stmts.push(mod.local.set(accLenIdx, mod.global.get("__str_ret_len", binaryen.i32)));
    }

    // Return the final accumulated pointer
    stmts.push(mod.local.get(accPtrIdx, binaryen.i32));
    return mod.block(null, stmts, binaryen.i32);
}
