// =============================================================================
// Pure-JS WASM Binary Encoder — binaryen-compatible API
// =============================================================================
// Replaces the binaryen npm package with a lightweight, pure-JavaScript WASM
// binary encoder. Designed for Edict's codegen needs (WASM MVP subset).
// No native dependencies, no top-level await, runs anywhere.
//
// Architecture:
//   - ExpressionRef = opaque integer index into an expression node pool
//   - Expression nodes store opcode + operands (children are ExpressionRef IDs)
//   - emitBinary() serializes the module into WASM binary format
//   - emitText() produces basic WAT for test compatibility

// =============================================================================
// Type Constants
// =============================================================================

export type Type = number;
export type ExpressionRef = number;

/** WASM i32 value type */
export const i32: Type = 0x7F;
/** WASM i64 value type */
export const i64: Type = 0x7E;
/** WASM f64 value type */
export const f64: Type = 0x7C;
/** WASM void / empty block type */
export const none: Type = 0x40;

// Composite type handles (≥ 0x100) — outside single-valtype range
let nextCompositeHandle = 0x100;
const compositeTypeRegistry = new Map<number, Type[]>();

/** Pack multiple types into a single Type handle (for function params). */
export function createType(types: Type[]): Type {
    for (const [handle, existing] of Array.from(compositeTypeRegistry.entries())) {
        if (existing.length === types.length && existing.every((t, i) => t === types[i])) {
            return handle;
        }
    }
    const handle = nextCompositeHandle++;
    compositeTypeRegistry.set(handle, [...types]);
    return handle;
}

/** Expand a Type to its constituent types. */
function expandType(t: Type): Type[] {
    if (t >= 0x100) {
        const types = compositeTypeRegistry.get(t);
        if (types) return types;
    }
    if (t === none) return [];
    return [t];
}

// =============================================================================
// MemorySegment interface (matches binaryen)
// =============================================================================

export interface MemorySegment {
    offset: ExpressionRef;
    data: Uint8Array;
    passive: boolean;
}

// =============================================================================
// LEB128 Encoding
// =============================================================================

function encodeU32(value: number): number[] {
    const bytes: number[] = [];
    do {
        let byte = value & 0x7F;
        value >>>= 7;
        if (value !== 0) byte |= 0x80;
        bytes.push(byte);
    } while (value !== 0);
    return bytes;
}

function encodeI32(value: number): number[] {
    value |= 0; // coerce to signed i32
    const bytes: number[] = [];
    let more = true;
    while (more) {
        let byte = value & 0x7F;
        value >>= 7;
        if ((value === 0 && (byte & 0x40) === 0) || (value === -1 && (byte & 0x40) !== 0)) {
            more = false;
        } else {
            byte |= 0x80;
        }
        bytes.push(byte);
    }
    return bytes;
}

function encodeI64(low: number, high: number): number[] {
    // Reconstruct signed 64-bit value from two unsigned 32-bit halves.
    // The high word may represent a signed value (e.g., 0xFFFFFFFF = -1),
    // so we must sign-extend it before shifting.
    const lo = BigInt(low >>> 0);
    // Sign-extend high: if bit 31 is set, it's negative in i32
    const hi = BigInt(high | 0); // coerce to signed i32
    let value = (hi << 32n) | lo;
    const bytes: number[] = [];
    let more = true;
    while (more) {
        let byte = Number(value & 0x7Fn);
        value >>= 7n;
        if ((value === 0n && (byte & 0x40) === 0) || (value === -1n && (byte & 0x40) !== 0)) {
            more = false;
        } else {
            byte |= 0x80;
        }
        bytes.push(byte);
    }
    return bytes;
}

function encodeF64(value: number): number[] {
    const buf = new ArrayBuffer(8);
    new Float64Array(buf)[0] = value;
    return Array.from(new Uint8Array(buf));
}

function encodeString(s: string): number[] {
    const encoded = new TextEncoder().encode(s);
    return [...encodeU32(encoded.length), ...Array.from(encoded)];
}

// =============================================================================
// WASM Opcodes
// =============================================================================

const OP = {
    UNREACHABLE: 0x00, NOP: 0x01, BLOCK: 0x02, LOOP: 0x03, IF: 0x04,
    ELSE: 0x05, END: 0x0B, BR: 0x0C, BR_IF: 0x0D, CALL: 0x10,
    CALL_INDIRECT: 0x11, DROP: 0x1A,
    LOCAL_GET: 0x20, LOCAL_SET: 0x21, GLOBAL_GET: 0x23, GLOBAL_SET: 0x24,
    I32_LOAD: 0x28, I64_LOAD: 0x29, F64_LOAD: 0x2B, I32_LOAD8_U: 0x2D,
    I32_STORE: 0x36, I64_STORE: 0x37, F64_STORE: 0x39, I32_STORE8: 0x3A,
    I32_CONST: 0x41, I64_CONST: 0x42, F64_CONST: 0x44,
    I32_EQZ: 0x45, I32_EQ: 0x46, I32_NE: 0x47,
    I32_LT_S: 0x48, I32_GT_S: 0x4A, I32_LE_S: 0x4C, I32_GE_S: 0x4E, I32_GE_U: 0x4F,
    I64_EQ: 0x51, I64_NE: 0x52,
    I64_LT_S: 0x53, I64_GT_S: 0x55, I64_LE_S: 0x57, I64_GE_S: 0x59,
    F64_EQ: 0x61, F64_NE: 0x62, F64_LT: 0x63, F64_GT: 0x64,
    F64_LE: 0x65, F64_GE: 0x66,
    I32_ADD: 0x6A, I32_SUB: 0x6B, I32_MUL: 0x6C, I32_DIV_S: 0x6D,
    I32_REM_S: 0x6F, I32_AND: 0x71, I32_OR: 0x72,
    I64_ADD: 0x7C, I64_SUB: 0x7D, I64_MUL: 0x7E, I64_DIV_S: 0x7F,
    I64_REM_S: 0x81,
    F64_NEG: 0x9A, F64_ADD: 0xA0, F64_SUB: 0xA1, F64_MUL: 0xA2, F64_DIV: 0xA3,
    F64_CONVERT_I32_S: 0xB7,
} as const;

// Opcode name table for WAT emission
const OP_NAMES: Record<number, string> = {
    [OP.UNREACHABLE]: "unreachable", [OP.NOP]: "nop", [OP.DROP]: "drop",
    [OP.I32_EQZ]: "i32.eqz", [OP.I32_EQ]: "i32.eq", [OP.I32_NE]: "i32.ne",
    [OP.I32_LT_S]: "i32.lt_s", [OP.I32_GT_S]: "i32.gt_s",
    [OP.I32_LE_S]: "i32.le_s", [OP.I32_GE_S]: "i32.ge_s",
    [OP.I32_ADD]: "i32.add", [OP.I32_SUB]: "i32.sub", [OP.I32_MUL]: "i32.mul",
    [OP.I32_DIV_S]: "i32.div_s", [OP.I32_REM_S]: "i32.rem_s",
    [OP.I32_AND]: "i32.and", [OP.I32_OR]: "i32.or",
    [OP.I64_EQ]: "i64.eq", [OP.I64_NE]: "i64.ne",
    [OP.I64_LT_S]: "i64.lt_s", [OP.I64_GT_S]: "i64.gt_s",
    [OP.I64_LE_S]: "i64.le_s", [OP.I64_GE_S]: "i64.ge_s",
    [OP.I64_ADD]: "i64.add", [OP.I64_SUB]: "i64.sub", [OP.I64_MUL]: "i64.mul",
    [OP.I64_DIV_S]: "i64.div_s", [OP.I64_REM_S]: "i64.rem_s",
    [OP.F64_EQ]: "f64.eq", [OP.F64_NE]: "f64.ne", [OP.F64_LT]: "f64.lt",
    [OP.F64_GT]: "f64.gt", [OP.F64_LE]: "f64.le", [OP.F64_GE]: "f64.ge",
    [OP.F64_ADD]: "f64.add", [OP.F64_SUB]: "f64.sub", [OP.F64_MUL]: "f64.mul",
    [OP.F64_DIV]: "f64.div", [OP.F64_NEG]: "f64.neg",
    [OP.F64_CONVERT_I32_S]: "f64.convert_i32_s",
};

const TYPE_NAMES: Record<number, string> = {
    [i32]: "i32", [i64]: "i64", [f64]: "f64",
};

// =============================================================================
// Expression Node Pool
// =============================================================================

interface ExprNode {
    op: number;
    children: ExpressionRef[];
    iVal?: number;           // i32.const value
    i64Low?: number;         // i64.const low 32 bits
    i64High?: number;        // i64.const high 32 bits
    fVal?: number;           // f64.const value
    localIdx?: number;       // local.get/set index
    globalName?: string;     // global.get/set name
    globalType?: Type;       // global type (for get)
    label?: string | null;   // block/loop/if label
    blockType?: Type;        // block/if/loop result type
    fnName?: string;         // call function name
    tableName?: string;      // call_indirect table name
    paramType?: Type;        // call_indirect param type
    resultType?: Type;       // call/call_indirect result type
    memOffset?: number;      // load/store offset
    memAlign?: number;       // load/store align
}

// =============================================================================
// Module Internal Types
// =============================================================================

interface FuncDef {
    name: string;
    paramType: Type;
    resultType: Type;
    vars: Type[];
    body: ExpressionRef;
}

interface ImportDef {
    name: string;
    module: string;
    base: string;
    paramType: Type;
    resultType: Type;
}

interface ExportDef {
    name: string;
    externalName: string;
    kind: "func" | "memory";
}

interface GlobalDef {
    name: string;
    type: Type;
    mutable: boolean;
    init: ExpressionRef;
}

interface TableDef {
    name: string;
    initial: number;
    max: number;
}

interface ElemSegDef {
    table: string;
    name: string;
    funcs: string[];
    offset: ExpressionRef;
}

interface MemoryDef {
    initial: number;
    max: number;
    exportName: string;
    segments: MemorySegment[];
}

// =============================================================================
// Module Class
// =============================================================================

export class Module {
    private nodes: ExprNode[] = [];
    private functions: FuncDef[] = [];
    private imports: ImportDef[] = [];
    private exports: ExportDef[] = [];
    private globals: GlobalDef[] = [];
    private table: TableDef | null = null;
    private elemSegments: ElemSegDef[] = [];
    private memory: MemoryDef | null = null;
    private memoryImport: { name: string; module: string; base: string } | null = null;

    // ─── Expression node allocation ──────────────────────────────────
    private addNode(node: ExprNode): ExpressionRef {
        this.nodes.push(node);
        return this.nodes.length - 1;
    }

    // ─── i32 operations ──────────────────────────────────────────────
    readonly i32 = {
        const: (value: number): ExpressionRef =>
            this.addNode({ op: OP.I32_CONST, children: [], iVal: value }),
        add: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.I32_ADD, children: [a, b] }),
        sub: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.I32_SUB, children: [a, b] }),
        mul: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.I32_MUL, children: [a, b] }),
        div_s: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.I32_DIV_S, children: [a, b] }),
        rem_s: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.I32_REM_S, children: [a, b] }),
        eq: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.I32_EQ, children: [a, b] }),
        ne: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.I32_NE, children: [a, b] }),
        lt_s: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.I32_LT_S, children: [a, b] }),
        gt_s: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.I32_GT_S, children: [a, b] }),
        le_s: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.I32_LE_S, children: [a, b] }),
        ge_s: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.I32_GE_S, children: [a, b] }),
        ge_u: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.I32_GE_U, children: [a, b] }),
        and: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.I32_AND, children: [a, b] }),
        or: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.I32_OR, children: [a, b] }),
        eqz: (a: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.I32_EQZ, children: [a] }),
        load: (offset: number, align: number, ptr: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.I32_LOAD, children: [ptr], memOffset: offset, memAlign: align }),
        store: (offset: number, align: number, ptr: ExpressionRef, value: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.I32_STORE, children: [ptr, value], memOffset: offset, memAlign: align }),
        load8_u: (offset: number, align: number, ptr: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.I32_LOAD8_U, children: [ptr], memOffset: offset, memAlign: align }),
        store8: (offset: number, align: number, ptr: ExpressionRef, value: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.I32_STORE8, children: [ptr, value], memOffset: offset, memAlign: align }),
    };

    // ─── i64 operations ──────────────────────────────────────────────
    readonly i64 = {
        const: (low: number, high: number): ExpressionRef =>
            this.addNode({ op: OP.I64_CONST, children: [], i64Low: low, i64High: high }),
        add: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.I64_ADD, children: [a, b] }),
        sub: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.I64_SUB, children: [a, b] }),
        mul: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.I64_MUL, children: [a, b] }),
        div_s: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.I64_DIV_S, children: [a, b] }),
        rem_s: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.I64_REM_S, children: [a, b] }),
        eq: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.I64_EQ, children: [a, b] }),
        ne: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.I64_NE, children: [a, b] }),
        lt_s: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.I64_LT_S, children: [a, b] }),
        gt_s: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.I64_GT_S, children: [a, b] }),
        le_s: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.I64_LE_S, children: [a, b] }),
        ge_s: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.I64_GE_S, children: [a, b] }),
    };

    // ─── f64 operations ──────────────────────────────────────────────
    readonly f64 = {
        const: (value: number): ExpressionRef =>
            this.addNode({ op: OP.F64_CONST, children: [], fVal: value }),
        add: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.F64_ADD, children: [a, b] }),
        sub: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.F64_SUB, children: [a, b] }),
        mul: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.F64_MUL, children: [a, b] }),
        div: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.F64_DIV, children: [a, b] }),
        eq: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.F64_EQ, children: [a, b] }),
        ne: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.F64_NE, children: [a, b] }),
        lt: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.F64_LT, children: [a, b] }),
        gt: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.F64_GT, children: [a, b] }),
        le: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.F64_LE, children: [a, b] }),
        ge: (a: ExpressionRef, b: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.F64_GE, children: [a, b] }),
        neg: (a: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.F64_NEG, children: [a] }),
        convert_s: {
            i32: (a: ExpressionRef): ExpressionRef =>
                this.addNode({ op: OP.F64_CONVERT_I32_S, children: [a] }),
        },
        load: (offset: number, align: number, ptr: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.F64_LOAD, children: [ptr], memOffset: offset, memAlign: align }),
        store: (offset: number, align: number, ptr: ExpressionRef, value: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.F64_STORE, children: [ptr, value], memOffset: offset, memAlign: align }),
    };

    // ─── Local variable operations ───────────────────────────────────
    readonly local = {
        get: (index: number, type: Type): ExpressionRef =>
            this.addNode({ op: OP.LOCAL_GET, children: [], localIdx: index, globalType: type }),
        set: (index: number, value: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.LOCAL_SET, children: [value], localIdx: index }),
    };

    // ─── Global variable operations ──────────────────────────────────
    readonly global = {
        get: (name: string, type: Type): ExpressionRef =>
            this.addNode({ op: OP.GLOBAL_GET, children: [], globalName: name, globalType: type }),
        set: (name: string, value: ExpressionRef): ExpressionRef =>
            this.addNode({ op: OP.GLOBAL_SET, children: [value], globalName: name }),
    };

    // ─── Control flow ────────────────────────────────────────────────

    block(label: string | null, children: ExpressionRef[], type: Type): ExpressionRef {
        return this.addNode({ op: OP.BLOCK, children, label, blockType: type });
    }

    if(condition: ExpressionRef, ifTrue: ExpressionRef, ifFalse?: ExpressionRef): ExpressionRef {
        const children = ifFalse !== undefined ? [condition, ifTrue, ifFalse] : [condition, ifTrue];
        // Infer block type from the then-branch: if it's a block with a result type, use it
        const thenNode = this.nodes[ifTrue];
        let bt = none;
        if (thenNode) {
            if (thenNode.op === OP.BLOCK && thenNode.blockType !== undefined && thenNode.blockType !== none) {
                bt = thenNode.blockType;
            } else {
                // Infer type from simple expressions
                bt = this.inferExprType(ifTrue);
            }
        }
        return this.addNode({ op: OP.IF, children, blockType: bt });
    }

    /** Infer the result type of an expression (for if block type inference). */
    private inferExprType(ref: ExpressionRef): Type {
        const node = this.nodes[ref];
        if (!node) return none;
        switch (node.op) {
            case OP.I32_CONST: case OP.I32_ADD: case OP.I32_SUB: case OP.I32_MUL:
            case OP.I32_DIV_S: case OP.I32_REM_S: case OP.I32_EQ: case OP.I32_NE:
            case OP.I32_LT_S: case OP.I32_GT_S: case OP.I32_LE_S: case OP.I32_GE_S:
            case OP.I32_AND: case OP.I32_OR: case OP.I32_EQZ: case OP.I32_LOAD:
                return i32;
            case OP.I64_CONST: case OP.I64_ADD: case OP.I64_SUB: case OP.I64_MUL:
            case OP.I64_DIV_S: case OP.I64_REM_S: case OP.I64_EQ: case OP.I64_NE:
            case OP.I64_LT_S: case OP.I64_GT_S: case OP.I64_LE_S: case OP.I64_GE_S:
            case OP.I64_LOAD:
                return i64;
            case OP.F64_CONST: case OP.F64_ADD: case OP.F64_SUB: case OP.F64_MUL:
            case OP.F64_DIV: case OP.F64_EQ: case OP.F64_NE: case OP.F64_LT:
            case OP.F64_GT: case OP.F64_LE: case OP.F64_GE: case OP.F64_NEG:
            case OP.F64_CONVERT_I32_S: case OP.F64_LOAD:
                return f64;
            case OP.LOCAL_GET:
                return node.globalType ?? i32;
            case OP.GLOBAL_GET:
                return node.globalType ?? i32;
            case OP.CALL:
                return node.resultType ?? i32;
            case OP.CALL_INDIRECT:
                return node.resultType ?? i32;
            case OP.BLOCK:
                return node.blockType ?? none;
            case OP.IF:
                return node.blockType ?? none;
            case OP.I32_STORE: case OP.I64_STORE: case OP.F64_STORE:
            case OP.LOCAL_SET: case OP.GLOBAL_SET: case OP.DROP:
            case OP.NOP: case OP.UNREACHABLE: case OP.BR: case OP.BR_IF:
            case OP.LOOP:
                return none;
            default:
                return none;
        }
    }

    loop(label: string, body: ExpressionRef): ExpressionRef {
        return this.addNode({ op: OP.LOOP, children: [body], label, blockType: none });
    }

    br(label: string, condition?: ExpressionRef): ExpressionRef {
        if (condition !== undefined) {
            return this.addNode({ op: OP.BR_IF, children: [condition], label });
        }
        return this.addNode({ op: OP.BR, children: [], label });
    }

    call(name: string, args: ExpressionRef[], returnType: Type): ExpressionRef {
        return this.addNode({ op: OP.CALL, children: args, fnName: name, resultType: returnType });
    }

    call_indirect(table: string, target: ExpressionRef, args: ExpressionRef[], paramType: Type, resultType: Type): ExpressionRef {
        return this.addNode({
            op: OP.CALL_INDIRECT, children: [target, ...args],
            tableName: table, paramType, resultType,
        });
    }

    nop(): ExpressionRef {
        return this.addNode({ op: OP.NOP, children: [] });
    }

    drop(expr: ExpressionRef): ExpressionRef {
        return this.addNode({ op: OP.DROP, children: [expr] });
    }

    unreachable(): ExpressionRef {
        return this.addNode({ op: OP.UNREACHABLE, children: [] });
    }

    // ─── Module-level declarations ───────────────────────────────────

    setMemory(initial: number, max: number, exportName: string, segments?: MemorySegment[]): void {
        this.memory = { initial, max, exportName, segments: segments ?? [] };
        if (exportName) {
            this.exports.push({ name: exportName, externalName: exportName, kind: "memory" });
        }
    }

    addGlobal(name: string, type: Type, mutable: boolean, init: ExpressionRef): void {
        this.globals.push({ name, type, mutable, init });
    }

    addFunction(name: string, paramType: Type, resultType: Type, vars: Type[], body: ExpressionRef): void {
        this.functions.push({ name, paramType, resultType, vars, body });
    }

    addFunctionImport(name: string, module: string, base: string, paramType: Type, resultType: Type): void {
        this.imports.push({ name, module, base, paramType, resultType });
    }

    addFunctionExport(name: string, externalName: string): void {
        this.exports.push({ name, externalName, kind: "func" });
    }

    addMemoryImport(name: string, module: string, base: string): void {
        this.memoryImport = { name, module, base };
    }

    addMemoryExport(_name: string, externalName: string): void {
        this.exports.push({ name: externalName, externalName, kind: "memory" });
    }

    addTable(name: string, initial: number, max: number): void {
        this.table = { name, initial, max };
    }

    addActiveElementSegment(table: string, name: string, funcs: string[], offset: ExpressionRef): void {
        this.elemSegments.push({ table, name, funcs, offset });
    }

    // ─── Output ──────────────────────────────────────────────────────

    validate(): boolean { return true; }
    optimize(): void { /* no-op — Edict IR optimizer handles this */ }
    dispose(): void { /* no-op — GC handles cleanup */ }

    // =================================================================
    // Binary Emission
    // =================================================================

    emitBinary(): Uint8Array {
        const out: number[] = [];

        // Build function name → index mapping
        const funcIndex = new Map<string, number>();
        for (let i = 0; i < this.imports.length; i++) {
            funcIndex.set(this.imports[i]!.name, i);
        }
        const funcBaseIndex = this.imports.length;
        for (let i = 0; i < this.functions.length; i++) {
            funcIndex.set(this.functions[i]!.name, funcBaseIndex + i);
        }

        // Build global name → index mapping
        const globalIndex = new Map<string, number>();
        for (let i = 0; i < this.globals.length; i++) {
            globalIndex.set(this.globals[i]!.name, i);
        }

        // Collect and deduplicate function type signatures
        const typeSigs: { params: Type[]; results: Type[] }[] = [];
        const typeIndexFor = (paramType: Type, resultType: Type): number => {
            const params = expandType(paramType);
            const results = expandType(resultType);
            for (let i = 0; i < typeSigs.length; i++) {
                const s = typeSigs[i]!;
                if (s.params.length === params.length && s.results.length === results.length &&
                    s.params.every((t, j) => t === params[j]) &&
                    s.results.every((t, j) => t === results[j])) {
                    return i;
                }
            }
            typeSigs.push({ params, results });
            return typeSigs.length - 1;
        };

        // Pre-register all type signatures
        const importTypeIndices = this.imports.map(imp => typeIndexFor(imp.paramType, imp.resultType));
        const funcTypeIndices = this.functions.map(fn => typeIndexFor(fn.paramType, fn.resultType));

        // For call_indirect, we also need type indices
        const callIndirectTypeIndex = (paramType: Type, resultType: Type): number =>
            typeIndexFor(paramType, resultType);

        // ─── WASM header ─────────────────────────────────────────────
        out.push(0x00, 0x61, 0x73, 0x6D); // magic: \0asm
        out.push(0x01, 0x00, 0x00, 0x00); // version: 1

        // ─── Section 1: Type ─────────────────────────────────────────
        {
            const sec: number[] = [];
            sec.push(...encodeU32(typeSigs.length));
            for (const sig of typeSigs) {
                sec.push(0x60); // func type
                sec.push(...encodeU32(sig.params.length));
                for (const p of sig.params) sec.push(p);
                sec.push(...encodeU32(sig.results.length));
                for (const r of sig.results) sec.push(r);
            }
            out.push(1, ...encodeU32(sec.length), ...sec);
        }

        // ─── Section 2: Import ───────────────────────────────────────
        if (this.imports.length > 0 || this.memoryImport) {
            const sec: number[] = [];
            const importCount = this.imports.length + (this.memoryImport ? 1 : 0);
            sec.push(...encodeU32(importCount));
            for (let i = 0; i < this.imports.length; i++) {
                const imp = this.imports[i]!;
                sec.push(...encodeString(imp.module));
                sec.push(...encodeString(imp.base));
                sec.push(0x00); // import kind: function
                sec.push(...encodeU32(importTypeIndices[i]!));
            }
            if (this.memoryImport) {
                sec.push(...encodeString(this.memoryImport.module));
                sec.push(...encodeString(this.memoryImport.base));
                sec.push(0x02); // import kind: memory
                sec.push(0x00); // limits: no max
                sec.push(...encodeU32(0)); // initial = 0
            }
            out.push(2, ...encodeU32(sec.length), ...sec);
        }

        // ─── Section 3: Function ─────────────────────────────────────
        if (this.functions.length > 0) {
            const sec: number[] = [];
            sec.push(...encodeU32(this.functions.length));
            for (const typeIdx of funcTypeIndices) {
                sec.push(...encodeU32(typeIdx));
            }
            out.push(3, ...encodeU32(sec.length), ...sec);
        }

        // ─── Section 4: Table ────────────────────────────────────────
        if (this.table) {
            const sec: number[] = [];
            sec.push(...encodeU32(1)); // one table
            sec.push(0x70); // funcref
            sec.push(0x01); // limits: has max
            sec.push(...encodeU32(this.table.initial));
            sec.push(...encodeU32(this.table.max));
            out.push(4, ...encodeU32(sec.length), ...sec);
        }

        // ─── Section 5: Memory ───────────────────────────────────────
        if (this.memory && !this.memoryImport) {
            const sec: number[] = [];
            sec.push(...encodeU32(1)); // one memory
            sec.push(0x01); // limits: has max
            sec.push(...encodeU32(this.memory.initial));
            sec.push(...encodeU32(this.memory.max));
            out.push(5, ...encodeU32(sec.length), ...sec);
        }

        // ─── Section 6: Global ───────────────────────────────────────
        if (this.globals.length > 0) {
            const sec: number[] = [];
            sec.push(...encodeU32(this.globals.length));
            for (const g of this.globals) {
                sec.push(g.type);
                sec.push(g.mutable ? 0x01 : 0x00);
                this.emitConstExpr(sec, g.init);
                sec.push(OP.END);
            }
            out.push(6, ...encodeU32(sec.length), ...sec);
        }

        // ─── Section 7: Export ───────────────────────────────────────
        if (this.exports.length > 0) {
            const sec: number[] = [];
            sec.push(...encodeU32(this.exports.length));
            for (const exp of this.exports) {
                sec.push(...encodeString(exp.externalName));
                if (exp.kind === "func") {
                    sec.push(0x00);
                    const idx = funcIndex.get(exp.name);
                    sec.push(...encodeU32(idx ?? 0));
                } else {
                    sec.push(0x02); // memory
                    sec.push(...encodeU32(0));
                }
            }
            out.push(7, ...encodeU32(sec.length), ...sec);
        }

        // ─── Section 9: Element ──────────────────────────────────────
        if (this.elemSegments.length > 0) {
            const sec: number[] = [];
            sec.push(...encodeU32(this.elemSegments.length));
            for (const seg of this.elemSegments) {
                sec.push(0x00); // active element segment, table 0
                this.emitConstExpr(sec, seg.offset);
                sec.push(OP.END);
                sec.push(...encodeU32(seg.funcs.length));
                for (const fname of seg.funcs) {
                    const idx = funcIndex.get(fname);
                    sec.push(...encodeU32(idx ?? 0));
                }
            }
            out.push(9, ...encodeU32(sec.length), ...sec);
        }

        // ─── Section 10: Code ────────────────────────────────────────
        if (this.functions.length > 0) {
            const sec: number[] = [];
            sec.push(...encodeU32(this.functions.length));
            for (const fn of this.functions) {
                const body: number[] = [];
                // Local declarations (compress runs of same type)
                const locals = fn.vars;
                const localDecls: { count: number; type: Type }[] = [];
                for (const t of locals) {
                    if (localDecls.length > 0 && localDecls[localDecls.length - 1]!.type === t) {
                        localDecls[localDecls.length - 1]!.count++;
                    } else {
                        localDecls.push({ count: 1, type: t });
                    }
                }
                body.push(...encodeU32(localDecls.length));
                for (const d of localDecls) {
                    body.push(...encodeU32(d.count));
                    body.push(d.type);
                }
                // Emit function body expression
                this.emitExpr(body, fn.body, funcIndex, globalIndex, callIndirectTypeIndex);
                body.push(OP.END);
                sec.push(...encodeU32(body.length), ...body);
            }
            out.push(10, ...encodeU32(sec.length), ...sec);
        }

        // ─── Section 11: Data ────────────────────────────────────────
        if (this.memory && this.memory.segments.length > 0) {
            const sec: number[] = [];
            sec.push(...encodeU32(this.memory.segments.length));
            for (const seg of this.memory.segments) {
                sec.push(0x00); // active data segment, memory 0
                // Extract offset from i32.const expression
                const offsetNode = this.nodes[seg.offset];
                const offsetVal = offsetNode?.iVal ?? 0;
                sec.push(OP.I32_CONST, ...encodeI32(offsetVal), OP.END);
                sec.push(...encodeU32(seg.data.length));
                sec.push(...Array.from(seg.data));
            }
            out.push(11, ...encodeU32(sec.length), ...sec);
        }

        return new Uint8Array(out);
    }

    // ─── Constant expression emission (for globals, data offsets) ────
    private emitConstExpr(out: number[], ref: ExpressionRef): void {
        const node = this.nodes[ref]!;
        switch (node.op) {
            case OP.I32_CONST:
                out.push(OP.I32_CONST, ...encodeI32(node.iVal ?? 0));
                break;
            case OP.I64_CONST:
                out.push(OP.I64_CONST, ...encodeI64(node.i64Low ?? 0, node.i64High ?? 0));
                break;
            case OP.F64_CONST:
                out.push(OP.F64_CONST, ...encodeF64(node.fVal ?? 0));
                break;
            case OP.GLOBAL_GET: {
                // Global init can reference another global
                const idx = node.globalName ? 0 : 0; // should not happen in Edict
                out.push(OP.GLOBAL_GET, ...encodeU32(idx));
                break;
            }
            default:
                out.push(OP.I32_CONST, ...encodeI32(0));
        }
    }

    // ─── Expression emit (recursive) ─────────────────────────────────
    private emitExpr(
        out: number[],
        ref: ExpressionRef,
        funcIndex: Map<string, number>,
        globalIndex: Map<string, number>,
        callIndirectTypeIndex: (paramType: Type, resultType: Type) => number,
        labelStack: (string | null)[] = [],
    ): void {
        const node = this.nodes[ref]!;

        switch (node.op) {
            case OP.UNREACHABLE:
                out.push(OP.UNREACHABLE);
                break;

            case OP.NOP:
                out.push(OP.NOP);
                break;

            case OP.I32_CONST:
                out.push(OP.I32_CONST, ...encodeI32(node.iVal ?? 0));
                break;

            case OP.I64_CONST:
                out.push(OP.I64_CONST, ...encodeI64(node.i64Low ?? 0, node.i64High ?? 0));
                break;

            case OP.F64_CONST:
                out.push(OP.F64_CONST, ...encodeF64(node.fVal ?? 0));
                break;

            // Unary operators
            case OP.I32_EQZ:
            case OP.F64_NEG:
            case OP.F64_CONVERT_I32_S:
                this.emitExpr(out, node.children[0]!, funcIndex, globalIndex, callIndirectTypeIndex, labelStack);
                out.push(node.op);
                break;

            // Binary operators (i32, i64, f64)
            case OP.I32_ADD: case OP.I32_SUB: case OP.I32_MUL: case OP.I32_DIV_S:
            case OP.I32_REM_S: case OP.I32_EQ: case OP.I32_NE:
            case OP.I32_LT_S: case OP.I32_GT_S: case OP.I32_LE_S: case OP.I32_GE_S:
            case OP.I32_AND: case OP.I32_OR: case OP.I32_GE_U:
            case OP.I64_ADD: case OP.I64_SUB: case OP.I64_MUL: case OP.I64_DIV_S:
            case OP.I64_REM_S: case OP.I64_EQ: case OP.I64_NE:
            case OP.I64_LT_S: case OP.I64_GT_S: case OP.I64_LE_S: case OP.I64_GE_S:
            case OP.F64_ADD: case OP.F64_SUB: case OP.F64_MUL: case OP.F64_DIV:
            case OP.F64_EQ: case OP.F64_NE: case OP.F64_LT: case OP.F64_GT:
            case OP.F64_LE: case OP.F64_GE:
                this.emitExpr(out, node.children[0]!, funcIndex, globalIndex, callIndirectTypeIndex, labelStack);
                this.emitExpr(out, node.children[1]!, funcIndex, globalIndex, callIndirectTypeIndex, labelStack);
                out.push(node.op);
                break;

            // Local variable
            case OP.LOCAL_GET:
                out.push(OP.LOCAL_GET, ...encodeU32(node.localIdx ?? 0));
                break;

            case OP.LOCAL_SET:
                this.emitExpr(out, node.children[0]!, funcIndex, globalIndex, callIndirectTypeIndex, labelStack);
                out.push(OP.LOCAL_SET, ...encodeU32(node.localIdx ?? 0));
                break;

            // Global variable
            case OP.GLOBAL_GET: {
                const idx = globalIndex.get(node.globalName ?? "") ?? 0;
                out.push(OP.GLOBAL_GET, ...encodeU32(idx));
                break;
            }

            case OP.GLOBAL_SET: {
                this.emitExpr(out, node.children[0]!, funcIndex, globalIndex, callIndirectTypeIndex, labelStack);
                const idx = globalIndex.get(node.globalName ?? "") ?? 0;
                out.push(OP.GLOBAL_SET, ...encodeU32(idx));
                break;
            }

            // Memory load
            case OP.I32_LOAD:
                this.emitExpr(out, node.children[0]!, funcIndex, globalIndex, callIndirectTypeIndex, labelStack);
                out.push(OP.I32_LOAD, ...encodeU32(2), ...encodeU32(node.memOffset ?? 0)); // align=2 (4 bytes)
                break;

            case OP.I64_LOAD:
                this.emitExpr(out, node.children[0]!, funcIndex, globalIndex, callIndirectTypeIndex, labelStack);
                out.push(OP.I64_LOAD, ...encodeU32(3), ...encodeU32(node.memOffset ?? 0));
                break;

            case OP.F64_LOAD:
                this.emitExpr(out, node.children[0]!, funcIndex, globalIndex, callIndirectTypeIndex, labelStack);
                out.push(OP.F64_LOAD, ...encodeU32(3), ...encodeU32(node.memOffset ?? 0));
                break;

            // Memory store
            case OP.I32_STORE:
                this.emitExpr(out, node.children[0]!, funcIndex, globalIndex, callIndirectTypeIndex, labelStack);
                this.emitExpr(out, node.children[1]!, funcIndex, globalIndex, callIndirectTypeIndex, labelStack);
                out.push(OP.I32_STORE, ...encodeU32(2), ...encodeU32(node.memOffset ?? 0));
                break;

            case OP.I64_STORE:
                this.emitExpr(out, node.children[0]!, funcIndex, globalIndex, callIndirectTypeIndex, labelStack);
                this.emitExpr(out, node.children[1]!, funcIndex, globalIndex, callIndirectTypeIndex, labelStack);
                out.push(OP.I64_STORE, ...encodeU32(3), ...encodeU32(node.memOffset ?? 0));
                break;

            case OP.F64_STORE:
                this.emitExpr(out, node.children[0]!, funcIndex, globalIndex, callIndirectTypeIndex, labelStack);
                this.emitExpr(out, node.children[1]!, funcIndex, globalIndex, callIndirectTypeIndex, labelStack);
                out.push(OP.F64_STORE, ...encodeU32(3), ...encodeU32(node.memOffset ?? 0));
                break;

            // Byte-level memory ops
            case OP.I32_LOAD8_U:
                this.emitExpr(out, node.children[0]!, funcIndex, globalIndex, callIndirectTypeIndex, labelStack);
                out.push(OP.I32_LOAD8_U, ...encodeU32(0), ...encodeU32(node.memOffset ?? 0)); // align=0 (1 byte)
                break;

            case OP.I32_STORE8:
                this.emitExpr(out, node.children[0]!, funcIndex, globalIndex, callIndirectTypeIndex, labelStack);
                this.emitExpr(out, node.children[1]!, funcIndex, globalIndex, callIndirectTypeIndex, labelStack);
                out.push(OP.I32_STORE8, ...encodeU32(0), ...encodeU32(node.memOffset ?? 0)); // align=0 (1 byte)
                break;

            // Drop
            case OP.DROP:
                this.emitExpr(out, node.children[0]!, funcIndex, globalIndex, callIndirectTypeIndex, labelStack);
                out.push(OP.DROP);
                break;

            // Block
            case OP.BLOCK: {
                const bt = node.blockType ?? none;
                out.push(OP.BLOCK, bt);
                const newStack = [...labelStack, node.label ?? null];
                for (const child of node.children) {
                    this.emitExpr(out, child, funcIndex, globalIndex, callIndirectTypeIndex, newStack);
                }
                out.push(OP.END);
                break;
            }

            // Loop
            case OP.LOOP: {
                const bt = node.blockType ?? none;
                out.push(OP.LOOP, bt);
                const newStack = [...labelStack, node.label ?? null];
                this.emitExpr(out, node.children[0]!, funcIndex, globalIndex, callIndirectTypeIndex, newStack);
                out.push(OP.END);
                break;
            }

            // If
            case OP.IF: {
                // children[0] = condition, children[1] = then, children[2] = else (optional)
                this.emitExpr(out, node.children[0]!, funcIndex, globalIndex, callIndirectTypeIndex, labelStack);
                const bt = node.blockType ?? none;
                out.push(OP.IF, bt);
                const newStack = [...labelStack, null];
                this.emitExpr(out, node.children[1]!, funcIndex, globalIndex, callIndirectTypeIndex, newStack);
                if (node.children.length > 2) {
                    out.push(OP.ELSE);
                    this.emitExpr(out, node.children[2]!, funcIndex, globalIndex, callIndirectTypeIndex, newStack);
                }
                out.push(OP.END);
                break;
            }

            // Branch
            case OP.BR: {
                const depth = this.resolveLabelDepth(node.label!, labelStack);
                out.push(OP.BR, ...encodeU32(depth));
                break;
            }

            case OP.BR_IF: {
                this.emitExpr(out, node.children[0]!, funcIndex, globalIndex, callIndirectTypeIndex, labelStack);
                const depth = this.resolveLabelDepth(node.label!, labelStack);
                out.push(OP.BR_IF, ...encodeU32(depth));
                break;
            }

            // Call
            case OP.CALL: {
                for (const child of node.children) {
                    this.emitExpr(out, child, funcIndex, globalIndex, callIndirectTypeIndex, labelStack);
                }
                const idx = funcIndex.get(node.fnName ?? "") ?? 0;
                out.push(OP.CALL, ...encodeU32(idx));
                break;
            }

            // Call indirect
            case OP.CALL_INDIRECT: {
                // children[0] = target (table index), rest = args
                // WASM stack order: args first, then target index
                // Emit args (children[1..])
                for (let i = 1; i < node.children.length; i++) {
                    this.emitExpr(out, node.children[i]!, funcIndex, globalIndex, callIndirectTypeIndex, labelStack);
                }
                // Emit target index
                this.emitExpr(out, node.children[0]!, funcIndex, globalIndex, callIndirectTypeIndex, labelStack);
                const typeIdx = callIndirectTypeIndex(node.paramType!, node.resultType!);
                out.push(OP.CALL_INDIRECT, ...encodeU32(typeIdx), 0x00); // table index 0
                break;
            }

            default:
                throw new Error(`unknown expression opcode: 0x${node.op.toString(16)}`);
        }
    }

    private resolveLabelDepth(label: string, labelStack: (string | null)[]): number {
        for (let i = labelStack.length - 1; i >= 0; i--) {
            if (labelStack[i] === label) {
                return labelStack.length - 1 - i;
            }
        }
        throw new Error(`unresolved label: ${label}`);
    }

    // =================================================================
    // WAT Text Emission (basic — for test compatibility)
    // =================================================================

    emitText(): string {
        const lines: string[] = ["(module"];

        // Types
        for (let i = 0; i < this.collectTypeSigs().length; i++) {
            const sig = this.collectTypeSigs()[i]!;
            const params = sig.params.map(t => TYPE_NAMES[t] ?? "i32").join(" ");
            const results = sig.results.map(t => TYPE_NAMES[t] ?? "i32").join(" ");
            lines.push(`  (type $t${i} (func${params ? ` (param ${params})` : ""}${results ? ` (result ${results})` : ""}))`);
        }

        // Imports
        for (const imp of this.imports) {
            const params = expandType(imp.paramType).map(t => TYPE_NAMES[t] ?? "i32").join(" ");
            const results = expandType(imp.resultType).map(t => TYPE_NAMES[t] ?? "i32");
            lines.push(`  (import "${imp.module}" "${imp.base}" (func $${imp.name}${params ? ` (param ${params})` : ""}${results.length > 0 && results[0] !== undefined ? ` (result ${results[0]})` : ""}))`);
        }

        // Memory
        if (this.memory) {
            lines.push(`  (memory ${this.memory.initial} ${this.memory.max})`);
        }

        // Globals
        for (const g of this.globals) {
            const typeName = TYPE_NAMES[g.type] ?? "i32";
            const initStr = this.watExpr(g.init, 0);
            if (g.mutable) {
                lines.push(`  (global $${g.name} (mut ${typeName}) ${initStr})`);
            } else {
                lines.push(`  (global $${g.name} ${typeName} ${initStr})`);
            }
        }

        // Functions
        for (const fn of this.functions) {
            const params = expandType(fn.paramType);
            const paramStr = params.map(t => ` (param ${TYPE_NAMES[t] ?? "i32"})`).join("");
            const resultStr = fn.resultType !== none ? ` (result ${TYPE_NAMES[fn.resultType] ?? "i32"})` : "";
            const localStr = fn.vars.map(t => `\n    (local ${TYPE_NAMES[t] ?? "i32"})`).join("");
            const bodyStr = this.watExpr(fn.body, 2);
            lines.push(`  (func $${fn.name}${paramStr}${resultStr}${localStr}\n${bodyStr}\n  )`);
        }

        // Table
        if (this.table) {
            lines.push(`  (table $${this.table.name} ${this.table.initial} ${this.table.max} funcref)`);
        }

        // Element segments
        for (const seg of this.elemSegments) {
            const funcs = seg.funcs.map(f => `$${f}`).join(" ");
            const offsetStr = this.watExpr(seg.offset, 0);
            lines.push(`  (elem ${offsetStr} ${funcs})`);
        }

        // Exports
        for (const exp of this.exports) {
            if (exp.kind === "func") {
                lines.push(`  (export "${exp.externalName}" (func $${exp.name}))`);
            } else {
                lines.push(`  (export "${exp.externalName}" (memory 0))`);
            }
        }

        // Data segments
        if (this.memory) {
            for (const seg of this.memory.segments) {
                const offsetNode = this.nodes[seg.offset];
                const offsetVal = offsetNode?.iVal ?? 0;
                const dataStr = Array.from(seg.data).map(b =>
                    b >= 32 && b < 127 && b !== 34 && b !== 92
                        ? String.fromCharCode(b)
                        : `\\${b.toString(16).padStart(2, "0")}`
                ).join("");
                lines.push(`  (data (i32.const ${offsetVal}) "${dataStr}")`);
            }
        }

        lines.push(")");
        return lines.join("\n");
    }

    private collectTypeSigs(): { params: Type[]; results: Type[] }[] {
        const sigs: { params: Type[]; results: Type[] }[] = [];
        const add = (paramType: Type, resultType: Type) => {
            const params = expandType(paramType);
            const results = expandType(resultType);
            const exists = sigs.some(s =>
                s.params.length === params.length && s.results.length === results.length &&
                s.params.every((t, j) => t === params[j]) &&
                s.results.every((t, j) => t === results[j])
            );
            if (!exists) sigs.push({ params, results });
        };
        for (const imp of this.imports) add(imp.paramType, imp.resultType);
        for (const fn of this.functions) add(fn.paramType, fn.resultType);
        return sigs;
    }

    private watExpr(ref: ExpressionRef, indent: number): string {
        const node = this.nodes[ref];
        if (!node) return `${"  ".repeat(indent)}nop`;
        const pad = "  ".repeat(indent);

        switch (node.op) {
            case OP.I32_CONST: return `${pad}i32.const ${node.iVal ?? 0}`;
            case OP.I64_CONST: {
                const val = (BigInt(node.i64High ?? 0) << 32n) | BigInt((node.i64Low ?? 0) >>> 0);
                return `${pad}i64.const ${val}`;
            }
            case OP.F64_CONST: return `${pad}f64.const ${node.fVal ?? 0}`;
            case OP.NOP: return `${pad}nop`;
            case OP.UNREACHABLE: return `${pad}unreachable`;

            case OP.LOCAL_GET: return `${pad}local.get ${node.localIdx ?? 0}`;
            case OP.LOCAL_SET:
                return `${this.watExpr(node.children[0]!, indent)}\n${pad}local.set ${node.localIdx ?? 0}`;

            case OP.GLOBAL_GET: return `${pad}global.get $${node.globalName ?? ""}`;
            case OP.GLOBAL_SET:
                return `${this.watExpr(node.children[0]!, indent)}\n${pad}global.set $${node.globalName ?? ""}`;

            case OP.DROP:
                return `${this.watExpr(node.children[0]!, indent)}\n${pad}drop`;

            case OP.I32_LOAD:
            case OP.I64_LOAD:
            case OP.F64_LOAD: {
                const opName = node.op === OP.I32_LOAD ? "i32.load" : node.op === OP.I64_LOAD ? "i64.load" : "f64.load";
                const off = (node.memOffset ?? 0) > 0 ? ` offset=${node.memOffset}` : "";
                return `${this.watExpr(node.children[0]!, indent)}\n${pad}${opName}${off}`;
            }

            case OP.I32_STORE:
            case OP.I64_STORE:
            case OP.F64_STORE: {
                const opName = node.op === OP.I32_STORE ? "i32.store" : node.op === OP.I64_STORE ? "i64.store" : "f64.store";
                const off = (node.memOffset ?? 0) > 0 ? ` offset=${node.memOffset}` : "";
                return `${this.watExpr(node.children[0]!, indent)}\n${this.watExpr(node.children[1]!, indent)}\n${pad}${opName}${off}`;
            }

            case OP.BLOCK: {
                const bt = node.blockType !== none && node.blockType !== undefined ? ` (result ${TYPE_NAMES[node.blockType] ?? "i32"})` : "";
                const label = node.label ? ` $${node.label}` : "";
                const children = node.children.map(c => this.watExpr(c, indent + 1)).join("\n");
                return `${pad}block${label}${bt}\n${children}\n${pad}end`;
            }

            case OP.LOOP: {
                const label = node.label ? ` $${node.label}` : "";
                const body = this.watExpr(node.children[0]!, indent + 1);
                return `${pad}loop${label}\n${body}\n${pad}end`;
            }

            case OP.IF: {
                const cond = this.watExpr(node.children[0]!, indent);
                const thenBody = this.watExpr(node.children[1]!, indent + 1);
                // Infer block type
                const thenNode = this.nodes[node.children[1]!];
                const bt = thenNode?.op === OP.BLOCK && thenNode.blockType !== none && thenNode.blockType !== undefined
                    ? ` (result ${TYPE_NAMES[thenNode.blockType] ?? "i32"})` : "";
                if (node.children.length > 2) {
                    const elseBody = this.watExpr(node.children[2]!, indent + 1);
                    return `${cond}\n${pad}if${bt}\n${thenBody}\n${pad}else\n${elseBody}\n${pad}end`;
                }
                return `${cond}\n${pad}if${bt}\n${thenBody}\n${pad}end`;
            }

            case OP.BR:
                return `${pad}br $${node.label ?? ""}`;

            case OP.BR_IF:
                return `${this.watExpr(node.children[0]!, indent)}\n${pad}br_if $${node.label ?? ""}`;

            case OP.CALL: {
                const args = node.children.map(c => this.watExpr(c, indent)).join("\n");
                const pre = args ? `${args}\n` : "";
                return `${pre}${pad}call $${node.fnName ?? ""}`;
            }

            case OP.CALL_INDIRECT: {
                // children[0] = target, rest = args
                const args = node.children.slice(1).map(c => this.watExpr(c, indent)).join("\n");
                const target = this.watExpr(node.children[0]!, indent);
                const pre = args ? `${args}\n` : "";
                return `${pre}${target}\n${pad}call_indirect (type $t0)`;
            }

            default: {
                const name = OP_NAMES[node.op];
                if (name) {
                    if (node.children.length === 1) {
                        return `${this.watExpr(node.children[0]!, indent)}\n${pad}${name}`;
                    }
                    if (node.children.length === 2) {
                        return `${this.watExpr(node.children[0]!, indent)}\n${this.watExpr(node.children[1]!, indent)}\n${pad}${name}`;
                    }
                    return `${pad}${name}`;
                }
                return `${pad};; unknown op 0x${node.op.toString(16)}`;
            }
        }
    }
}
