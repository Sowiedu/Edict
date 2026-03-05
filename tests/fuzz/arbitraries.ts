/**
 * fast-check arbitraries that produce random Edict AST fragments.
 *
 * These generators are "structure-aware" — they produce JSON objects
 * that look like real AST nodes but with random content, exercising
 * far more of the validator/resolver/checker surface than raw fc.anything().
 */
import * as fc from "fast-check";
import {
    VALID_EXPRESSION_KINDS,
    VALID_DEFINITION_KINDS,
    VALID_BINARY_OPS,
    VALID_UNARY_OPS,
    VALID_EFFECTS,
    VALID_BASIC_TYPE_NAMES,
} from "../../src/ast/nodes.js";

// =============================================================================
// ID generator
// =============================================================================
let idCounter = 0;
export function resetIdCounter() { idCounter = 0; }

const arbId = fc.constantFrom("a", "b", "c", "d", "e").map(
    (prefix) => `${prefix}-${idCounter++}`,
);

// =============================================================================
// Type expression arbitrary
// =============================================================================
export const arbBasicType = fc.constantFrom(...VALID_BASIC_TYPE_NAMES).map(
    (name) => ({ kind: "basic" as const, name }),
);

export const arbArrayType = arbBasicType.map((element) => ({
    kind: "array" as const,
    element,
}));

export const arbOptionType = arbBasicType.map((inner) => ({
    kind: "option" as const,
    inner,
}));

export const arbTypeExpr = fc.oneof(
    arbBasicType,
    arbArrayType,
    arbOptionType,
);

// =============================================================================
// Param arbitrary
// =============================================================================
export const arbParam = fc.tuple(
    fc.constantFrom("x", "y", "z", "a", "b", "n", "m"),
    arbBasicType,
    arbId,
).map(([name, type, id]) => ({
    kind: "param" as const,
    id,
    name,
    type,
}));

// =============================================================================
// Expression arbitraries — recursive tree
// =============================================================================

/** Leaf expressions (no children) */
export const arbLiteral = fc.tuple(
    fc.oneof(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
        fc.string({ minLength: 0, maxLength: 50 }),
        fc.boolean(),
    ),
    arbId,
).map(([value, id]) => ({ kind: "literal" as const, id, value }));

export const arbIdent = fc.tuple(
    fc.constantFrom("x", "y", "z", "a", "b", "n", "m", "main", "helper", "foo", "unknown_name"),
    arbId,
).map(([name, id]) => ({ kind: "ident" as const, id, name }));

/** Build a recursive expression tree with controlled depth */
export function arbExpression(maxDepth: number = 3): fc.Arbitrary<unknown> {
    if (maxDepth <= 0) {
        return fc.oneof(arbLiteral, arbIdent);
    }

    const sub = () => arbExpression(maxDepth - 1);

    return fc.oneof(
        // Leaves
        arbLiteral,
        arbIdent,

        // Binop
        fc.tuple(
            fc.constantFrom(...VALID_BINARY_OPS),
            sub(),
            sub(),
            arbId,
        ).map(([op, left, right, id]) => ({
            kind: "binop", id, op, left, right,
        })),

        // Unop
        fc.tuple(
            fc.constantFrom(...VALID_UNARY_OPS),
            sub(),
            arbId,
        ).map(([op, operand, id]) => ({
            kind: "unop", id, op, operand,
        })),

        // Call
        fc.tuple(
            fc.constantFrom("print", "abs", "min", "max", "intToString", "string_length"),
            fc.array(sub(), { minLength: 0, maxLength: 3 }),
            arbId,
        ).map(([fnName, args, id]) => ({
            kind: "call", id,
            fn: { kind: "ident", id: `ci-${idCounter++}`, name: fnName },
            args,
        })),

        // If
        fc.tuple(sub(), sub(), sub(), arbId).map(
            ([cond, thenBranch, elseBranch, id]) => ({
                kind: "if", id,
                condition: cond,
                then: [thenBranch],
                else: [elseBranch],
            }),
        ),

        // Let
        fc.tuple(
            fc.constantFrom("tmp", "val", "res"),
            arbBasicType,
            sub(),
            arbId,
        ).map(([name, type, value, id]) => ({
            kind: "let", id, name, type, value,
        })),

        // Array expression
        fc.tuple(
            fc.array(sub(), { minLength: 0, maxLength: 4 }),
            arbId,
        ).map(([elements, id]) => ({
            kind: "array", id, elements,
        })),

        // Block
        fc.tuple(
            fc.array(sub(), { minLength: 1, maxLength: 3 }),
            arbId,
        ).map(([body, id]) => ({
            kind: "block", id, body,
        })),

        // Match — simplified (literal patterns only)
        fc.tuple(
            sub(),
            fc.array(
                fc.tuple(fc.integer({ min: 0, max: 10 }), sub(), arbId).map(
                    ([patVal, body, armId]) => ({
                        kind: "arm", id: armId,
                        pattern: { kind: "literal_pattern", value: patVal },
                        body: [body],
                    }),
                ),
                { minLength: 1, maxLength: 4 },
            ),
            arbId,
        ).map(([target, arms, id]) => {
            // Always add a wildcard arm at the end
            arms.push({
                kind: "arm", id: `wa-${idCounter++}`,
                pattern: { kind: "wildcard" },
                body: [{ kind: "literal", id: `wl-${idCounter++}`, value: 0 }],
            });
            return { kind: "match", id, target, arms };
        }),

        // Lambda
        fc.tuple(
            fc.array(arbParam, { minLength: 0, maxLength: 2 }),
            fc.array(sub(), { minLength: 1, maxLength: 2 }),
            arbId,
        ).map(([params, body, id]) => ({
            kind: "lambda", id, params, body,
        })),
    );
}

// =============================================================================
// Function definition arbitrary
// =============================================================================
export function arbFunctionDef(options: {
    maxBodyDepth?: number;
    maxParams?: number;
    maxBodySize?: number;
} = {}): fc.Arbitrary<unknown> {
    const { maxBodyDepth = 2, maxParams = 3, maxBodySize = 3 } = options;

    return fc.tuple(
        fc.constantFrom("main", "helper", "compute", "process", "transform"),
        fc.array(arbParam, { minLength: 0, maxLength: maxParams }),
        fc.subarray([...VALID_EFFECTS], { minLength: 1, maxLength: 3 }),
        arbBasicType,
        fc.array(arbExpression(maxBodyDepth), { minLength: 1, maxLength: maxBodySize }),
        arbId,
    ).map(([name, params, effects, returnType, body, id]) => {
        // Fix conflicting effects: if "pure" is present with others, keep only "pure"
        const fixedEffects = effects.includes("pure") ? ["pure"] : effects;
        return {
            kind: "fn", id, name,
            params,
            effects: fixedEffects,
            returnType,
            contracts: [],
            body,
        };
    });
}

// =============================================================================
// Module arbitrary
// =============================================================================
export function arbModule(options: {
    maxFunctions?: number;
    maxBodyDepth?: number;
} = {}): fc.Arbitrary<unknown> {
    const { maxFunctions = 3, maxBodyDepth = 2 } = options;

    return fc.tuple(
        fc.array(arbFunctionDef({ maxBodyDepth }), {
            minLength: 1,
            maxLength: maxFunctions,
        }),
        arbId,
    ).map(([definitions, id]) => ({
        kind: "module",
        id,
        name: "fuzz_module",
        imports: [],
        definitions,
    }));
}

// =============================================================================
// "Almost valid" mutators — realistic agent mistakes
// =============================================================================

/** Produce a valid module then randomly corrupt one aspect */
export function arbCorruptedModule(): fc.Arbitrary<unknown> {
    return fc.tuple(
        arbModule({ maxFunctions: 2, maxBodyDepth: 1 }),
        fc.constantFrom(
            "duplicate_id",
            "wrong_kind",
            "missing_body",
            "null_field",
            "extra_field",
            "wrong_type_shape",
            "empty_effects",
        ),
    ).map(([module, corruption]) => {
        const m = JSON.parse(JSON.stringify(module)) as Record<string, unknown>;
        const defs = m.definitions as Record<string, unknown>[];

        if (defs.length === 0) return m;
        const fn = defs[0];

        switch (corruption) {
            case "duplicate_id":
                // Set function ID = module ID
                fn.id = m.id;
                break;
            case "wrong_kind":
                fn.kind = "function"; // wrong — should be "fn"
                break;
            case "missing_body":
                delete fn.body;
                break;
            case "null_field":
                fn.returnType = null;
                break;
            case "extra_field":
                (fn as Record<string, unknown>).unknownField = "surprise";
                break;
            case "wrong_type_shape":
                fn.returnType = "Int"; // string instead of object
                break;
            case "empty_effects":
                fn.effects = [];
                break;
        }
        return m;
    });
}
