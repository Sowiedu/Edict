// =============================================================================
// IR Lowering Pass — AST + TypedModuleInfo → IRModule
// =============================================================================
// Transforms a type-checked EdictModule into the mid-level IR.
// Resolves types from TypedModuleInfo, pre-classifies identifiers and calls,
// lifts lambdas to top-level, and pre-computes closure environments.

import type {
    EdictModule,
    FunctionDef,
    Expression,
    RecordDef,
    EnumDef,
    ConstDef,
    Import,
} from "../ast/nodes.js";
import type { TypeExpr, FunctionType } from "../ast/types.js";
import type { TypedModuleInfo } from "../checker/check.js";
import { BUILTIN_FUNCTIONS } from "../builtins/builtins.js";
import { walkExpression } from "../ast/walk.js";

import type {
    IRModule,
    IRImport,
    IRFunction,
    IRParam,
    IRClosureVar,
    IRConstant,
    IRRecordDef,
    IREnumDef,
    IRExpr,
    IRCallKind,
    IRIdentScope,
    IRFieldInit,
    IRMatchArm,
    IRStringInterpPart,
} from "./types.js";

// =============================================================================
// Type constants — avoids repeated object allocation
// =============================================================================

const INT_TYPE: TypeExpr = { kind: "basic", name: "Int" };
const FLOAT_TYPE: TypeExpr = { kind: "basic", name: "Float" };
const STRING_TYPE: TypeExpr = { kind: "basic", name: "String" };
const BOOL_TYPE: TypeExpr = { kind: "basic", name: "Bool" };
const UNKNOWN_TYPE: TypeExpr = { kind: "basic", name: "Int" }; // fallback

/** Operators that produce Bool results */
const CMP_OPS = new Set(["==", "!=", "<", ">", "<=", ">=", "and", "or", "implies"]);

// =============================================================================
// Lowering Context — threads state through the recursive walk
// =============================================================================

interface LoweringContext {
    readonly typeInfo: TypedModuleInfo;
    readonly module: EdictModule;

    /** All top-level function names */
    readonly fnNames: Set<string>;
    /** All top-level const names */
    readonly constNames: Set<string>;
    /** All imported names */
    readonly importedNames: Set<string>;
    /** Builtin function names (cached reference) */
    readonly builtinNames: ReadonlyMap<string, { type: FunctionType }>;

    /** Function definitions by name — for looking up return types and param types */
    readonly fnDefs: Map<string, FunctionDef>;
    /** Const definitions by name — for looking up types */
    readonly constDefs: Map<string, ConstDef>;
    /** Import type declarations by name */
    readonly importTypes: Map<string, TypeExpr>;

    /** Record definitions by name */
    readonly recordDefs: Map<string, RecordDef>;
    /** Enum definitions by name */
    readonly enumDefs: Map<string, EnumDef>;

    /** Lifted lambda functions accumulate here during lowering */
    liftedLambdas: IRFunction[];
    /** Auto-incrementing counter for lambda names */
    lambdaCounter: number;
}

/** Scope tracking for a single function being lowered */
interface FunctionScope {
    /** Parameters of the current function (name → type) */
    readonly params: Map<string, TypeExpr>;
    /** Let-bound locals in the current scope (name → type) */
    readonly locals: Map<string, TypeExpr>;
    /** Free variables captured from enclosing scope (when lowering lambdas) */
    readonly closureFreeVars: Set<string> | undefined;
}

// =============================================================================
// Entry Point
// =============================================================================

/**
 * Lower a type-checked Edict module into the mid-level IR.
 *
 * @param module - A validated, resolved, and type-checked Edict module
 * @param typeInfo - The side-table of inferred types from the type checker
 * @returns A fully lowered IRModule ready for codegen
 */
export function lowerModule(module: EdictModule, typeInfo: TypedModuleInfo): IRModule {
    // Build the lowering context
    const fnNames = new Set<string>();
    const constNames = new Set<string>();
    const importedNames = new Set<string>();
    const fnDefs = new Map<string, FunctionDef>();
    const constDefs = new Map<string, ConstDef>();
    const recordDefs = new Map<string, RecordDef>();
    const enumDefs = new Map<string, EnumDef>();
    const importTypes = new Map<string, TypeExpr>();

    for (const def of module.definitions) {
        switch (def.kind) {
            case "fn":
                fnNames.add(def.name);
                fnDefs.set(def.name, def);
                break;
            case "const":
                constNames.add(def.name);
                constDefs.set(def.name, def);
                break;
            case "record":
                recordDefs.set(def.name, def);
                break;
            case "enum":
                enumDefs.set(def.name, def);
                break;
        }
    }

    for (const imp of module.imports) {
        for (const name of imp.names) {
            importedNames.add(name);
            if (imp.types?.[name]) {
                importTypes.set(name, imp.types[name]!);
            }
        }
    }

    const ctx: LoweringContext = {
        typeInfo,
        module,
        fnNames,
        constNames,
        importedNames,
        builtinNames: BUILTIN_FUNCTIONS,
        fnDefs,
        constDefs,
        importTypes,
        recordDefs,
        enumDefs,
        liftedLambdas: [],
        lambdaCounter: 0,
    };

    // Lower imports
    const imports = lowerImports(module.imports, importTypes);

    // Lower functions
    const functions: IRFunction[] = [];
    for (const def of module.definitions) {
        if (def.kind === "fn") {
            functions.push(lowerFunction(def, ctx));
        }
    }

    // Lower constants
    const constants: IRConstant[] = [];
    for (const def of module.definitions) {
        if (def.kind === "const") {
            constants.push(lowerConstant(def, ctx));
        }
    }

    // Lower record and enum definitions
    const records = lowerRecordDefs(module);
    const enums = lowerEnumDefs(module);

    // Append lifted lambdas to the functions list
    functions.push(...ctx.liftedLambdas);

    return {
        name: module.name,
        sourceId: module.id,
        imports,
        functions,
        records,
        enums,
        constants,
    };
}

// =============================================================================
// Import Lowering
// =============================================================================

function lowerImports(
    imports: Import[],
    importTypes: Map<string, TypeExpr>,
): IRImport[] {
    const result: IRImport[] = [];
    for (const imp of imports) {
        for (const name of imp.names) {
            // Skip builtins — they're handled separately by codegen
            if (BUILTIN_FUNCTIONS.has(name)) continue;

            const declaredType = importTypes.get(name);
            if (declaredType && declaredType.kind === "fn_type") {
                result.push({
                    module: imp.module,
                    name,
                    paramTypes: declaredType.params,
                    returnType: declaredType.returnType,
                    effects: declaredType.effects.filter(
                        e => typeof e === "string"
                    ) as import("../ast/nodes.js").ConcreteEffect[],
                });
            } else {
                // Untyped import — use unknown signature
                result.push({
                    module: imp.module,
                    name,
                    paramTypes: [],
                    returnType: UNKNOWN_TYPE,
                    effects: [],
                });
            }
        }
    }
    return result;
}

// =============================================================================
// Function Lowering
// =============================================================================

function lowerFunction(fn: FunctionDef, ctx: LoweringContext): IRFunction {
    const params = new Map<string, TypeExpr>();
    const irParams: IRParam[] = [];

    for (const p of fn.params) {
        const resolvedType = ctx.typeInfo.inferredLambdaParamTypes.get(p.id) ?? p.type ?? UNKNOWN_TYPE;
        params.set(p.name, resolvedType);
        irParams.push({
            sourceId: p.id,
            name: p.name,
            resolvedType,
        });
    }

    const scope: FunctionScope = {
        params,
        locals: new Map(),
        closureFreeVars: undefined,
    };

    const body = lowerExprList(fn.body, ctx, scope);

    const resolvedReturnType = fn.returnType
        ?? ctx.typeInfo.inferredReturnTypes.get(fn.id)
        ?? resolveExprListType(fn.body, ctx, scope)
        ?? UNKNOWN_TYPE;

    return {
        sourceId: fn.id,
        name: fn.name,
        params: irParams,
        resolvedReturnType,
        effects: [...fn.effects],
        contracts: [...fn.contracts],
        body,
        closureEnv: [],
        isLambda: false,
    };
}

// =============================================================================
// Constant Lowering
// =============================================================================

function lowerConstant(def: ConstDef, ctx: LoweringContext): IRConstant {
    const scope: FunctionScope = {
        params: new Map(),
        locals: new Map(),
        closureFreeVars: undefined,
    };

    return {
        sourceId: def.id,
        name: def.name,
        resolvedType: def.type,
        value: lowerExpr(def.value, ctx, scope),
    };
}

// =============================================================================
// Record & Enum Definition Lowering
// =============================================================================

function lowerRecordDefs(
    module: EdictModule,
): IRRecordDef[] {
    const result: IRRecordDef[] = [];
    for (const def of module.definitions) {
        if (def.kind === "record") {
            result.push({
                name: def.name,
                fields: def.fields.map(f => ({
                    name: f.name,
                    resolvedType: f.type,
                    hasDefault: !!f.defaultValue,
                })),
            });
        }
    }
    return result;
}

function lowerEnumDefs(
    module: EdictModule,
): IREnumDef[] {
    const result: IREnumDef[] = [];
    for (const def of module.definitions) {
        if (def.kind === "enum") {
            result.push({
                name: def.name,
                variants: def.variants.map((v, tag) => ({
                    name: v.name,
                    tag,
                    fields: v.fields.map(f => ({
                        name: f.name,
                        resolvedType: f.type,
                        hasDefault: !!f.defaultValue,
                    })),
                })),
            });
        }
    }
    return result;
}

// =============================================================================
// Expression Lowering
// =============================================================================

function lowerExprList(
    exprs: Expression[],
    ctx: LoweringContext,
    scope: FunctionScope,
): IRExpr[] {
    const result: IRExpr[] = [];
    for (const expr of exprs) {
        const lowered = lowerExpr(expr, ctx, scope);
        if (lowered) {
            result.push(lowered);
            // Track let bindings in scope
            if (expr.kind === "let") {
                const letType = expr.type
                    ?? ctx.typeInfo.inferredLetTypes.get(expr.id)
                    ?? resolveExprType(expr.value, ctx, scope);
                scope.locals.set(expr.name, letType);
            }
        }
    }
    return result;
}

function lowerExpr(
    expr: Expression,
    ctx: LoweringContext,
    scope: FunctionScope,
): IRExpr {
    switch (expr.kind) {
        case "literal":
            return lowerLiteral(expr, ctx);

        case "ident":
            return lowerIdent(expr, ctx, scope);

        case "binop":
            return lowerBinop(expr, ctx, scope);

        case "unop":
            return lowerUnop(expr, ctx, scope);

        case "call":
            return lowerCall(expr, ctx, scope);

        case "if":
            return lowerIf(expr, ctx, scope);

        case "let":
            return lowerLet(expr, ctx, scope);

        case "block":
            return lowerBlock(expr, ctx, scope);

        case "match":
            return lowerMatch(expr, ctx, scope);

        case "array":
            return lowerArray(expr, ctx, scope);

        case "tuple_expr":
            return lowerTuple(expr, ctx, scope);

        case "record_expr":
            return lowerRecordExpr(expr, ctx, scope);

        case "enum_constructor":
            return lowerEnumConstructor(expr, ctx, scope);

        case "access":
            return lowerAccess(expr, ctx, scope);

        case "lambda":
            return lowerLambda(expr, ctx, scope);

        case "string_interp":
            return lowerStringInterp(expr, ctx, scope);

        // Contract-only expressions and tool_call — not compiled to WASM
        case "forall":
        case "exists":
        case "tool_call":
            // Return a placeholder literal (these should not appear in runtime bodies)
            return {
                kind: "ir_literal",
                sourceId: expr.id,
                resolvedType: INT_TYPE,
                value: 0,
            };
    }
}

// =============================================================================
// Individual Expression Lowering
// =============================================================================

function lowerLiteral(
    expr: Expression & { kind: "literal" },
    _ctx: LoweringContext,
): IRExpr {
    let resolvedType: TypeExpr;
    if (expr.type) {
        resolvedType = expr.type;
    } else if (typeof expr.value === "boolean") {
        resolvedType = BOOL_TYPE;
    } else if (typeof expr.value === "string") {
        resolvedType = STRING_TYPE;
    } else if (typeof expr.value === "number") {
        resolvedType = Number.isInteger(expr.value) ? INT_TYPE : FLOAT_TYPE;
    } else {
        resolvedType = UNKNOWN_TYPE;
    }

    return {
        kind: "ir_literal",
        sourceId: expr.id,
        resolvedType,
        value: expr.value,
    };
}

function lowerIdent(
    expr: Expression & { kind: "ident" },
    ctx: LoweringContext,
    scope: FunctionScope,
): IRExpr {
    const name = expr.name;
    const resolvedType = resolveIdentType(name, ctx, scope);
    const identScope = classifyIdentScope(name, ctx, scope);

    return {
        kind: "ir_ident",
        sourceId: expr.id,
        resolvedType,
        name,
        scope: identScope,
    };
}

function lowerBinop(
    expr: Expression & { kind: "binop" },
    ctx: LoweringContext,
    scope: FunctionScope,
): IRExpr {
    const left = lowerExpr(expr.left, ctx, scope);
    const right = lowerExpr(expr.right, ctx, scope);

    const cmpResult = CMP_OPS.has(expr.op);
    const resolvedType: TypeExpr = cmpResult ? BOOL_TYPE : left.resolvedType;

    // resolvedOperandType is the type of the operands before the operation
    const resolvedOperandType = left.resolvedType;

    return {
        kind: "ir_binop",
        sourceId: expr.id,
        resolvedType,
        op: expr.op,
        left,
        right,
        resolvedOperandType,
    };
}

function lowerUnop(
    expr: Expression & { kind: "unop" },
    ctx: LoweringContext,
    scope: FunctionScope,
): IRExpr {
    const operand = lowerExpr(expr.operand, ctx, scope);
    const resolvedType = expr.op === "not" ? BOOL_TYPE : operand.resolvedType;

    return {
        kind: "ir_unop",
        sourceId: expr.id,
        resolvedType,
        op: expr.op,
        operand,
    };
}

function lowerCall(
    expr: Expression & { kind: "call" },
    ctx: LoweringContext,
    scope: FunctionScope,
): IRExpr {
    const fn = lowerExpr(expr.fn, ctx, scope);
    const args = expr.args.map(a => lowerExpr(a, ctx, scope));

    // Classify the call
    const callKind = classifyCallKind(expr, ctx, scope);

    // Resolve return type
    const resolvedType = resolveCallReturnType(expr, ctx, scope);

    // Find string param indices
    const stringParamIndices = findStringParamIndices(expr, ctx);

    // Arg coercions — currently not populated at the call level
    // (string interp coercions are handled separately)
    const argCoercions: Record<number, string> = {};

    return {
        kind: "ir_call",
        sourceId: expr.id,
        resolvedType,
        fn,
        args,
        callKind,
        stringParamIndices,
        argCoercions,
    };
}

function lowerIf(
    expr: Expression & { kind: "if" },
    ctx: LoweringContext,
    scope: FunctionScope,
): IRExpr {
    const condition = lowerExpr(expr.condition, ctx, scope);

    // Create child scopes for then/else branches
    const thenScope = childScope(scope);
    const thenBody = lowerExprList(expr.then, ctx, thenScope);

    const elseBody = expr.else
        ? lowerExprList(expr.else, ctx, childScope(scope))
        : [];

    // Resolve the type of the if expression
    const resolvedType = resolveExprType(expr, ctx, scope);

    return {
        kind: "ir_if",
        sourceId: expr.id,
        resolvedType,
        condition,
        then: thenBody,
        else: elseBody,
    };
}

function lowerLet(
    expr: Expression & { kind: "let" },
    ctx: LoweringContext,
    scope: FunctionScope,
): IRExpr {
    const value = lowerExpr(expr.value, ctx, scope);

    const boundType = expr.type
        ?? ctx.typeInfo.inferredLetTypes.get(expr.id)
        ?? value.resolvedType;

    return {
        kind: "ir_let",
        sourceId: expr.id,
        resolvedType: boundType,
        name: expr.name,
        boundType,
        value,
    };
}

function lowerBlock(
    expr: Expression & { kind: "block" },
    ctx: LoweringContext,
    scope: FunctionScope,
): IRExpr {
    const blockScope = childScope(scope);
    const body = lowerExprList(expr.body, ctx, blockScope);

    const resolvedType = body.length > 0
        ? body[body.length - 1]!.resolvedType
        : UNKNOWN_TYPE;

    return {
        kind: "ir_block",
        sourceId: expr.id,
        resolvedType,
        body,
    };
}

function lowerMatch(
    expr: Expression & { kind: "match" },
    ctx: LoweringContext,
    scope: FunctionScope,
): IRExpr {
    const target = lowerExpr(expr.target, ctx, scope);

    // Resolve target type name for codegen layout lookup
    const targetTypeName = resolveTypeName(target.resolvedType);

    const arms: IRMatchArm[] = expr.arms.map(arm => {
        const armScope = childScope(scope);
        // Bind pattern variables in the arm scope
        bindPatternVars(arm.pattern, target.resolvedType, armScope, ctx);
        const body = lowerExprList(arm.body, ctx, armScope);
        return {
            sourceId: arm.id,
            pattern: arm.pattern,
            body,
        };
    });

    // Result type is the type of the first arm's body
    const resolvedType = arms.length > 0 && arms[0]!.body.length > 0
        ? arms[0]!.body[arms[0]!.body.length - 1]!.resolvedType
        : UNKNOWN_TYPE;

    return {
        kind: "ir_match",
        sourceId: expr.id,
        resolvedType,
        target,
        arms,
        targetTypeName,
    };
}

function lowerArray(
    expr: Expression & { kind: "array" },
    ctx: LoweringContext,
    scope: FunctionScope,
): IRExpr {
    const elements = expr.elements.map(e => lowerExpr(e, ctx, scope));

    const elementType = elements.length > 0
        ? elements[0]!.resolvedType
        : UNKNOWN_TYPE;

    return {
        kind: "ir_array",
        sourceId: expr.id,
        resolvedType: { kind: "array", element: elementType },
        elements,
    };
}

function lowerTuple(
    expr: Expression & { kind: "tuple_expr" },
    ctx: LoweringContext,
    scope: FunctionScope,
): IRExpr {
    const elements = expr.elements.map(e => lowerExpr(e, ctx, scope));

    return {
        kind: "ir_tuple",
        sourceId: expr.id,
        resolvedType: { kind: "tuple", elements: elements.map(e => e.resolvedType) },
        elements,
    };
}

function lowerRecordExpr(
    expr: Expression & { kind: "record_expr" },
    ctx: LoweringContext,
    scope: FunctionScope,
): IRExpr {
    const recordDef = ctx.recordDefs.get(expr.name);

    // Lower fields — order by definition order if possible
    const fields: IRFieldInit[] = [];
    if (recordDef) {
        // Emit fields in definition order, matching record layout
        for (const fieldDef of recordDef.fields) {
            const init = expr.fields.find(f => f.name === fieldDef.name);
            if (init) {
                const value = lowerExpr(init.value, ctx, scope);
                fields.push({
                    name: fieldDef.name,
                    value,
                    resolvedType: fieldDef.type,
                });
            } else if (fieldDef.defaultValue) {
                const value = lowerExpr(fieldDef.defaultValue, ctx, scope);
                fields.push({
                    name: fieldDef.name,
                    value,
                    resolvedType: fieldDef.type,
                });
            }
        }
    } else {
        // No definition found — lower fields as-is
        for (const init of expr.fields) {
            const value = lowerExpr(init.value, ctx, scope);
            fields.push({
                name: init.name,
                value,
                resolvedType: value.resolvedType,
            });
        }
    }

    return {
        kind: "ir_record",
        sourceId: expr.id,
        resolvedType: { kind: "named", name: expr.name },
        name: expr.name,
        fields,
    };
}

function lowerEnumConstructor(
    expr: Expression & { kind: "enum_constructor" },
    ctx: LoweringContext,
    scope: FunctionScope,
): IRExpr {
    const enumDef = ctx.enumDefs.get(expr.enumName);
    let tag = 0;

    if (enumDef) {
        const variantIdx = enumDef.variants.findIndex(v => v.name === expr.variant);
        if (variantIdx >= 0) tag = variantIdx;
    }

    // Resolve field types from the variant definition
    const variant = enumDef?.variants.find(v => v.name === expr.variant);

    const fields: IRFieldInit[] = expr.fields.map((init, i) => {
        const value = lowerExpr(init.value, ctx, scope);
        const fieldDef = variant?.fields[i];
        return {
            name: init.name,
            value,
            resolvedType: fieldDef?.type ?? value.resolvedType,
        };
    });

    return {
        kind: "ir_enum_constructor",
        sourceId: expr.id,
        resolvedType: { kind: "named", name: expr.enumName },
        enumName: expr.enumName,
        variant: expr.variant,
        tag,
        fields,
    };
}

function lowerAccess(
    expr: Expression & { kind: "access" },
    ctx: LoweringContext,
    scope: FunctionScope,
): IRExpr {
    const target = lowerExpr(expr.target, ctx, scope);
    const targetTypeName = resolveTypeName(target.resolvedType);

    // Resolve the type of the field being accessed
    const resolvedType = resolveAccessType(expr.field, target.resolvedType, ctx);

    return {
        kind: "ir_access",
        sourceId: expr.id,
        resolvedType,
        target,
        field: expr.field,
        targetTypeName,
    };
}

function lowerLambda(
    expr: Expression & { kind: "lambda" },
    ctx: LoweringContext,
    scope: FunctionScope,
): IRExpr {
    const lambdaName = `__lambda_${ctx.lambdaCounter++}`;

    // Build parameter map
    const lambdaParams = new Map<string, TypeExpr>();
    const irParams: IRParam[] = [];
    for (const p of expr.params) {
        const resolvedType = ctx.typeInfo.inferredLambdaParamTypes.get(p.id)
            ?? p.type
            ?? UNKNOWN_TYPE;
        lambdaParams.set(p.name, resolvedType);
        irParams.push({
            sourceId: p.id,
            name: p.name,
            resolvedType,
        });
    }

    // Collect free variables
    const freeVarNames = collectFreeVars(expr.body, lambdaParams, ctx);

    // Build closure environment
    const closureEnv: IRClosureVar[] = [];
    const captures: IRClosureVar[] = [];
    for (const name of freeVarNames) {
        const resolvedType = resolveIdentType(name, ctx, scope);
        closureEnv.push({ name, resolvedType });
        captures.push({ name, resolvedType });
    }

    // Create a new scope for the lambda body
    const lambdaScope: FunctionScope = {
        params: lambdaParams,
        locals: new Map(),
        closureFreeVars: freeVarNames,
    };

    const body = lowerExprList(expr.body, ctx, lambdaScope);

    // Infer return type from body
    const resolvedReturnType = body.length > 0
        ? body[body.length - 1]!.resolvedType
        : UNKNOWN_TYPE;

    // Build the fn_type for the lambda
    const fnType: TypeExpr = {
        kind: "fn_type",
        params: irParams.map(p => p.resolvedType),
        effects: ["pure"], // lambdas default to pure; effect checker resolves actual effects
        returnType: resolvedReturnType,
    };

    // Lift the lambda to a top-level function
    const lifted: IRFunction = {
        sourceId: expr.id,
        name: lambdaName,
        params: irParams,
        resolvedReturnType,
        effects: ["pure"],
        contracts: [],
        body,
        closureEnv,
        isLambda: true,
    };
    ctx.liftedLambdas.push(lifted);

    // Return a lambda reference in the expression tree
    return {
        kind: "ir_lambda_ref",
        sourceId: expr.id,
        resolvedType: fnType,
        liftedName: lambdaName,
        captures,
    };
}

function lowerStringInterp(
    expr: Expression & { kind: "string_interp" },
    ctx: LoweringContext,
    scope: FunctionScope,
): IRExpr {
    const parts: IRStringInterpPart[] = expr.parts.map(part => {
        const lowered = lowerExpr(part, ctx, scope);
        // Look up coercion from typeInfo
        const coercionBuiltin = ctx.typeInfo.stringInterpCoercions.get(part.id);
        return {
            expr: lowered,
            coercionBuiltin,
        };
    });

    return {
        kind: "ir_string_interp",
        sourceId: expr.id,
        resolvedType: STRING_TYPE,
        parts,
    };
}

// =============================================================================
// Type Resolution Helpers — read from existing sources of truth
// =============================================================================

/** Resolve the type of an identifier from the scope/context. */
function resolveIdentType(
    name: string,
    ctx: LoweringContext,
    scope: FunctionScope,
): TypeExpr {
    // 1. Local let-bindings (most recent scope first)
    const localType = scope.locals.get(name);
    if (localType) return localType;

    // 2. Function parameters
    const paramType = scope.params.get(name);
    if (paramType) return paramType;

    // 3. Module-level constants
    const constDef = ctx.constDefs.get(name);
    if (constDef) return constDef.type;

    // 4. Builtin functions
    const builtin = ctx.builtinNames.get(name);
    if (builtin) return builtin.type;

    // 5. Top-level functions (as fn_type)
    const fnDef = ctx.fnDefs.get(name);
    if (fnDef) {
        return {
            kind: "fn_type",
            params: fnDef.params.map(p => p.type ?? UNKNOWN_TYPE),
            effects: [...fnDef.effects],
            returnType: fnDef.returnType
                ?? ctx.typeInfo.inferredReturnTypes.get(fnDef.id)
                ?? UNKNOWN_TYPE,
        };
    }

    // 6. Imported names
    const importType = ctx.importTypes.get(name);
    if (importType) return importType;

    return UNKNOWN_TYPE;
}

/** Resolve the type of an arbitrary expression. */
function resolveExprType(
    expr: Expression,
    ctx: LoweringContext,
    scope: FunctionScope,
): TypeExpr {
    switch (expr.kind) {
        case "literal": {
            if (expr.type) return expr.type;
            if (typeof expr.value === "boolean") return BOOL_TYPE;
            if (typeof expr.value === "string") return STRING_TYPE;
            if (typeof expr.value === "number") {
                return Number.isInteger(expr.value) ? INT_TYPE : FLOAT_TYPE;
            }
            return UNKNOWN_TYPE;
        }
        case "ident":
            return resolveIdentType(expr.name, ctx, scope);
        case "binop": {
            const cmpOps = new Set(["==", "!=", "<", ">", "<=", ">=", "and", "or", "implies"]);
            if (cmpOps.has(expr.op)) return BOOL_TYPE;
            return resolveExprType(expr.left, ctx, scope);
        }
        case "unop":
            return expr.op === "not" ? BOOL_TYPE : resolveExprType(expr.operand, ctx, scope);
        case "call":
            return resolveCallReturnType(expr, ctx, scope);
        case "if": {
            if (expr.then.length > 0) {
                const thenType = resolveExprType(expr.then[expr.then.length - 1]!, ctx, scope);
                if (expr.else) return thenType;
                return { kind: "option", inner: thenType };
            }
            return UNKNOWN_TYPE;
        }
        case "let":
            return expr.type ?? ctx.typeInfo.inferredLetTypes.get(expr.id) ?? resolveExprType(expr.value, ctx, scope);
        case "block":
            return expr.body.length > 0
                ? resolveExprType(expr.body[expr.body.length - 1]!, ctx, scope)
                : UNKNOWN_TYPE;
        case "match":
            if (expr.arms.length > 0 && expr.arms[0]!.body.length > 0) {
                return resolveExprType(expr.arms[0]!.body[expr.arms[0]!.body.length - 1]!, ctx, scope);
            }
            return UNKNOWN_TYPE;
        case "array": {
            const elemType = expr.elements.length > 0
                ? resolveExprType(expr.elements[0]!, ctx, scope)
                : UNKNOWN_TYPE;
            return { kind: "array", element: elemType };
        }
        case "tuple_expr":
            return { kind: "tuple", elements: expr.elements.map(e => resolveExprType(e, ctx, scope)) };
        case "record_expr":
            return { kind: "named", name: expr.name };
        case "enum_constructor":
            return { kind: "named", name: expr.enumName };
        case "access":
            return resolveAccessType(expr.field, resolveExprType(expr.target, ctx, scope), ctx);
        case "lambda": {
            const paramTypes = expr.params.map(p =>
                ctx.typeInfo.inferredLambdaParamTypes.get(p.id) ?? p.type ?? UNKNOWN_TYPE
            );
            return {
                kind: "fn_type",
                params: paramTypes,
                effects: ["pure"],
                returnType: expr.body.length > 0
                    ? resolveExprType(expr.body[expr.body.length - 1]!, ctx, scope)
                    : UNKNOWN_TYPE,
            };
        }
        case "string_interp":
            return STRING_TYPE;
        default:
            return UNKNOWN_TYPE;
    }
}

/** Resolve the type of the last expression in a list. */
function resolveExprListType(
    exprs: Expression[],
    ctx: LoweringContext,
    scope: FunctionScope,
): TypeExpr {
    if (exprs.length === 0) return UNKNOWN_TYPE;
    return resolveExprType(exprs[exprs.length - 1]!, ctx, scope);
}

/** Resolve the return type of a call expression. */
function resolveCallReturnType(
    expr: Expression & { kind: "call" },
    ctx: LoweringContext,
    scope: FunctionScope,
): TypeExpr {
    if (expr.fn.kind === "ident") {
        const name = expr.fn.name;

        // Builtin
        const builtin = ctx.builtinNames.get(name);
        if (builtin) return builtin.type.returnType;

        // User function
        const fnDef = ctx.fnDefs.get(name);
        if (fnDef) {
            return fnDef.returnType
                ?? ctx.typeInfo.inferredReturnTypes.get(fnDef.id)
                ?? UNKNOWN_TYPE;
        }

        // Import
        const importType = ctx.importTypes.get(name);
        if (importType && importType.kind === "fn_type") {
            return importType.returnType;
        }

        // Check if it's a local variable with fn_type
        const identType = resolveIdentType(name, ctx, scope);
        if (identType.kind === "fn_type") {
            return identType.returnType;
        }
    }

    return UNKNOWN_TYPE;
}

/** Resolve the type of a field access. */
function resolveAccessType(
    field: string,
    targetType: TypeExpr,
    ctx: LoweringContext,
): TypeExpr {
    // Named type → look up record definition
    if (targetType.kind === "named") {
        const recordDef = ctx.recordDefs.get(targetType.name);
        if (recordDef) {
            const fieldDef = recordDef.fields.find(f => f.name === field);
            if (fieldDef) return fieldDef.type;
        }
    }

    // Tuple → look up by index
    if (targetType.kind === "tuple") {
        const idx = parseInt(field, 10);
        if (!isNaN(idx) && idx >= 0 && idx < targetType.elements.length) {
            return targetType.elements[idx]!;
        }
    }

    return UNKNOWN_TYPE;
}

/** Map a TypeExpr to a type name string (for layout lookup in codegen). */
function resolveTypeName(type: TypeExpr): string | undefined {
    switch (type.kind) {
        case "named": return type.name;
        case "option": return "Option";
        case "result": return "Result";
        case "tuple": return "__tuple";
        default: return undefined;
    }
}

// =============================================================================
// Identifier Scope Classification
// =============================================================================

function classifyIdentScope(
    name: string,
    ctx: LoweringContext,
    scope: FunctionScope,
): IRIdentScope {
    // Check if it's a closure capture
    if (scope.closureFreeVars?.has(name)) return "closure";

    // Check if it's a local (let-bound)
    if (scope.locals.has(name)) return "local";

    // Check if it's a parameter
    if (scope.params.has(name)) return "local";

    // Check if it's a module-level constant
    if (ctx.constNames.has(name)) return "global";

    // Check if it's a function reference
    if (ctx.fnNames.has(name)) return "function";

    // Builtins and imports are treated as function scope
    if (ctx.builtinNames.has(name)) return "function";
    if (ctx.importedNames.has(name)) return "function";

    return "local"; // fallback
}

// =============================================================================
// Call Kind Classification
// =============================================================================

function classifyCallKind(
    expr: Expression & { kind: "call" },
    ctx: LoweringContext,
    scope: FunctionScope,
): IRCallKind {
    if (expr.fn.kind !== "ident") return "indirect";

    const name = expr.fn.name;

    // Is it a builtin?
    if (ctx.builtinNames.has(name)) return "builtin";

    // Is it a known function or import?
    if (ctx.fnNames.has(name) || ctx.importedNames.has(name)) return "direct";

    // Check if it's a local variable (closure reference) — indirect
    if (scope.locals.has(name) || scope.params.has(name)) return "indirect";

    return "direct"; // fallback for unrecognized names
}

// =============================================================================
// String Param Index Detection
// =============================================================================

function findStringParamIndices(
    expr: Expression & { kind: "call" },
    ctx: LoweringContext,
): number[] {
    if (expr.fn.kind !== "ident") return [];

    const name = expr.fn.name;
    const indices: number[] = [];

    // Get param types from builtin, function def, or import
    let paramTypes: TypeExpr[] | undefined;

    const builtin = ctx.builtinNames.get(name);
    if (builtin) {
        paramTypes = builtin.type.params;
    } else {
        const fnDef = ctx.fnDefs.get(name);
        if (fnDef) {
            paramTypes = fnDef.params.map(p => p.type ?? UNKNOWN_TYPE);
        } else {
            const importType = ctx.importTypes.get(name);
            if (importType && importType.kind === "fn_type") {
                paramTypes = importType.params;
            }
        }
    }

    if (paramTypes) {
        for (let i = 0; i < paramTypes.length; i++) {
            if (isStringType(paramTypes[i]!)) {
                indices.push(i);
            }
        }
    }

    return indices;
}

function isStringType(type: TypeExpr): boolean {
    return type.kind === "basic" && type.name === "String";
}

// =============================================================================
// Free Variable Collection (for lambda closures)
// =============================================================================

/**
 * Collect free variables in a lambda body — names not bound as params,
 * not locally defined, not global/function/builtin.
 */
function collectFreeVars(
    body: Expression[],
    params: Map<string, TypeExpr>,
    ctx: LoweringContext,
): Set<string> {
    const free = new Set<string>();
    const locallyDefined = new Set<string>();

    for (const expr of body) {
        walkExpression(expr, {
            enter(node) {
                if (node.kind === "ident") {
                    const name = node.name;
                    if (
                        !params.has(name) &&
                        !locallyDefined.has(name) &&
                        !ctx.constNames.has(name) &&
                        !ctx.fnNames.has(name) &&
                        !ctx.builtinNames.has(name) &&
                        !ctx.importedNames.has(name) &&
                        !free.has(name)
                    ) {
                        free.add(name);
                    }
                } else if (node.kind === "let") {
                    locallyDefined.add(node.name);
                } else if (node.kind === "lambda") {
                    // Recurse into nested lambda with its own param set
                    const innerParams = new Map<string, TypeExpr>();
                    for (const p of node.params) {
                        innerParams.set(p.name, p.type ?? UNKNOWN_TYPE);
                    }
                    const innerFree = collectFreeVars(node.body, innerParams, ctx);
                    for (const name of innerFree) {
                        if (
                            !params.has(name) &&
                            !locallyDefined.has(name) &&
                            !ctx.constNames.has(name) &&
                            !ctx.fnNames.has(name) &&
                            !ctx.builtinNames.has(name) &&
                            !ctx.importedNames.has(name)
                        ) {
                            free.add(name);
                        }
                    }
                    return false; // Don't recurse into lambda body — inner call handled it
                }
            },
        });
    }

    return free;
}

// =============================================================================
// Pattern Variable Binding
// =============================================================================

/**
 * Bind pattern variables into the arm scope for match expressions.
 */
function bindPatternVars(
    pattern: import("../ast/nodes.js").Pattern,
    targetType: TypeExpr,
    scope: FunctionScope,
    ctx: LoweringContext,
): void {
    switch (pattern.kind) {
        case "binding":
            scope.locals.set(pattern.name, targetType);
            break;
        case "wildcard":
        case "literal_pattern":
            break;
        case "constructor": {
            // Look up variant field types from enum definition
            const enumName = resolveTypeName(targetType);
            if (enumName) {
                const enumDef = ctx.enumDefs.get(enumName);
                if (enumDef) {
                    const variant = enumDef.variants.find(v => v.name === pattern.name);
                    if (variant) {
                        for (let i = 0; i < pattern.fields.length; i++) {
                            const fieldType = i < variant.fields.length
                                ? variant.fields[i]!.type
                                : UNKNOWN_TYPE;
                            bindPatternVars(pattern.fields[i]!, fieldType, scope, ctx);
                        }
                        return;
                    }
                }
            }
            // Fallback — bind sub-patterns as unknown
            for (const sub of pattern.fields) {
                bindPatternVars(sub, UNKNOWN_TYPE, scope, ctx);
            }
            break;
        }
    }
}

// =============================================================================
// Scope Helpers
// =============================================================================

/** Create a child scope inheriting params and locals. */
function childScope(parent: FunctionScope): FunctionScope {
    return {
        params: parent.params,
        locals: new Map(parent.locals),
        closureFreeVars: parent.closureFreeVars,
    };
}
