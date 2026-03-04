// =============================================================================
// String Literal Collector — Pre-scan AST for string interning
// =============================================================================
// Walks the AST before code generation to find all string literals,
// so they can be pre-interned into the string table at known offsets.

import type { Expression } from "../ast/nodes.js";
import type { StringTable } from "./string-table.js";

export function collectStrings(exprs: Expression[], strings: StringTable): void {
    for (const expr of exprs) {
        collectStringExpr(expr, strings);
    }
}

function collectStringExpr(expr: Expression, strings: StringTable): void {
    switch (expr.kind) {
        case "literal":
            if (typeof expr.value === "string") {
                strings.intern(expr.value);
            }
            break;
        case "binop":
            collectStringExpr(expr.left, strings);
            collectStringExpr(expr.right, strings);
            break;
        case "unop":
            collectStringExpr(expr.operand, strings);
            break;
        case "call":
            collectStringExpr(expr.fn, strings);
            for (const arg of expr.args) collectStringExpr(arg, strings);
            break;
        case "if":
            collectStringExpr(expr.condition, strings);
            collectStrings(expr.then, strings);
            if (expr.else) collectStrings(expr.else, strings);
            break;
        case "let":
            collectStringExpr(expr.value, strings);
            break;
        case "block":
            collectStrings(expr.body, strings);
            break;
        case "match":
            collectStringExpr(expr.target, strings);
            for (const arm of expr.arms) collectStrings(arm.body, strings);
            break;
        case "lambda":
            collectStrings(expr.body, strings);
            break;
        case "record_expr":
            for (const field of expr.fields) {
                collectStringExpr(field.value, strings);
            }
            break;
        case "tuple_expr":
            for (const el of expr.elements) {
                collectStringExpr(el, strings);
            }
            break;
        case "enum_constructor":
            for (const field of expr.fields) {
                collectStringExpr(field.value, strings);
            }
            break;
        case "access":
            collectStringExpr(expr.target, strings);
            break;
        case "string_interp":
            for (const part of expr.parts) {
                collectStringExpr(part, strings);
            }
            break;
        // ident, array — no string literals directly
    }
}
