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
    fa: "forall",
    ex: "exists",

    // Type kinds
    b: "basic",
    // arr: "array",  -- already mapped above (same compact key)
    opt: "option",
    res: "result",
    ut: "unit_type",
    ref: "refined",
    ft: "fn_type",
    n: "named",
    cf: "confidence",
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
    ts: "types",
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
    rg: "range",
    fm: "from",
    to: "to",
};

// =============================================================================
// Detection
// =============================================================================

/**
 * Detect whether an AST value uses compact format.
 * A compact AST has `"k"` as a key instead of `"kind"`.
 *
 * @param ast - Any JSON value to test
 * @returns `true` if the value uses compact format keys
 */
export function isCompactAst(ast: unknown): boolean {
    if (ast === null || typeof ast !== "object" || Array.isArray(ast)) {
        return false;
    }
    const obj = ast as Record<string, unknown>;
    return "k" in obj && !("kind" in obj);
}

// =============================================================================
// Kind synonyms — common misspellings → canonical kinds
// =============================================================================

/** Maps common agent misspellings of kind values to their canonical form. */
export const KIND_SYNONYMS: Record<string, string> = {
    struct: "record",
    record_def: "record",
    function: "fn",
    func: "fn",
    constant: "const",
    enumeration: "enum",
};

// =============================================================================
// Context-aware auto-injection rules
// =============================================================================

/**
 * Maps parent field names to the child `kind` that should be injected.
 * For `fields`, the child kind depends on the parent node's kind —
 * see FIELD_PARENT_KIND_MAP below.
 */
const FIELD_TO_KIND: Record<string, string> = {
    variants: "variant",
    params: "param",
    arms: "arm",
};

/**
 * For the `fields` array, the child kind depends on the parent node's kind.
 * Record/variant-owned fields are `"field"` (with id).
 * Expression-owned fields are `"field_init"` (no id).
 */
const FIELD_PARENT_KIND_MAP: Record<string, string> = {
    record: "field",
    variant: "field",
    record_expr: "field_init",
    enum_constructor: "field_init",
};

/** Kinds that require an `id` field per the schema. */
const NEEDS_ID_KINDS = new Set([
    // Top-level
    "module", "fragment", "import",
    // Definitions
    "fn", "type", "record", "enum", "const", "tool",
    // Function components
    "param", "field", "variant", "pre", "post", "arm",
    // Expressions
    "literal", "ident", "binop", "unop", "call", "if", "let", "match",
    "array", "tuple_expr", "record_expr", "enum_constructor", "access",
    "lambda", "block", "string_interp", "forall", "exists", "tool_call",
    // Type (only refined has id)
    "refined",
]);

// =============================================================================
// Expansion + Normalization
// =============================================================================

/**
 * Recursively expand a compact-format AST to the canonical full format,
 * and normalize bare child nodes by auto-injecting `kind` and `id`.
 *
 * - Expands abbreviated keys (e.g., `"k"` → `"kind"`, `"rt"` → `"returnType"`)
 * - Expands abbreviated kind values (e.g., `"lit"` → `"literal"`, `"bin"` → `"binop"`)
 * - Maps kind synonyms (e.g., `"struct"` → `"record"`, `"function"` → `"fn"`)
 * - Auto-injects `kind` on bare objects in known structural arrays (variants, fields, params, arms)
 * - Auto-generates `id` when missing on nodes that require it
 * - Passes through full-format ASTs unchanged (idempotent)
 * - Unknown compact kinds pass through → validator will catch them
 *
 * @param ast - Any JSON value (compact or full format)
 * @returns The same AST with all compact abbreviations expanded to canonical form
 */
export function expandCompact(ast: unknown): unknown {
    let autoIdCounter = 0;

    function nextAutoId(kind: string): string {
        return `auto-${kind}-${String(++autoIdCounter).padStart(3, "0")}`;
    }

    function expand(
        value: unknown,
        parentFieldName?: string,
        parentKind?: string,
    ): unknown {
        if (value === null || value === undefined) {
            return value;
        }

        if (Array.isArray(value)) {
            return value.map((item) => expand(item, parentFieldName, parentKind));
        }

        if (typeof value !== "object") {
            return value;
        }

        const obj = value as Record<string, unknown>;

        // --- Step 1: Expand compact keys ---
        const hasCompactKind = "k" in obj && !("kind" in obj);

        const expanded: Record<string, unknown> = {};

        for (const [key, val] of Object.entries(obj)) {
            const fullKey = hasCompactKind && Object.hasOwn(KEY_MAP, key)
                ? KEY_MAP[key]!
                : key;

            let expandedValue: unknown;

            if (fullKey === "kind" && typeof val === "string" && Object.hasOwn(KIND_MAP, val)) {
                expandedValue = KIND_MAP[val];
            } else {
                // Don't recurse yet — we need the kind first
                expandedValue = val;
            }

            expanded[fullKey] = expandedValue;
        }

        // --- Step 2: Apply kind synonyms ---
        if (typeof expanded.kind === "string" && Object.hasOwn(KIND_SYNONYMS, expanded.kind)) {
            expanded.kind = KIND_SYNONYMS[expanded.kind as string];
        }

        // --- Step 3: Auto-inject kind on bare child nodes ---
        let autoInjectedKind = false;
        if (!("kind" in expanded) && parentFieldName) {
            let inferredKind: string | undefined;

            if (parentFieldName === "fields" && parentKind) {
                inferredKind = FIELD_PARENT_KIND_MAP[parentKind];
            } else {
                inferredKind = FIELD_TO_KIND[parentFieldName];
            }

            // Only inject if the object looks like a real node (has name or value)
            if (inferredKind && ("name" in expanded || "value" in expanded)) {
                expanded.kind = inferredKind;
                autoInjectedKind = true;
            }
        }

        // --- Step 4: Auto-inject id when auto-kind was injected ---
        const kind = expanded.kind as string | undefined;
        if (autoInjectedKind && kind && !("id" in expanded) && NEEDS_ID_KINDS.has(kind)) {
            expanded.id = nextAutoId(kind);
        }

        // --- Step 5: Recurse into children with context ---
        const currentKind = expanded.kind as string | undefined;

        for (const [key, val] of Object.entries(expanded)) {
            if (key === "kind" || key === "id") continue; // already handled
            expanded[key] = expand(val, key, currentKind);
        }

        return expanded;
    }

    return expand(ast);
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
