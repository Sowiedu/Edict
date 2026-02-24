// =============================================================================
// Scope — Nested symbol table for name resolution
// =============================================================================

import type { TypeExpr } from "../ast/types.js";
import type { Definition } from "../ast/nodes.js";
import { duplicateDefinition, type DuplicateDefinitionError } from "../errors/structured-errors.js";

export type SymbolKind =
    | "function"
    | "param"
    | "let"
    | "const"
    | "type"
    | "record"
    | "enum"
    | "import"
    | "result";

export interface SymbolInfo {
    name: string;
    kind: SymbolKind;
    nodeId: string | null;
    type?: TypeExpr;
    definition?: Definition;
}

export class Scope {
    private symbols: Map<string, SymbolInfo> = new Map();
    private parent: Scope | null;

    constructor(parent: Scope | null = null) {
        this.parent = parent;
    }

    /**
     * Define a symbol in this scope.
     * Returns a DuplicateDefinitionError if the name already exists in THIS scope.
     */
    define(name: string, info: SymbolInfo): DuplicateDefinitionError | null {
        const existing = this.symbols.get(name);
        if (existing) {
            return duplicateDefinition(info.nodeId, name, existing.nodeId);
        }
        this.symbols.set(name, info);
        return null;
    }

    /**
     * Look up a symbol by walking the scope chain (current → parent → …).
     */
    lookup(name: string): SymbolInfo | undefined {
        const local = this.symbols.get(name);
        if (local) return local;
        return this.parent?.lookup(name);
    }

    /**
     * Collect all names visible from this scope (for Levenshtein suggestions).
     */
    allNames(): string[] {
        const names = new Set<string>(this.symbols.keys());
        if (this.parent) {
            for (const n of this.parent.allNames()) {
                names.add(n);
            }
        }
        return [...names];
    }

    /**
     * Create a child scope that inherits from this one.
     */
    child(): Scope {
        return new Scope(this);
    }
}
