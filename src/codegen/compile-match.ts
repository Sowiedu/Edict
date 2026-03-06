// =============================================================================
// Match expression compiler — pattern matching
// =============================================================================

import binaryen from "binaryen";
import type { Expression, Pattern } from "../ast/nodes.js";
import { wasmValidationError } from "../errors/structured-errors.js";
import {
    type CompilationContext,
    FunctionContext,
} from "./types.js";
import { compileExpr, inferExprWasmType } from "./codegen.js";

export function compileMatch(
    expr: Expression & { kind: "match" },
    cc: CompilationContext,
    ctx: FunctionContext,
): binaryen.ExpressionRef {
    const { mod, strings, errors } = cc;
    // Attempt to determine the Edict type name of the target for enum matching
    let targetEdictTypeName: string | undefined;
    if (expr.target.kind === "ident") {
        const local = ctx.getLocal(expr.target.name);
        targetEdictTypeName = local?.edictTypeName;
    } else if (expr.target.kind === "call") {
        // Can't easily infer return named type yet without a type env here,
        // but let's be pragmatic if it's annotated
    } else if ("type" in expr.target && expr.target.type && expr.target.type.kind === "named") {
        targetEdictTypeName = expr.target.type.name;
    } else if ("type" in expr.target && expr.target.type && expr.target.type.kind === "option") {
        targetEdictTypeName = "Option";
    } else if ("type" in expr.target && expr.target.type && expr.target.type.kind === "result") {
        targetEdictTypeName = "Result";
    }

    // Infer the target and result types
    const targetType = inferExprWasmType(expr.target, cc, ctx);
    const matchResultType = inferExprWasmType(expr as Expression, cc, ctx);

    // Evaluate target once and store in a temporary local
    const targetExpr = compileExpr(expr.target, cc, ctx);
    const tmpIndex = ctx.addLocal(`__match_${expr.id}`, targetType);
    const setTarget = mod.local.set(tmpIndex, targetExpr);
    const getTarget = () => mod.local.get(tmpIndex, targetType);

    // Compile body of a match arm (list of expressions → single expression)
    function compileArmBody(body: Expression[]): binaryen.ExpressionRef {
        const compiled = body.map((e) =>
            compileExpr(e, cc, ctx),
        );
        if (compiled.length === 0) return mod.nop();
        if (compiled.length === 1) return compiled[0]!;
        const bodyType = body.length > 0
            ? inferExprWasmType(body[body.length - 1]!, cc, ctx)
            : binaryen.i32;
        return mod.block(null, compiled, bodyType);
    }

    // Build condition for a pattern match against the target
    function compilePatternCondition(pattern: Pattern): binaryen.ExpressionRef | null {
        switch (pattern.kind) {
            case "literal_pattern": {
                const val = pattern.value;
                // Int64 literal pattern — value may be string or number
                if ((pattern as any).type?.kind === "basic" && (pattern as any).type.name === "Int64") {
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
                // String/float literal patterns — compare i32 representation
                if (typeof val === "number") {
                    // Float literal pattern — not yet supported in i32 mode
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
                return null; // always matches
            case "binding":
                return null; // always matches (binding is set up in compileArmWithBinding)
            case "constructor": {
                // Determine the tag value from the enum layout
                let tagValue = -1;

                if (targetEdictTypeName) {
                    const enumLayout = cc.enumLayouts.get(targetEdictTypeName);
                    if (enumLayout) {
                        const variantLayout = enumLayout.variants.find(v => v.name === pattern.name);
                        if (variantLayout) {
                            tagValue = variantLayout.tag;
                        } else {
                            errors.push(wasmValidationError(`unknown variant ${pattern.name} for enum ${targetEdictTypeName}`));
                            return null;
                        }
                    } else {
                        errors.push(wasmValidationError(`unknown enum ${targetEdictTypeName}`));
                        return null;
                    }
                } else {
                    errors.push(wasmValidationError(`cannot infer enum type for match target ${expr.id}`));
                    return null;
                }

                if (tagValue === -1) return null;

                // Load tag at offset 0 from the heap pointer (target)
                const loadTag = mod.i32.load(0, 0, getTarget());
                return mod.i32.eq(loadTag, mod.i32.const(tagValue));
            }
        }
    }

    // Pre-register binding locals so they're available during body compilation.
    // We must do this before compiling arm bodies, otherwise ident lookups
    // for bound names will fail.
    const bindingLocals = new Map<number, number>(); // arm index → local index
    const constructorFieldBindings = new Map<number, { localIndex: number, offset: number, wasmType: binaryen.Type }[]>();

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
                        const fieldBindings: { localIndex: number, offset: number, wasmType: binaryen.Type }[] = [];
                        for (let j = 0; j < pattern.fields.length; j++) {
                            const subPattern = pattern.fields[j]!;
                            if (subPattern.kind === "binding") {
                                const fieldLayout = variantLayout.fields[j];
                                if (fieldLayout) {
                                    const bindIndex = ctx.addLocal(subPattern.name, fieldLayout.wasmType);
                                    fieldBindings.push({
                                        localIndex: bindIndex,
                                        offset: fieldLayout.offset,
                                        wasmType: fieldLayout.wasmType
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
    // Start from the last arm and work backwards
    let result: binaryen.ExpressionRef = mod.unreachable();

    for (let i = expr.arms.length - 1; i >= 0; i--) {
        const arm = expr.arms[i]!;
        const bodyExpr = compileArmBody(arm.body);

        // Wrap with binding set if this is a binding pattern
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
            // Wildcard or binding — this arm always matches
            // It becomes the else (or the whole result if it's the only/last arm)
            result = armExpr;
        } else {
            // Conditional arm — if condition then this arm else previous result
            result = mod.if(condition, armExpr, result);
        }
    }

    // Wrap: set target, then evaluate the if/else chain
    return mod.block(null, [setTarget, result], matchResultType);
}
