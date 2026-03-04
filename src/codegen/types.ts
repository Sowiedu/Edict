// =============================================================================
// Codegen Types — Shared types for the WASM code generator
// =============================================================================
// Extracted from codegen.ts for modularity.

import binaryen from "binaryen";
import type { StructuredError } from "../errors/structured-errors.js";

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

    constructor(
        params: { name: string; wasmType: binaryen.Type; edictTypeName?: string }[],
        constGlobals: Map<string, binaryen.Type> = new Map(),
        recordLayouts: Map<string, RecordLayout> = new Map(),
        enumLayouts: Map<string, EnumLayout> = new Map(),
    ) {
        this.nextIndex = 0;
        this.constGlobals = constGlobals;
        this.recordLayouts = recordLayouts;
        this.enumLayouts = enumLayouts;
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
