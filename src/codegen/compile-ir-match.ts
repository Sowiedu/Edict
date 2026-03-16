// =============================================================================
// IR Match expression compiler — pattern matching
// =============================================================================
// The IR counterpart to compile-match.ts. Key difference:
//
// Uses expr.targetTypeName (pre-resolved from IR lowering) instead of the
// 12-line type inference chain that probes ident locals, AST type annotations,
// and type kinds to discover the matched enum name.

import * as binaryen from "./wasm-encoder.js";
import type { IRMatch, IRExpr } from "../ir/types.js";
import type { Pattern } from "../ast/nodes.js";
import { wasmValidationError } from "../errors/structured-errors.js";
import {
    type CompilationContext,
    FunctionContext,
} from "./types.js";
import { compileIRExpr, irExprWasmType } from "./compile-ir-expr.js";


export function compileIRMatch(
    expr: IRMatch,
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, strings, errors } = cc;

    // targetTypeName is pre-resolved from IR — eliminates AST probe chain
    const targetEdictTypeName = expr.targetTypeName;

    // Infer WASM types from IR nodes (eliminates inferExprWasmType)
    const targetType = irExprWasmType(expr.target);
    const matchResultType = irExprWasmType(expr);

    // Evaluate target once, store in temporary local
    const targetExpr = compileIRExpr(expr.target, cc, ctx);
    const tmpIndex = ctx.addLocal(`__match_${expr.sourceId}`, targetType);
    const setTarget = mod.local.set(tmpIndex, targetExpr);
    const getTarget = () => mod.local.get(tmpIndex, targetType);

    // Compile body of a match arm (list of IR expressions)
    function compileArmBody(body: IRExpr[]): binaryen.ExpressionRef {
        const compiled = body.map(e => compileIRExpr(e, cc, ctx));
        if (compiled.length === 0) return mod.nop();
        if (compiled.length === 1) return compiled[0]!;
        const bodyType = body.length > 0
            ? irExprWasmType(body[body.length - 1]!)
            : binaryen.i32;
        return mod.block(null, compiled, bodyType);
    }

    // Build condition expression for a pattern
    function compilePatternCondition(pattern: Pattern): binaryen.ExpressionRef | null {
        switch (pattern.kind) {
            case "literal_pattern": {
                const val = pattern.value;
                // Int64 literal pattern
                if (targetType === binaryen.i64) {
                    const big = BigInt(val as string | number);
                    const low = Number(big & 0xFFFFFFFFn);
                    const high = Number((big >> 32n) & 0xFFFFFFFFn);
                    return mod.i64.eq(getTarget(), mod.i64.const(low, high));
                }
                if (typeof val === "number" && Number.isInteger(val)) {
                    return mod.i32.eq(getTarget(), mod.i32.const(val));
                }
                if (typeof val === "boolean") {
                    return mod.i32.eq(getTarget(), mod.i32.const(val ? 1 : 0));
                }
                if (typeof val === "number") {
                    errors.push(wasmValidationError(`float literal patterns not yet supported in match`));
                    return null;
                }
                if (typeof val === "string") {
                    const interned = strings.intern(val);
                    return mod.i32.eq(getTarget(), mod.i32.const(interned.offset));
                }
                return null;
            }
            case "wildcard":
                return null;
            case "binding":
                return null;
            case "constructor": {
                if (!targetEdictTypeName) {
                    errors.push(wasmValidationError(`cannot infer enum type for match target ${expr.sourceId}`));
                    return null;
                }
                const enumLayout = cc.enumLayouts.get(targetEdictTypeName);
                if (!enumLayout) {
                    errors.push(wasmValidationError(`unknown enum ${targetEdictTypeName}`));
                    return null;
                }
                const variantLayout = enumLayout.variants.find(v => v.name === pattern.name);
                if (!variantLayout) {
                    errors.push(wasmValidationError(`unknown variant ${pattern.name} for enum ${targetEdictTypeName}`));
                    return null;
                }
                const loadTag = mod.i32.load(0, 0, getTarget());
                return mod.i32.eq(loadTag, mod.i32.const(variantLayout.tag));
            }
        }
    }

    // Pre-register binding locals and constructor field bindings
    const bindingLocals = new Map<number, number>();
    const constructorFieldBindings = new Map<number, { localIndex: number; offset: number; wasmType: binaryen.Type }[]>();

    for (let i = 0; i < expr.arms.length; i++) {
        const pattern = expr.arms[i]!.pattern;
        if (pattern.kind === "binding") {
            const bindIndex = ctx.addLocal(pattern.name, targetType);
            bindingLocals.set(i, bindIndex);
        } else if (pattern.kind === "constructor") {
            if (targetEdictTypeName) {
                const enumLayout = cc.enumLayouts.get(targetEdictTypeName);
                if (enumLayout) {
                    const variantLayout = enumLayout.variants.find(v => v.name === pattern.name);
                    if (variantLayout) {
                        const fieldBindings: { localIndex: number; offset: number; wasmType: binaryen.Type }[] = [];
                        for (let j = 0; j < pattern.fields.length; j++) {
                            const subPattern = pattern.fields[j]!;
                            if (subPattern.kind === "binding") {
                                const fieldLayout = variantLayout.fields[j];
                                if (fieldLayout) {
                                    const bindIndex = ctx.addLocal(subPattern.name, fieldLayout.wasmType);
                                    fieldBindings.push({
                                        localIndex: bindIndex,
                                        offset: fieldLayout.offset,
                                        wasmType: fieldLayout.wasmType,
                                    });
                                }
                            } else if (subPattern.kind !== "wildcard") {
                                errors.push(wasmValidationError(`nested patterns inside constructor patterns not yet supported`));
                            }
                        }
                        constructorFieldBindings.set(i, fieldBindings);
                    }
                }
            }
        }
    }

    // Build nested if/else chain from arms (right to left)
    let result: binaryen.ExpressionRef = mod.unreachable();

    for (let i = expr.arms.length - 1; i >= 0; i--) {
        const arm = expr.arms[i]!;
        const bodyExpr = compileArmBody(arm.body);

        let armExpr = bodyExpr;
        const bindIndex = bindingLocals.get(i);
        if (bindIndex !== undefined) {
            const setBinding = mod.local.set(bindIndex, getTarget());
            armExpr = mod.block(null, [setBinding, bodyExpr], matchResultType);
        } else if (arm.pattern.kind === "constructor") {
            const fieldBindings = constructorFieldBindings.get(i);
            if (fieldBindings && fieldBindings.length > 0) {
                const sets: binaryen.ExpressionRef[] = [];
                for (const binding of fieldBindings) {
                    const loadField = binding.wasmType === binaryen.f64
                        ? mod.f64.load(binding.offset, 0, getTarget())
                        : mod.i32.load(binding.offset, 0, getTarget());
                    sets.push(mod.local.set(binding.localIndex, loadField));
                }
                armExpr = mod.block(null, [...sets, bodyExpr], matchResultType);
            }
        }

        const condition = compilePatternCondition(arm.pattern);

        if (condition === null) {
            result = armExpr;
        } else {
            result = mod.if(condition, armExpr, result);
        }
    }

    return mod.block(null, [setTarget, result], matchResultType);
}
