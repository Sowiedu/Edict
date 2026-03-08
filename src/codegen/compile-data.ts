// =============================================================================
// Data structure expression compilers — record, tuple, enum, access, array,
// string interpolation
// =============================================================================

import binaryen from "binaryen";
import type { Expression } from "../ast/nodes.js";
import type { TypeExpr } from "../ast/types.js";
import { wasmValidationError } from "../errors/structured-errors.js";
import {
    type CompilationContext,
    FunctionContext,
    edictTypeToWasm,
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

        if (fieldLayout.wasmType === binaryen.f64) {
            stores.push(
                mod.f64.store(
                    fieldLayout.offset,
                    0,
                    mod.local.get(ptrIndex, binaryen.i32),
                    compileExpr(fieldInit.value, cc, ctx)
                )
            );
        } else {
            stores.push(
                mod.i32.store(
                    fieldLayout.offset,
                    0,
                    mod.local.get(ptrIndex, binaryen.i32),
                    compileExpr(fieldInit.value, cc, ctx)
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

    // All elements use uniform 8-byte slots (strings are just i32 pointers)
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
        const offset = i * 8;
        const ptrExpr = mod.local.get(ptrIndex, binaryen.i32);
        const valWasm = compileExpr(elExpr, cc, ctx);
        const valType = inferExprWasmType(elExpr, cc, ctx);
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

    // Store fields — all fields are uniform 8-byte slots (strings are just i32 pointers)
    for (const fieldInit of expr.fields) {
        const fieldLayout = variantLayout.fields.find(f => f.name === fieldInit.name);
        if (!fieldLayout) continue; // Should be caught by type checker

        const ptrExprForField = mod.local.get(ptrIndex, binaryen.i32);

        if (fieldLayout.wasmType === binaryen.f64) {
            stores.push(mod.f64.store(fieldLayout.offset, 0, ptrExprForField, compileExpr(fieldInit.value, cc, ctx)));
        } else {
            stores.push(mod.i32.store(fieldLayout.offset, 0, ptrExprForField, compileExpr(fieldInit.value, cc, ctx)));
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

    // Try to resolve the target's type info from its local entry
    let edictTypeName: string | undefined;
    let edictType: TypeExpr | undefined;

    if (expr.target.kind === "ident") {
        const local = ctx.getLocal(expr.target.name);
        if (local) {
            edictTypeName = local.edictTypeName;
            edictType = local.edictType;
        }
    } else if (expr.target.kind === "record_expr") {
        edictTypeName = expr.target.name;
    }

    // Tuple access — field is a numeric index
    // All elements use uniform 8-byte slots
    if (edictTypeName === "__tuple" && edictType?.kind === "tuple") {
        const index = parseInt(expr.field, 10);
        if (isNaN(index) || index < 0 || index >= edictType.elements.length) {
            errors.push(wasmValidationError(`invalid tuple index: ${expr.field}`));
            return mod.unreachable();
        }

        const elementType = edictType.elements[index]!;
        const wasmType = edictTypeToWasm(elementType);
        const offset = index * 8;

        const ptrExpr = compileExpr(expr.target, cc, ctx);

        if (wasmType === binaryen.f64) {
            return mod.f64.load(offset, 0, ptrExpr);
        } else {
            return mod.i32.load(offset, 0, ptrExpr);
        }
    }

    // Record access — existing path
    if (!edictTypeName || edictTypeName === "__tuple") {
        errors.push(wasmValidationError(`cannot resolve record type for field access '${expr.field}'`));
        return mod.unreachable();
    }

    const layout = cc.recordLayouts.get(edictTypeName);
    if (!layout) {
        errors.push(wasmValidationError(`unknown record type: ${edictTypeName}`));
        return mod.unreachable();
    }

    const fieldLayout = layout.fields.find((f) => f.name === expr.field);
    if (!fieldLayout) {
        errors.push(wasmValidationError(`unknown field '${expr.field}' on record '${edictTypeName}'`));
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
        return mod.i32.const(empty.offset);
    }

    // Single part → compile directly (no concat needed)
    if (parts.length === 1) {
        return compileExpr(parts[0]!, cc, ctx);
    }

    // Left-fold: concat(concat(concat(parts[0], parts[1]), parts[2]), ...)
    // With length-prefixed strings, each part is just a single i32 pointer.
    const stmts: binaryen.ExpressionRef[] = [];

    // Compile first part, save ptr to temp local
    const accPtrIdx = ctx.addLocal(`__interp_ptr_${expr.id}`, binaryen.i32);
    stmts.push(mod.local.set(accPtrIdx, compileExpr(parts[0]!, cc, ctx)));

    // For each subsequent part, concat with accumulator
    for (let i = 1; i < parts.length; i++) {
        const partExpr = compileExpr(parts[i]!, cc, ctx);

        // Save part ptr to temp local (in case the part expression is complex)
        const tmpPartPtrIdx = ctx.addLocal(`__interp_p${i}_ptr_${expr.id}`, binaryen.i32);
        stmts.push(mod.local.set(tmpPartPtrIdx, partExpr));

        // Call string_concat(accPtr, partPtr) — both are length-prefixed pointers
        const concatResult = mod.call("string_concat", [
            mod.local.get(accPtrIdx, binaryen.i32),
            mod.local.get(tmpPartPtrIdx, binaryen.i32),
        ], binaryen.i32);

        // Save result ptr
        stmts.push(mod.local.set(accPtrIdx, concatResult));
    }

    // Return the final accumulated pointer
    stmts.push(mod.local.get(accPtrIdx, binaryen.i32));
    return mod.block(null, stmts, binaryen.i32);
}
