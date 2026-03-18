// =============================================================================
// SMT Expression Types — Internal representation for the built-in QF-LIA solver
// =============================================================================
// These types represent the SMT expression tree manipulated by the solver.
// They mirror the Z3 API operations used in translate.ts but are pure data
// structures (no solver state, no WASM).

// ---------------------------------------------------------------------------
// Sorts
// ---------------------------------------------------------------------------

export type Sort = "Int" | "Bool" | "Real";

export interface SortDescriptor {
    name(): string;
}

export function makeSortDescriptor(sort: Sort): SortDescriptor {
    return { name: () => sort };
}

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

export type Expr =
    | IntConst | IntVar
    | BoolConst | BoolVar
    | RealConst | RealVar
    | BinOp | UnOp
    | CompOp | BoolBinOp | BoolNot
    | IteExpr
    | EqExpr | NeqExpr;

// --- Atomic expressions ---

export interface IntConst { readonly tag: "int_const"; readonly value: number; }
export interface IntVar   { readonly tag: "int_var";   readonly name: string; }
export interface BoolConst{ readonly tag: "bool_const"; readonly value: boolean; }
export interface BoolVar  { readonly tag: "bool_var";  readonly name: string; }
export interface RealConst{ readonly tag: "real_const"; readonly value: number; }
export interface RealVar  { readonly tag: "real_var";  readonly name: string; }

// --- Arithmetic operations ---

export type ArithOp = "add" | "sub" | "mul" | "div" | "mod" | "neg";

export interface BinOp {
    readonly tag: "binop";
    readonly op: "add" | "sub" | "mul" | "div" | "mod";
    readonly left: Expr;
    readonly right: Expr;
    readonly sort: Sort;
}

export interface UnOp {
    readonly tag: "unop";
    readonly op: "neg";
    readonly operand: Expr;
    readonly sort: Sort;
}

// --- Comparison operations ---

export type CmpOp = "lt" | "gt" | "le" | "ge";

export interface CompOp {
    readonly tag: "cmp";
    readonly op: CmpOp;
    readonly left: Expr;
    readonly right: Expr;
}

// --- Equality ---

export interface EqExpr {
    readonly tag: "eq";
    readonly left: Expr;
    readonly right: Expr;
}

export interface NeqExpr {
    readonly tag: "neq";
    readonly left: Expr;
    readonly right: Expr;
}

// --- Boolean operations ---

export interface BoolBinOp {
    readonly tag: "bool_binop";
    readonly op: "and" | "or" | "implies";
    readonly args: Expr[];
}

export interface BoolNot {
    readonly tag: "bool_not";
    readonly operand: Expr;
}

// --- If-then-else ---

export interface IteExpr {
    readonly tag: "ite";
    readonly cond: Expr;
    readonly thenExpr: Expr;
    readonly elseExpr: Expr;
}

// ---------------------------------------------------------------------------
// Expression constructors — produce Z3-compatible "fluent" expression objects
// ---------------------------------------------------------------------------

/**
 * Wrap an internal Expr as a Z3-API-compatible expression object.
 * These objects have methods like .add(), .sub(), .eq(), etc.,
 * matching the Z3 Context API surface used by translate.ts.
 */
export function wrapExpr(e: Expr, sort: Sort): any {
    const wrapped: any = {
        __expr: e,
        sort: makeSortDescriptor(sort),
        toString() {
            return exprToString(e);
        },
        eq(other: any): any {
            return wrapExpr(
                { tag: "eq", left: e, right: unwrap(other) },
                "Bool",
            );
        },
        neq(other: any): any {
            return wrapExpr(
                { tag: "neq", left: e, right: unwrap(other) },
                "Bool",
            );
        },
    };

    if (sort === "Int" || sort === "Real") {
        wrapped.add = (other: any) => wrapExpr(
            { tag: "binop", op: "add", left: e, right: unwrap(other), sort },
            sort,
        );
        wrapped.sub = (other: any) => wrapExpr(
            { tag: "binop", op: "sub", left: e, right: unwrap(other), sort },
            sort,
        );
        wrapped.mul = (other: any) => wrapExpr(
            { tag: "binop", op: "mul", left: e, right: unwrap(other), sort },
            sort,
        );
        wrapped.div = (other: any) => wrapExpr(
            { tag: "binop", op: "div", left: e, right: unwrap(other), sort },
            sort,
        );
        if (sort === "Int") {
            wrapped.mod = (other: any) => wrapExpr(
                { tag: "binop", op: "mod", left: e, right: unwrap(other), sort: "Int" },
                "Int",
            );
        }
        wrapped.neg = () => wrapExpr(
            { tag: "unop", op: "neg", operand: e, sort },
            sort,
        );
        wrapped.lt = (other: any) => wrapExpr(
            { tag: "cmp", op: "lt", left: e, right: unwrap(other) },
            "Bool",
        );
        wrapped.gt = (other: any) => wrapExpr(
            { tag: "cmp", op: "gt", left: e, right: unwrap(other) },
            "Bool",
        );
        wrapped.le = (other: any) => wrapExpr(
            { tag: "cmp", op: "le", left: e, right: unwrap(other) },
            "Bool",
        );
        wrapped.ge = (other: any) => wrapExpr(
            { tag: "cmp", op: "ge", left: e, right: unwrap(other) },
            "Bool",
        );
    }

    return wrapped;
}

/** Unwrap a fluent expression object back to the internal Expr. */
export function unwrap(e: any): Expr {
    if (e && typeof e === "object" && "__expr" in e) return e.__expr as Expr;
    // Literal numbers/booleans passed directly
    if (typeof e === "number") return { tag: "int_const", value: e };
    if (typeof e === "boolean") return { tag: "bool_const", value: e };
    throw new Error(`Cannot unwrap expression: ${e}`);
}

/** Render expression for counterexample display. */
function exprToString(e: Expr): string {
    switch (e.tag) {
        case "int_const": return String(e.value);
        case "real_const": return String(e.value);
        case "bool_const": return String(e.value);
        case "int_var": return e.name;
        case "bool_var": return e.name;
        case "real_var": return e.name;
        case "binop": return `(${exprToString(e.left)} ${e.op} ${exprToString(e.right)})`;
        case "unop": return `(-${exprToString(e.operand)})`;
        case "cmp": return `(${exprToString(e.left)} ${e.op} ${exprToString(e.right)})`;
        case "eq": return `(${exprToString(e.left)} == ${exprToString(e.right)})`;
        case "neq": return `(${exprToString(e.left)} != ${exprToString(e.right)})`;
        case "bool_binop": return `(${e.args.map(exprToString).join(` ${e.op} `)})`;
        case "bool_not": return `(not ${exprToString(e.operand)})`;
        case "ite": return `(if ${exprToString(e.cond)} then ${exprToString(e.thenExpr)} else ${exprToString(e.elseExpr)})`;
    }
}

// ---------------------------------------------------------------------------
// Variable collection
// ---------------------------------------------------------------------------

/** Collect all variable names and their sorts from an expression tree. */
export function collectVariables(e: Expr): Map<string, Sort> {
    const vars = new Map<string, Sort>();
    function walk(expr: Expr) {
        switch (expr.tag) {
            case "int_var": vars.set(expr.name, "Int"); break;
            case "bool_var": vars.set(expr.name, "Bool"); break;
            case "real_var": vars.set(expr.name, "Real"); break;
            case "binop": walk(expr.left); walk(expr.right); break;
            case "unop": walk(expr.operand); break;
            case "cmp": walk(expr.left); walk(expr.right); break;
            case "eq": walk(expr.left); walk(expr.right); break;
            case "neq": walk(expr.left); walk(expr.right); break;
            case "bool_binop": expr.args.forEach(walk); break;
            case "bool_not": walk(expr.operand); break;
            case "ite": walk(expr.cond); walk(expr.thenExpr); walk(expr.elseExpr); break;
            default: break;
        }
    }
    walk(e);
    return vars;
}
