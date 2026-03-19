// =============================================================================
// Pure-JS WASM MVP Interpreter — WebAssembly polyfill for QuickJS
// =============================================================================
// The dual of wasm-encoder.ts: the encoder writes WASM binaries, this
// interpreter reads and executes them. Scoped to the exact WASM MVP subset
// that Edict's codegen emits — not a general-purpose WASM runtime.
//
// No native dependencies, no WebAssembly API needed, runs in QuickJS.
//
// Architecture:
//   1. Parse WASM binary → module definition (types, funcs, memory, etc.)
//   2. Link imports from the provided import object
//   3. Execute instructions via a stack-based interpreter with step limiting

// =============================================================================
// Public API
// =============================================================================

export interface WasmInstance {
    exports: Record<string, unknown>;
}

export interface WasmInterpreterResult {
    instance: WasmInstance;
}

export interface WasmInterpreterOptions {
    /** Max instructions before aborting (default: 10_000_000) */
    maxSteps?: number;
}

// =============================================================================
// LEB128 Decoding
// =============================================================================

class BinaryReader {
    pos = 0;
    constructor(public buf: Uint8Array) {}

    get length(): number { return this.buf.length; }

    readByte(): number {
        if (this.pos >= this.buf.length) throw new Error("wasm_invalid: unexpected end of binary");
        return this.buf[this.pos++]!;
    }

    readU32(): number {
        let result = 0, shift = 0;
        for (;;) {
            const byte = this.readByte();
            result |= (byte & 0x7F) << shift;
            if ((byte & 0x80) === 0) return result >>> 0;
            shift += 7;
            if (shift >= 35) throw new Error("wasm_invalid: LEB128 overflow");
        }
    }

    readI32(): number {
        let result = 0, shift = 0;
        for (;;) {
            const byte = this.readByte();
            result |= (byte & 0x7F) << shift;
            shift += 7;
            if ((byte & 0x80) === 0) {
                if (shift < 32 && (byte & 0x40) !== 0) result |= -(1 << shift);
                return result | 0;
            }
            if (shift >= 35) throw new Error("wasm_invalid: LEB128 overflow");
        }
    }

    readI64(): bigint {
        let result = 0n, shift = 0n;
        for (;;) {
            const byte = this.readByte();
            result |= BigInt(byte & 0x7F) << shift;
            shift += 7n;
            if ((byte & 0x80) === 0) {
                if (shift < 64n && (byte & 0x40) !== 0) result |= -(1n << shift);
                return result;
            }
            if (shift >= 70n) throw new Error("wasm_invalid: i64 LEB128 overflow");
        }
    }

    readF64(): number {
        if (this.pos + 8 > this.buf.length) throw new Error("wasm_invalid: unexpected end");
        const bytes = this.buf.slice(this.pos, this.pos + 8);
        this.pos += 8;
        return new Float64Array(bytes.buffer, bytes.byteOffset, 1)[0]!;
    }

    readBytes(n: number): Uint8Array {
        if (this.pos + n > this.buf.length) throw new Error("wasm_invalid: unexpected end");
        const slice = this.buf.slice(this.pos, this.pos + n);
        this.pos += n;
        return slice;
    }

    readString(): string {
        const len = this.readU32();
        const bytes = this.readBytes(len);
        let str = "";
        for (let i = 0; i < bytes.length; i++) {
            str += String.fromCharCode(bytes[i]!);
        }
        return str;
    }
}

// =============================================================================
// Module Definition Types
// =============================================================================

interface FuncType { params: number[]; results: number[] }
interface ImportEntry { module: string; name: string; kind: number; typeIdx?: number; memInitial?: number; memMax?: number }
interface FuncBody { locals: number[]; code: Uint8Array }
interface ExportEntry { name: string; kind: number; index: number }
interface GlobalEntry { type: number; mutable: boolean; initExpr: Uint8Array }
interface ElemEntry { tableIdx: number; offsetExpr: Uint8Array; funcIndices: number[] }
interface DataEntry { memIdx: number; offsetExpr: Uint8Array; data: Uint8Array }
interface TableEntry { initial: number; max: number }

interface ParsedModule {
    types: FuncType[];
    imports: ImportEntry[];
    funcTypeIndices: number[];
    tables: TableEntry[];
    memoryInitial: number;
    memoryMax: number;
    hasMemory: boolean;
    globals: GlobalEntry[];
    exports: ExportEntry[];
    elements: ElemEntry[];
    bodies: FuncBody[];
    dataSegments: DataEntry[];
    importFuncCount: number;
    importMemCount: number;
}

// =============================================================================
// Binary Parser
// =============================================================================

function parseModule(bytes: Uint8Array): ParsedModule {
    const r = new BinaryReader(bytes);

    // Magic + version
    const magic = (r.readByte() << 24) | (r.readByte() << 16) | (r.readByte() << 8) | r.readByte();
    if (magic !== 0x0061736D) throw new Error("wasm_invalid: bad magic number");
    const version = r.readByte() | (r.readByte() << 8) | (r.readByte() << 16) | (r.readByte() << 24);
    if (version !== 1) throw new Error("wasm_invalid: unsupported version " + version);

    const mod: ParsedModule = {
        types: [], imports: [], funcTypeIndices: [], tables: [],
        memoryInitial: 0, memoryMax: 0, hasMemory: false,
        globals: [], exports: [], elements: [], bodies: [],
        dataSegments: [], importFuncCount: 0, importMemCount: 0,
    };

    while (r.pos < r.length) {
        const sectionId = r.readByte();
        const sectionLen = r.readU32();
        const sectionEnd = r.pos + sectionLen;

        switch (sectionId) {
            case 1: parseTypeSection(r, mod); break;
            case 2: parseImportSection(r, mod); break;
            case 3: parseFunctionSection(r, mod); break;
            case 4: parseTableSection(r, mod); break;
            case 5: parseMemorySection(r, mod); break;
            case 6: parseGlobalSection(r, mod); break;
            case 7: parseExportSection(r, mod); break;
            case 9: parseElementSection(r, mod); break;
            case 10: parseCodeSection(r, mod); break;
            case 11: parseDataSection(r, mod); break;
            default: r.pos = sectionEnd; break; // skip unknown/custom sections
        }

        if (r.pos !== sectionEnd) r.pos = sectionEnd; // ensure alignment
    }

    return mod;
}

function parseTypeSection(r: BinaryReader, mod: ParsedModule): void {
    const count = r.readU32();
    for (let i = 0; i < count; i++) {
        const form = r.readByte(); // 0x60 = func type
        if (form !== 0x60) throw new Error("wasm_invalid: expected func type 0x60");
        const paramCount = r.readU32();
        const params: number[] = [];
        for (let j = 0; j < paramCount; j++) params.push(r.readByte());
        const resultCount = r.readU32();
        const results: number[] = [];
        for (let j = 0; j < resultCount; j++) results.push(r.readByte());
        mod.types.push({ params, results });
    }
}

function parseImportSection(r: BinaryReader, mod: ParsedModule): void {
    const count = r.readU32();
    for (let i = 0; i < count; i++) {
        const module = r.readString();
        const name = r.readString();
        const kind = r.readByte();
        const entry: ImportEntry = { module, name, kind };
        if (kind === 0) { // function
            entry.typeIdx = r.readU32();
            mod.importFuncCount++;
        } else if (kind === 2) { // memory
            const limitsFlag = r.readByte();
            entry.memInitial = r.readU32();
            entry.memMax = limitsFlag === 1 ? r.readU32() : undefined;
            mod.importMemCount++;
        } else {
            throw new Error("wasm_invalid: unsupported import kind " + kind);
        }
        mod.imports.push(entry);
    }
}

function parseFunctionSection(r: BinaryReader, mod: ParsedModule): void {
    const count = r.readU32();
    for (let i = 0; i < count; i++) mod.funcTypeIndices.push(r.readU32());
}

function parseTableSection(r: BinaryReader, mod: ParsedModule): void {
    const count = r.readU32();
    for (let i = 0; i < count; i++) {
        r.readByte(); // 0x70 = funcref
        const limitsFlag = r.readByte();
        const initial = r.readU32();
        const max = limitsFlag === 1 ? r.readU32() : initial;
        mod.tables.push({ initial, max });
    }
}

function parseMemorySection(r: BinaryReader, mod: ParsedModule): void {
    const count = r.readU32();
    if (count > 0) {
        const limitsFlag = r.readByte();
        mod.memoryInitial = r.readU32();
        mod.memoryMax = limitsFlag === 1 ? r.readU32() : mod.memoryInitial;
        mod.hasMemory = true;
    }
}

function parseGlobalSection(r: BinaryReader, mod: ParsedModule): void {
    const count = r.readU32();
    for (let i = 0; i < count; i++) {
        const type = r.readByte();
        const mutable = r.readByte() === 1;
        const start = r.pos;
        // Skip init expr to find END (0x0B)
        while (r.readByte() !== 0x0B) { /* skip */ }
        const initExpr = r.buf.slice(start, r.pos - 1);
        mod.globals.push({ type, mutable, initExpr });
    }
}

function parseExportSection(r: BinaryReader, mod: ParsedModule): void {
    const count = r.readU32();
    for (let i = 0; i < count; i++) {
        const name = r.readString();
        const kind = r.readByte();
        const index = r.readU32();
        mod.exports.push({ name, kind, index });
    }
}

function parseElementSection(r: BinaryReader, mod: ParsedModule): void {
    const count = r.readU32();
    for (let i = 0; i < count; i++) {
        const tableIdx = r.readU32(); // always 0 for MVP active segments
        const start = r.pos;
        while (r.readByte() !== 0x0B) { /* skip offset expr */ }
        const offsetExpr = r.buf.slice(start, r.pos - 1);
        const numFuncs = r.readU32();
        const funcIndices: number[] = [];
        for (let j = 0; j < numFuncs; j++) funcIndices.push(r.readU32());
        mod.elements.push({ tableIdx, offsetExpr, funcIndices });
    }
}

function parseCodeSection(r: BinaryReader, mod: ParsedModule): void {
    const count = r.readU32();
    for (let i = 0; i < count; i++) {
        const bodySize = r.readU32();
        const bodyEnd = r.pos + bodySize;
        const localDeclCount = r.readU32();
        const locals: number[] = [];
        for (let j = 0; j < localDeclCount; j++) {
            const n = r.readU32();
            const t = r.readByte();
            for (let k = 0; k < n; k++) locals.push(t);
        }
        const codeLen = bodyEnd - r.pos;
        const code = r.readBytes(codeLen);
        mod.bodies.push({ locals, code });
    }
}

function parseDataSection(r: BinaryReader, mod: ParsedModule): void {
    const count = r.readU32();
    for (let i = 0; i < count; i++) {
        const memIdx = r.readU32(); // always 0
        const start = r.pos;
        while (r.readByte() !== 0x0B) { /* skip offset expr */ }
        const offsetExpr = r.buf.slice(start, r.pos - 1);
        const dataLen = r.readU32();
        const data = r.readBytes(dataLen);
        mod.dataSegments.push({ memIdx, offsetExpr, data });
    }
}

// =============================================================================
// Constant Expression Evaluator (for globals, data offsets, elem offsets)
// =============================================================================

function evalConstExpr(expr: Uint8Array): number | bigint {
    const r = new BinaryReader(expr);
    const op = r.readByte();
    switch (op) {
        case 0x41: return r.readI32();  // i32.const
        case 0x42: return r.readI64();  // i64.const
        case 0x44: return r.readF64();  // f64.const
        default: throw new Error("wasm_invalid: unsupported const expr opcode 0x" + op.toString(16));
    }
}

// =============================================================================
// Value Stack Types
// =============================================================================

// WASM value types
// const TYPE_I32 = 0x7F; // used only as opcode match values inline
const TYPE_I64 = 0x7E;
// const TYPE_F64 = 0x7C;
const TYPE_VOID = 0x40;

type WasmValue = number | bigint;

// Control frame for block/loop/if
interface ControlFrame {
    kind: "block" | "loop" | "if";
    startPc: number;       // PC at start of block body
    endPc: number;         // PC of the matching END
    elsePc: number;        // PC of ELSE (-1 if none)
    arity: number;         // number of result values
    stackHeight: number;   // value stack height at entry
}

// =============================================================================
// Instruction Executor
// =============================================================================

interface RuntimeFunc {
    type: FuncType;
    kind: "local" | "imported";
    body?: FuncBody;
    importFn?: Function;
}

interface RuntimeGlobal {
    value: WasmValue;
    mutable: boolean;
}

function execute(
    func: RuntimeFunc,
    args: WasmValue[],
    allFuncs: RuntimeFunc[],
    memory: ArrayBuffer | null,
    memoryObj: { buffer: ArrayBuffer } | null,
    globals: RuntimeGlobal[],
    table: (RuntimeFunc | null)[],
    types: FuncType[],
    stepsRemaining: { count: number },
): WasmValue | undefined {
    if (func.kind === "imported") {
        return func.importFn!(...args) as WasmValue | undefined;
    }

    const body = func.body!;
    const code = body.code;
    const codeLen = code.length;

    // Initialize locals: params + declared locals
    const paramCount = func.type.params.length;
    const localCount = paramCount + body.locals.length;
    const locals: WasmValue[] = new Array(localCount);
    for (let i = 0; i < paramCount; i++) locals[i] = args[i]!;
    for (let i = 0; i < body.locals.length; i++) {
        locals[paramCount + i] = body.locals[i] === TYPE_I64 ? 0n : 0;
    }

    // Value stack and control stack
    const valueStack: WasmValue[] = [];
    const controlStack: ControlFrame[] = [];
    let pc = 0;

    // Helper to get memory view (lazily, since buffer may be reassigned)
    function getMemBuf(): DataView {
        const buf = memoryObj ? memoryObj.buffer : memory;
        if (!buf) throw new Error("wasm_trap: no memory");
        return new DataView(buf);
    }

    function getMemU8(): Uint8Array {
        const buf = memoryObj ? memoryObj.buffer : memory;
        if (!buf) throw new Error("wasm_trap: no memory");
        return new Uint8Array(buf);
    }

    // Pre-scan for block structure: find matching END/ELSE for each block-starting opcode
    // This avoids linear scanning during branches.
    const endMap = new Map<number, number>();   // blockStart → END pc
    const elseMap = new Map<number, number>();  // blockStart → ELSE pc

    function prescan(): void {
        const stack: number[] = [];
        for (let i = 0; i < codeLen; ) {
            const op = code[i]!;
            if (op === 0x02 || op === 0x03 || op === 0x04) { // block, loop, if
                stack.push(i);
                i += 2; // skip blocktype byte
            } else if (op === 0x05) { // else
                if (stack.length > 0) elseMap.set(stack[stack.length - 1]!, i);
                i++;
            } else if (op === 0x0B) { // end
                if (stack.length > 0) endMap.set(stack.pop()!, i);
                i++;
            } else {
                i += instrLength(code, i);
            }
        }
    }

    prescan();

    // Read LEB128 u32 from code at pc (updates pc)
    function readCodeU32(): number {
        let result = 0, shift = 0;
        for (;;) {
            const byte = code[pc++]!;
            result |= (byte & 0x7F) << shift;
            if ((byte & 0x80) === 0) return result >>> 0;
            shift += 7;
        }
    }

    function readCodeI32(): number {
        let result = 0, shift = 0;
        for (;;) {
            const byte = code[pc++]!;
            result |= (byte & 0x7F) << shift;
            shift += 7;
            if ((byte & 0x80) === 0) {
                if (shift < 32 && (byte & 0x40) !== 0) result |= -(1 << shift);
                return result | 0;
            }
        }
    }

    function readCodeI64(): bigint {
        let result = 0n, shift = 0n;
        for (;;) {
            const byte = code[pc++]!;
            result |= BigInt(byte & 0x7F) << shift;
            shift += 7n;
            if ((byte & 0x80) === 0) {
                if (shift < 64n && (byte & 0x40) !== 0) result |= -(1n << shift);
                return result;
            }
        }
    }

    function readCodeF64(): number {
        const bytes = code.slice(pc, pc + 8);
        pc += 8;
        return new Float64Array(bytes.buffer, bytes.byteOffset, 1)[0]!;
    }

    // Push the implicit function body block
    const bodyArity = func.type.results.length;

    // Main execution loop
    while (pc < codeLen) {
        if (--stepsRemaining.count <= 0) {
            throw new Error("wasm_step_limit: exceeded maximum instructions");
        }

        const op = code[pc++]!;

        switch (op) {
            // --- Control ---
            case 0x00: // unreachable
                throw new Error("wasm_trap: unreachable");

            case 0x01: // nop
                break;

            case 0x02: { // block
                const blockType = code[pc++]!;
                const arity = blockType === TYPE_VOID ? 0 : 1;
                const blockStartPc = pc - 2; // the 0x02 position
                controlStack.push({
                    kind: "block", startPc: pc, endPc: endMap.get(blockStartPc) ?? codeLen,
                    elsePc: -1, arity, stackHeight: valueStack.length,
                });
                break;
            }

            case 0x03: { // loop
                void code[pc++]; // blocktype (consumed but unused for loops)
                const blockStartPc = pc - 2;
                controlStack.push({
                    kind: "loop", startPc: pc, endPc: endMap.get(blockStartPc) ?? codeLen,
                    elsePc: -1, arity: 0, stackHeight: valueStack.length,
                });
                break;
            }

            case 0x04: { // if
                const blockType = code[pc++]!;
                const arity = blockType === TYPE_VOID ? 0 : 1;
                const cond = valueStack.pop()! as number;
                const blockStartPc = pc - 2;
                const endPcVal = endMap.get(blockStartPc) ?? codeLen;
                const elsePcVal = elseMap.get(blockStartPc) ?? -1;
                controlStack.push({
                    kind: "if", startPc: pc, endPc: endPcVal,
                    elsePc: elsePcVal, arity, stackHeight: valueStack.length,
                });
                if (!cond) {
                    // Skip to else or end
                    pc = elsePcVal !== -1 ? elsePcVal + 1 : endPcVal + 1;
                    if (elsePcVal === -1) controlStack.pop();
                }
                break;
            }

            case 0x05: { // else
                // We hit else while executing the if-true branch — jump to end
                const frame = controlStack[controlStack.length - 1]!;
                pc = frame.endPc + 1;
                controlStack.pop();
                break;
            }

            case 0x0B: { // end
                if (controlStack.length === 0) {
                    // End of function body
                    if (bodyArity > 0 && valueStack.length > 0) return valueStack.pop()!;
                    return undefined;
                }
                controlStack.pop();
                break;
            }

            case 0x0C: { // br
                const depth = readCodeU32();
                branchTo(depth);
                break;
            }

            case 0x0D: { // br_if
                const depth = readCodeU32();
                const cond = valueStack.pop()! as number;
                if (cond) branchTo(depth);
                break;
            }

            case 0x10: { // call
                const funcIdx = readCodeU32();
                const target = allFuncs[funcIdx]!;
                const callArgs: WasmValue[] = [];
                for (let i = 0; i < target.type.params.length; i++) callArgs.unshift(valueStack.pop()!);
                const result = execute(target, callArgs, allFuncs, memory, memoryObj, globals, table, types, stepsRemaining);
                if (target.type.results.length > 0 && result !== undefined) valueStack.push(result);
                break;
            }

            case 0x11: { // call_indirect
                void readCodeU32(); // typeIdx (consumed, type checked at compile time)
                readCodeU32(); // table index (always 0)
                const tableIdx = valueStack.pop()! as number;
                const target = table[tableIdx];
                if (!target) throw new Error("wasm_trap: undefined element " + tableIdx);
                const callArgs: WasmValue[] = [];
                for (let i = 0; i < target.type.params.length; i++) callArgs.unshift(valueStack.pop()!);
                const result = execute(target, callArgs, allFuncs, memory, memoryObj, globals, table, types, stepsRemaining);
                if (target.type.results.length > 0 && result !== undefined) valueStack.push(result);
                break;
            }

            case 0x1A: // drop
                valueStack.pop();
                break;

            // --- Variables ---
            case 0x20: valueStack.push(locals[readCodeU32()]!); break; // local.get
            case 0x21: locals[readCodeU32()] = valueStack.pop()!; break; // local.set
            case 0x23: valueStack.push(globals[readCodeU32()]!.value); break; // global.get
            case 0x24: globals[readCodeU32()]!.value = valueStack.pop()!; break; // global.set

            // --- Memory ---
            case 0x28: { // i32.load
                const align = readCodeU32(); void align;
                const offset = readCodeU32();
                const addr = (valueStack.pop()! as number) + offset;
                try { valueStack.push(getMemBuf().getInt32(addr, true)); }
                catch { throw new Error("wasm_trap: out of bounds memory access"); }
                break;
            }
            case 0x29: { // i64.load
                const align = readCodeU32(); void align;
                const offset = readCodeU32();
                const addr = (valueStack.pop()! as number) + offset;
                try {
                    const view = getMemBuf();
                    const lo = view.getUint32(addr, true);
                    const hi = view.getInt32(addr + 4, true);
                    valueStack.push((BigInt(hi) << 32n) | BigInt(lo));
                } catch { throw new Error("wasm_trap: out of bounds memory access"); }
                break;
            }
            case 0x2B: { // f64.load
                const align = readCodeU32(); void align;
                const offset = readCodeU32();
                const addr = (valueStack.pop()! as number) + offset;
                try { valueStack.push(getMemBuf().getFloat64(addr, true)); }
                catch { throw new Error("wasm_trap: out of bounds memory access"); }
                break;
            }
            case 0x2D: { // i32.load8_u
                const align = readCodeU32(); void align;
                const offset = readCodeU32();
                const addr = (valueStack.pop()! as number) + offset;
                try { valueStack.push(getMemU8()[addr]!); }
                catch { throw new Error("wasm_trap: out of bounds memory access"); }
                break;
            }
            case 0x36: { // i32.store
                const align = readCodeU32(); void align;
                const offset = readCodeU32();
                const val = valueStack.pop()! as number;
                const addr = (valueStack.pop()! as number) + offset;
                try { getMemBuf().setInt32(addr, val, true); }
                catch { throw new Error("wasm_trap: out of bounds memory access"); }
                break;
            }
            case 0x37: { // i64.store
                const align = readCodeU32(); void align;
                const offset = readCodeU32();
                const val = valueStack.pop()! as bigint;
                const addr = (valueStack.pop()! as number) + offset;
                try {
                    const view = getMemBuf();
                    view.setUint32(addr, Number(val & 0xFFFFFFFFn), true);
                    view.setInt32(addr + 4, Number(val >> 32n), true);
                } catch { throw new Error("wasm_trap: out of bounds memory access"); }
                break;
            }
            case 0x39: { // f64.store
                const align = readCodeU32(); void align;
                const offset = readCodeU32();
                const val = valueStack.pop()! as number;
                const addr = (valueStack.pop()! as number) + offset;
                try { getMemBuf().setFloat64(addr, val, true); }
                catch { throw new Error("wasm_trap: out of bounds memory access"); }
                break;
            }
            case 0x3A: { // i32.store8
                const align = readCodeU32(); void align;
                const offset = readCodeU32();
                const val = valueStack.pop()! as number;
                const addr = (valueStack.pop()! as number) + offset;
                try { getMemU8()[addr] = val & 0xFF; }
                catch { throw new Error("wasm_trap: out of bounds memory access"); }
                break;
            }

            // --- Constants ---
            case 0x41: valueStack.push(readCodeI32()); break; // i32.const
            case 0x42: valueStack.push(readCodeI64()); break; // i64.const
            case 0x44: valueStack.push(readCodeF64()); break; // f64.const

            // --- i32 comparison ---
            case 0x45: valueStack.push((valueStack.pop()! as number) === 0 ? 1 : 0); break; // i32.eqz
            case 0x46: { const b = valueStack.pop()!, a = valueStack.pop()!; valueStack.push(a === b ? 1 : 0); break; } // i32.eq
            case 0x47: { const b = valueStack.pop()!, a = valueStack.pop()!; valueStack.push(a !== b ? 1 : 0); break; } // i32.ne
            case 0x48: { const b = valueStack.pop()! as number, a = valueStack.pop()! as number; valueStack.push(a < b ? 1 : 0); break; } // i32.lt_s
            case 0x4A: { const b = valueStack.pop()! as number, a = valueStack.pop()! as number; valueStack.push(a > b ? 1 : 0); break; } // i32.gt_s
            case 0x4C: { const b = valueStack.pop()! as number, a = valueStack.pop()! as number; valueStack.push(a <= b ? 1 : 0); break; } // i32.le_s
            case 0x4E: { const b = valueStack.pop()! as number, a = valueStack.pop()! as number; valueStack.push(a >= b ? 1 : 0); break; } // i32.ge_s
            case 0x4F: { const b = valueStack.pop()! as number, a = valueStack.pop()! as number; valueStack.push((a >>> 0) >= (b >>> 0) ? 1 : 0); break; } // i32.ge_u

            // --- i64 comparison ---
            case 0x51: { const b = valueStack.pop()! as bigint, a = valueStack.pop()! as bigint; valueStack.push(a === b ? 1 : 0); break; }
            case 0x52: { const b = valueStack.pop()! as bigint, a = valueStack.pop()! as bigint; valueStack.push(a !== b ? 1 : 0); break; }
            case 0x53: { const b = valueStack.pop()! as bigint, a = valueStack.pop()! as bigint; valueStack.push(a < b ? 1 : 0); break; }
            case 0x55: { const b = valueStack.pop()! as bigint, a = valueStack.pop()! as bigint; valueStack.push(a > b ? 1 : 0); break; }
            case 0x57: { const b = valueStack.pop()! as bigint, a = valueStack.pop()! as bigint; valueStack.push(a <= b ? 1 : 0); break; }
            case 0x59: { const b = valueStack.pop()! as bigint, a = valueStack.pop()! as bigint; valueStack.push(a >= b ? 1 : 0); break; }

            // --- f64 comparison ---
            case 0x61: { const b = valueStack.pop()! as number, a = valueStack.pop()! as number; valueStack.push(a === b ? 1 : 0); break; }
            case 0x62: { const b = valueStack.pop()! as number, a = valueStack.pop()! as number; valueStack.push(a !== b ? 1 : 0); break; }
            case 0x63: { const b = valueStack.pop()! as number, a = valueStack.pop()! as number; valueStack.push(a < b ? 1 : 0); break; }
            case 0x64: { const b = valueStack.pop()! as number, a = valueStack.pop()! as number; valueStack.push(a > b ? 1 : 0); break; }
            case 0x65: { const b = valueStack.pop()! as number, a = valueStack.pop()! as number; valueStack.push(a <= b ? 1 : 0); break; }
            case 0x66: { const b = valueStack.pop()! as number, a = valueStack.pop()! as number; valueStack.push(a >= b ? 1 : 0); break; }

            // --- i32 arithmetic ---
            case 0x6A: { const b = valueStack.pop()! as number, a = valueStack.pop()! as number; valueStack.push((a + b) | 0); break; }
            case 0x6B: { const b = valueStack.pop()! as number, a = valueStack.pop()! as number; valueStack.push((a - b) | 0); break; }
            case 0x6C: { const b = valueStack.pop()! as number, a = valueStack.pop()! as number; valueStack.push(Math.imul(a, b)); break; }
            case 0x6D: { // i32.div_s
                const b = valueStack.pop()! as number, a = valueStack.pop()! as number;
                if (b === 0) throw new Error("wasm_trap: integer divide by zero");
                valueStack.push((a / b) | 0);
                break;
            }
            case 0x6F: { // i32.rem_s
                const b = valueStack.pop()! as number, a = valueStack.pop()! as number;
                if (b === 0) throw new Error("wasm_trap: integer divide by zero");
                valueStack.push(a % b);
                break;
            }
            case 0x71: { const b = valueStack.pop()! as number, a = valueStack.pop()! as number; valueStack.push(a & b); break; } // i32.and
            case 0x72: { const b = valueStack.pop()! as number, a = valueStack.pop()! as number; valueStack.push(a | b); break; } // i32.or

            // --- i64 arithmetic ---
            case 0x7C: { const b = valueStack.pop()! as bigint, a = valueStack.pop()! as bigint; valueStack.push(BigInt.asIntN(64, a + b)); break; }
            case 0x7D: { const b = valueStack.pop()! as bigint, a = valueStack.pop()! as bigint; valueStack.push(BigInt.asIntN(64, a - b)); break; }
            case 0x7E: { const b = valueStack.pop()! as bigint, a = valueStack.pop()! as bigint; valueStack.push(BigInt.asIntN(64, a * b)); break; }
            case 0x7F: { // i64.div_s
                const b = valueStack.pop()! as bigint, a = valueStack.pop()! as bigint;
                if (b === 0n) throw new Error("wasm_trap: integer divide by zero");
                valueStack.push(a / b);
                break;
            }
            case 0x81: { // i64.rem_s
                const b = valueStack.pop()! as bigint, a = valueStack.pop()! as bigint;
                if (b === 0n) throw new Error("wasm_trap: integer divide by zero");
                valueStack.push(a % b);
                break;
            }

            // --- f64 arithmetic ---
            case 0x9A: valueStack.push(-(valueStack.pop()! as number)); break; // f64.neg
            case 0xA0: { const b = valueStack.pop()! as number, a = valueStack.pop()! as number; valueStack.push(a + b); break; }
            case 0xA1: { const b = valueStack.pop()! as number, a = valueStack.pop()! as number; valueStack.push(a - b); break; }
            case 0xA2: { const b = valueStack.pop()! as number, a = valueStack.pop()! as number; valueStack.push(a * b); break; }
            case 0xA3: { const b = valueStack.pop()! as number, a = valueStack.pop()! as number; valueStack.push(a / b); break; }

            // --- Conversions ---
            case 0xB7: valueStack.push(valueStack.pop()! as number); break; // f64.convert_i32_s (no-op in JS, int→float implicit)

            default:
                throw new Error("wasm_trap: unimplemented opcode 0x" + op.toString(16).padStart(2, "0"));
        }
    }

    // Fell off end of function
    if (bodyArity > 0 && valueStack.length > 0) return valueStack.pop()!;
    return undefined;

    // --- Branch helper ---
    function branchTo(depth: number): void {
        if (depth >= controlStack.length) {
            // Branch past all control frames = return from function
            pc = codeLen;
            return;
        }
        const targetIdx = controlStack.length - 1 - depth;
        const frame = controlStack[targetIdx]!;

        if (frame.kind === "loop") {
            // Branch to loop = restart loop body
            pc = frame.startPc;
        } else {
            // Branch to block/if = jump to end
            pc = frame.endPc + 1;
            // Pop frames above target
            controlStack.length = targetIdx;
        }
    }
}

// =============================================================================
// Instruction Length Calculator (for prescan)
// =============================================================================

function instrLength(code: Uint8Array, pos: number): number {
    const op = code[pos]!;

    switch (op) {
        // Fixed-size instructions
        case 0x00: case 0x01: case 0x05: case 0x0B: case 0x1A:
        case 0x45: case 0x46: case 0x47: case 0x48: case 0x4A: case 0x4C: case 0x4E: case 0x4F:
        case 0x51: case 0x52: case 0x53: case 0x55: case 0x57: case 0x59:
        case 0x61: case 0x62: case 0x63: case 0x64: case 0x65: case 0x66:
        case 0x6A: case 0x6B: case 0x6C: case 0x6D: case 0x6F: case 0x71: case 0x72:
        case 0x7C: case 0x7D: case 0x7E: case 0x7F: case 0x81:
        case 0x9A: case 0xA0: case 0xA1: case 0xA2: case 0xA3: case 0xB7:
            return 1;

        // block/loop/if: opcode + blocktype byte
        case 0x02: case 0x03: case 0x04:
            return 2;

        // br, br_if, call: opcode + LEB128 u32
        case 0x0C: case 0x0D: case 0x10:
        // local.get/set, global.get/set: opcode + LEB128 u32
        case 0x20: case 0x21: case 0x23: case 0x24:
            return 1 + lebLength(code, pos + 1);

        // i32.const: opcode + LEB128 i32
        case 0x41:
            return 1 + lebLength(code, pos + 1);

        // i64.const: opcode + LEB128 i64
        case 0x42:
            return 1 + lebLength(code, pos + 1);

        // f64.const: opcode + 8 bytes
        case 0x44:
            return 9;

        // Memory ops: opcode + align(u32) + offset(u32)
        case 0x28: case 0x29: case 0x2B: case 0x2D:
        case 0x36: case 0x37: case 0x39: case 0x3A: {
            let p = pos + 1;
            p += lebLength(code, p); // align
            p += lebLength(code, p); // offset
            return p - pos;
        }

        // call_indirect: opcode + typeIdx(u32) + tableIdx(u32)
        case 0x11: {
            let p = pos + 1;
            p += lebLength(code, p); // typeIdx
            p += lebLength(code, p); // tableIdx
            return p - pos;
        }

        default:
            return 1; // Unknown — treat as 1 byte
    }
}

function lebLength(code: Uint8Array, pos: number): number {
    let len = 0;
    while (pos + len < code.length) {
        if ((code[pos + len]! & 0x80) === 0) return len + 1;
        len++;
    }
    return len;
}

// =============================================================================
// Module Instantiation
// =============================================================================

export function wasmInstantiate(
    bytes: Uint8Array,
    importObject?: Record<string, Record<string, unknown>>,
    options?: WasmInterpreterOptions,
): WasmInterpreterResult {
    const maxSteps = options?.maxSteps ?? 10_000_000;
    const mod = parseModule(bytes);

    // --- Link imported functions ---
    const allFuncs: RuntimeFunc[] = [];
    for (const imp of mod.imports) {
        if (imp.kind === 0) { // function import
            const ns = importObject?.[imp.module];
            if (!ns) throw new Error(`wasm_link: missing import ${imp.module}.${imp.name}`);
            const fn = ns[imp.name];
            if (typeof fn !== "function") throw new Error(`wasm_link: missing import ${imp.module}.${imp.name}`);
            allFuncs.push({ type: mod.types[imp.typeIdx!]!, kind: "imported", importFn: fn as Function });
        }
    }

    // --- Add local functions ---
    for (let i = 0; i < mod.funcTypeIndices.length; i++) {
        allFuncs.push({
            type: mod.types[mod.funcTypeIndices[i]!]!,
            kind: "local",
            body: mod.bodies[i],
        });
    }

    // --- Memory ---
    let memory: ArrayBuffer | null = null;
    const memoryObj: { buffer: ArrayBuffer } = { buffer: null as any };
    if (mod.hasMemory) {
        memory = new ArrayBuffer(mod.memoryInitial * 65536);
        memoryObj.buffer = memory;
    }
    // Check for imported memory
    for (const imp of mod.imports) {
        if (imp.kind === 2) {
            const ns = importObject?.[imp.module];
            const mem = ns?.[imp.name] as { buffer: ArrayBuffer } | undefined;
            if (mem && mem.buffer) {
                memory = mem.buffer;
                memoryObj.buffer = memory;
            }
        }
    }

    // --- Globals ---
    const globals: RuntimeGlobal[] = [];
    for (const g of mod.globals) {
        const value = evalConstExpr(g.initExpr);
        globals.push({ value: value as WasmValue, mutable: g.mutable });
    }

    // --- Table ---
    const tableSize = mod.tables.length > 0 ? mod.tables[0]!.initial : 0;
    const table: (RuntimeFunc | null)[] = new Array(tableSize).fill(null);

    // --- Initialize element segments ---
    for (const seg of mod.elements) {
        const offset = Number(evalConstExpr(seg.offsetExpr));
        for (let i = 0; i < seg.funcIndices.length; i++) {
            table[offset + i] = allFuncs[seg.funcIndices[i]!]!;
        }
    }

    // --- Initialize data segments ---
    if (memory) {
        const u8 = new Uint8Array(memory);
        for (const seg of mod.dataSegments) {
            const offset = Number(evalConstExpr(seg.offsetExpr));
            u8.set(seg.data, offset);
        }
    }

    // --- Build exports ---
    const exports: Record<string, unknown> = {};
    for (const exp of mod.exports) {
        if (exp.kind === 0) { // function export
            const func = allFuncs[exp.index]!;
            exports[exp.name] = (...args: unknown[]) => {
                const stepsRemaining = { count: maxSteps };
                const wasmArgs: WasmValue[] = args.map((a, i) => {
                    const paramType = func.type.params[i];
                    if (paramType === TYPE_I64) return BigInt(a as number);
                    return a as number;
                });
                return execute(func, wasmArgs, allFuncs, memory, memoryObj, globals, table, mod.types, stepsRemaining);
            };
        } else if (exp.kind === 2) { // memory export
            exports[exp.name] = memoryObj;
        }
    }

    return { instance: { exports } };
}
