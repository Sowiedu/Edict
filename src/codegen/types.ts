// =============================================================================
// Codegen Types — Shared types for the WASM code generator
// =============================================================================
// Extracted from codegen.ts for modularity.

import binaryen from "binaryen";
import type { StructuredError } from "../errors/structured-errors.js";
import type { StringTable } from "./string-table.js";
import type { TypeExpr } from "../ast/types.js";

// =============================================================================
// Edict → WASM type mapping
// =============================================================================

export function edictTypeToWasm(type: TypeExpr): binaryen.Type {
    if (type.kind === "basic") {
        switch (type.name) {
            case "Int":
                return binaryen.i32;
            case "Float":
                return binaryen.f64;
            case "Bool":
                return binaryen.i32;
            case "String":
                // Strings are (ptr, len) → we use i32 for the pointer.
                return binaryen.i32;
        }
    }
    if (type.kind === "option") {
        return binaryen.i32; // heap pointer to tagged union
    }
    if (type.kind === "unit_type") {
        return binaryen.none;
    }
    // Fallback for anything else
    return binaryen.i32;
}

// =============================================================================
// Compilation context (per-compile() invocation state)
// =============================================================================

/**
 * Bundles the compile-wide state shared across all expression compilers.
 * Created once per `compile()` call. `FunctionContext` is separate because
 * it changes per function/lambda scope.
 *
 * `lambdaCounter` is scoped here (not module-global) so multiple
 * `compile()` calls in the same process don't leak state.
 */
export interface CompilationContext {
    readonly mod: binaryen.Module;
    readonly strings: StringTable;
    readonly fnSigs: Map<string, FunctionSig>;
    readonly errors: StructuredError[];
    lambdaCounter: number;
}

// =============================================================================
// Result types
// =============================================================================

export interface CompileSuccess {
    ok: true;
    wasm: Uint8Array;
    wat?: string; // WAT text for debugging — only emitted if CompileOptions.emitWat is true
}

export interface CompileFailure {
    ok: false;
    errors: StructuredError[];
}

export type CompileResult = CompileSuccess | CompileFailure;

/** Options for WASM code generation */
export interface CompileOptions {
    /** Maximum WASM memory pages (64KB each). Default: 16 (= 1MB) */
    maxMemoryPages?: number;
    /** Emit WAT text alongside binary. Default: false */
    emitWat?: boolean;
}

// =============================================================================
// Function signature registry (for cross-function call return types)
// =============================================================================

export interface FunctionSig {
    returnType: binaryen.Type;
    paramTypes?: binaryen.Type[];
}

// =============================================================================
// Layout types (for heap-allocated records, enums, tuples)
// =============================================================================

export interface LocalEntry {
    index: number;
    type: binaryen.Type;
    edictTypeName?: string;
}

export interface FieldLayout {
    name: string;
    offset: number;
    wasmType: binaryen.Type;
}

export interface EnumVariantLayout {
    name: string;
    tag: number;
    fields: FieldLayout[];
    totalSize: number;
}

export interface EnumLayout {
    variants: EnumVariantLayout[];
}

export interface RecordLayout {
    fields: FieldLayout[];
    totalSize: number;
}

// =============================================================================
// Function context (per-function compiler state)
// =============================================================================

export class FunctionContext {
    private nextIndex: number;
    private locals = new Map<string, LocalEntry>();
    readonly varTypes: binaryen.Type[] = [];
    readonly constGlobals: Map<string, binaryen.Type>;
    readonly recordLayouts: Map<string, RecordLayout>;
    readonly enumLayouts: Map<string, EnumLayout>;
    readonly fnTableIndices: Map<string, number>;
    readonly tableFunctions: string[];

    constructor(
        params: { name: string; wasmType: binaryen.Type; edictTypeName?: string }[],
        constGlobals: Map<string, binaryen.Type> = new Map(),
        recordLayouts: Map<string, RecordLayout> = new Map(),
        enumLayouts: Map<string, EnumLayout> = new Map(),
        fnTableIndices: Map<string, number> = new Map(),
        tableFunctions: string[] = [],
    ) {
        this.nextIndex = 0;
        this.constGlobals = constGlobals;
        this.recordLayouts = recordLayouts;
        this.enumLayouts = enumLayouts;
        this.fnTableIndices = fnTableIndices;
        this.tableFunctions = tableFunctions;
        for (const p of params) {
            this.locals.set(p.name, { index: this.nextIndex, type: p.wasmType, edictTypeName: p.edictTypeName });
            this.nextIndex++;
        }
    }

    getLocal(name: string): LocalEntry | undefined {
        return this.locals.get(name);
    }

    addLocal(name: string, type: binaryen.Type, edictTypeName?: string): number {
        const index = this.nextIndex++;
        this.locals.set(name, { index, type, edictTypeName });
        this.varTypes.push(type);
        return index;
    }
}
