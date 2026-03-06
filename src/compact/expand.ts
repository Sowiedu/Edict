// =============================================================================
// Compact AST Expansion — compact → full format normalization
// =============================================================================
// Agents can submit ASTs using abbreviated keys and kind values to save tokens.
// This module detects compact format and expands it to the canonical full format
// before any pipeline stage sees it.
//
// Compact detection: presence of "k" key instead of "kind".
// Unknown compact kinds pass through unchanged — the validator will catch them.
// Full-format ASTs pass through unchanged (idempotent).

// =============================================================================
// Kind value mapping (compact → full)
// =============================================================================

/** Maps compact kind abbreviations to their full canonical kind strings. */
export const KIND_MAP: Record<string, string> = {
    // Top-level / definitions
    mod: "module",
    imp: "import",
    fn: "fn",
    ty: "type",
    rec: "record",
    en: "enum",
    co: "const",

    // Function components
    p: "param",
    f: "field",
    var: "variant",
    pre: "pre",
    post: "post",
    a: "arm",
    fi: "field_init",

    // Expressions
    lit: "literal",
    id: "ident",
    bin: "binop",
    un: "unop",
    c: "call",
    if: "if",
    let: "let",
    m: "match",
    arr: "array",
    tup: "tuple_expr",
    rexp: "record_expr",
    ec: "enum_constructor",
    acc: "access",
    lam: "lambda",
    blk: "block",
    si: "string_interp",

    // Type kinds
    b: "basic",
    // arr: "array",  -- already mapped above (same compact key)
    opt: "option",
    res: "result",
    ut: "unit_type",
    ref: "refined",
    ft: "fn_type",
    n: "named",
    // tup: "tuple",  -- already mapped above

    // Pattern kinds
    lp: "literal_pattern",
    w: "wildcard",
    bd: "binding",
    ct: "constructor",
};

// Note: "arr" maps to "array" and "tup" maps to "tuple_expr" above.
// For type contexts where "array" means the array type and "tuple" means the tuple type,
// this works because the validator distinguishes by context (expression vs type position).
// However, in types.ts, "tuple" (not "tuple_expr") is the kind string.
// We add these as separate entries below to handle both cases.
// The validator uses `kind: "array"` for both ArrayType and ArrayExpr,
// and `kind: "tuple"` for TupleType while `kind: "tuple_expr"` for TupleExpr.
// Since "tup" maps to "tuple_expr", we need nothing special — the full kind "tuple"
// is already short enough that agents don't need to abbreviate it.
// But we still handle it for completeness:

// Add the type-specific tuple mapping (the type kind is "tuple", not "tuple_expr")
// Since "tup" is taken by "tuple_expr", agents use the full "tuple" for TupleType.
// No additional mapping needed — "tuple" passes through unchanged.

// =============================================================================
// Field key mapping (compact → full)
// =============================================================================

/** Maps compact field key abbreviations to their full canonical field names. */
export const KEY_MAP: Record<string, string> = {
    k: "kind",
    i: "id",
    n: "name",
    v: "value",
    ps: "params",
    as: "args",
    b: "body",
    fx: "effects",
    rt: "returnType",
    ct: "contracts",
    im: "imports",
    ds: "definitions",
    fs: "fields",
    vs: "variants",
    es: "elements",
    cd: "condition",
    tg: "target",
    od: "operand",
    l: "left",
    r: "right",
    th: "then",
    el: "else",
    t: "type",
    df: "definition",
    md: "module",
    ns: "names",
    en: "enumName",
    vr: "variant",
    fd: "field",
    pt: "pattern",
    am: "arms",
    pa: "parts",
    in: "inner",
    ok: "ok",
    er: "err",
    bs: "base",
    u: "unit",
    vb: "variable",
    pr: "predicate",
    dv: "defaultValue",
    fn: "fn",
    op: "op",
};

// =============================================================================
// Detection
// =============================================================================

/**
 * Detect whether an AST value uses compact format.
 * A compact AST has "k" as a key instead of "kind".
 */
export function isCompactAst(ast: unknown): boolean {
    if (ast === null || typeof ast !== "object" || Array.isArray(ast)) {
        return false;
    }
    const obj = ast as Record<string, unknown>;
    return "k" in obj && !("kind" in obj);
}

// =============================================================================
// Expansion
// =============================================================================

/**
 * Recursively expand a compact-format AST to the canonical full format.
 *
 * - Expands abbreviated keys (e.g., "k" → "kind", "rt" → "returnType")
 * - Expands abbreviated kind values (e.g., "lit" → "literal", "bin" → "binop")
 * - Passes through full-format ASTs unchanged (idempotent)
 * - Unknown compact kinds pass through → validator will catch them
 */
export function expandCompact(ast: unknown): unknown {
    if (ast === null || ast === undefined) {
        return ast;
    }

    if (Array.isArray(ast)) {
        return ast.map(expandCompact);
    }

    if (typeof ast !== "object") {
        return ast;
    }

    const obj = ast as Record<string, unknown>;

    // If the object has "kind" (full format), still recurse into children
    // but don't remap keys at this level
    const hasCompactKind = "k" in obj && !("kind" in obj);

    const expanded: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
        // Expand the key (only remap if this object uses compact format)
        const fullKey = hasCompactKind && Object.hasOwn(KEY_MAP, key)
            ? KEY_MAP[key]!
            : key;

        // Expand the value
        let expandedValue: unknown;

        if (fullKey === "kind" && typeof value === "string" && Object.hasOwn(KIND_MAP, value)) {
            // Expand compact kind value (only if explicitly in our map)
            expandedValue = KIND_MAP[value];
        } else {
            // Recurse into child values
            expandedValue = expandCompact(value);
        }

        expanded[fullKey] = expandedValue;
    }

    return expanded;
}

// =============================================================================
// Compact schema reference (for edict_schema format: "compact")
// =============================================================================

/** Returns the compact format reference as a structured object. */
export function compactSchemaReference(): {
    kindMap: Record<string, string>;
    keyMap: Record<string, string>;
    description: string;
} {
    return {
        description:
            "Compact AST format reference. Use abbreviated keys and kind values to reduce token cost. " +
            "Submit compact ASTs to any tool that accepts an AST (edict_validate, edict_check, edict_compile, edict_patch, edict_lint). " +
            "The compiler auto-detects and expands compact format before processing.",
        kindMap: { ...KIND_MAP },
        keyMap: { ...KEY_MAP },
    };
}
