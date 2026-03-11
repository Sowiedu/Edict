// =============================================================================
// Migration Tests
// =============================================================================

import { describe, it, expect } from "vitest";
import {
    applyMigration,
    migrateToLatest,
    CURRENT_SCHEMA_VERSION,
    MINIMUM_SCHEMA_VERSION,
    MIGRATION_REGISTRY,
} from "../../src/migration/migrate.js";
import type { Migration, MigrationOp } from "../../src/migration/migrate.js";
import { handleCheck, handleValidate, handleVersion } from "../../src/mcp/handlers.js";

// =============================================================================
// Helpers
// =============================================================================

function makeModule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        kind: "module",
        id: "mod-test-001",
        name: "test",
        imports: [],
        definitions: [
            {
                kind: "fn",
                id: "fn-main-001",
                name: "main",
                params: [],
                effects: ["io"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{ kind: "literal", id: "lit-001", value: 42 }],
            },
        ],
        ...overrides,
    };
}

// =============================================================================
// Unit tests: migrateToLatest
// =============================================================================

describe("migrateToLatest", () => {
    it("migrates v1.0 AST (no schemaVersion) to current", () => {
        const ast = makeModule(); // no schemaVersion → treated as 1.0
        const result = migrateToLatest(ast);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.fromVersion).toBe("1.0");
        expect(result.toVersion).toBe(CURRENT_SCHEMA_VERSION);
        expect(result.migrationsApplied).toBe(1);
        expect((result.ast as Record<string, unknown>).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    });

    it("returns unchanged for already-current AST", () => {
        const ast = makeModule({ schemaVersion: CURRENT_SCHEMA_VERSION });
        const result = migrateToLatest(ast);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.migrationsApplied).toBe(0);
        // Should be the exact same object (no clone needed)
        expect(result.ast).toBe(ast);
    });

    it("returns error for unsupported schema version", () => {
        const ast = makeModule({ schemaVersion: "99.0" });
        const result = migrateToLatest(ast);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({
            error: "unsupported_schema_version",
            version: "99.0",
            supportedRange: { min: MINIMUM_SCHEMA_VERSION, max: CURRENT_SCHEMA_VERSION },
        });
    });

    it("passes through non-object values (arrays, primitives)", () => {
        const result = migrateToLatest([1, 2, 3]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.migrationsApplied).toBe(0);
    });

    it("passes through null", () => {
        const result = migrateToLatest(null);
        expect(result.ok).toBe(true);
    });
});

// =============================================================================
// Unit tests: applyMigration
// =============================================================================

describe("applyMigration", () => {
    it("applies set_field op correctly", () => {
        const ast = makeModule();
        const migration: Migration = {
            from: "1.0",
            to: "1.1",
            ops: [{ op: "set_field", path: "schemaVersion", value: "1.1" }],
        };
        const result = applyMigration(ast, migration);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect((result.ast as Record<string, unknown>).schemaVersion).toBe("1.1");
        // Original should not be mutated
        expect((ast as Record<string, unknown>).schemaVersion).toBeUndefined();
    });

    it("applies add_field op correctly (adds only if missing)", () => {
        const ast = makeModule();
        const migration: Migration = {
            from: "1.0",
            to: "1.1",
            ops: [{ op: "add_field", path: "newField", default: "defaultValue" }],
        };
        const result = applyMigration(ast, migration);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect((result.ast as Record<string, unknown>).newField).toBe("defaultValue");
    });

    it("add_field does not overwrite existing value", () => {
        const ast = makeModule({ existingField: "original" });
        const migration: Migration = {
            from: "1.0",
            to: "1.1",
            ops: [{ op: "add_field", path: "existingField", default: "new" }],
        };
        const result = applyMigration(ast, migration);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect((result.ast as Record<string, unknown>).existingField).toBe("original");
    });

    it("applies remove_field op correctly", () => {
        const ast = makeModule({ toRemove: "value" });
        const migration: Migration = {
            from: "1.0",
            to: "1.1",
            ops: [{ op: "remove_field", path: "toRemove" }],
        };
        const result = applyMigration(ast, migration);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect("toRemove" in (result.ast as Record<string, unknown>)).toBe(false);
    });

    it("applies rename_field op correctly", () => {
        const ast = makeModule({ oldName: "value" });
        const migration: Migration = {
            from: "1.0",
            to: "1.1",
            ops: [{ op: "rename_field", path: "oldName", newName: "newName" }],
        };
        const result = applyMigration(ast, migration);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const obj = result.ast as Record<string, unknown>;
        expect(obj.newName).toBe("value");
        expect("oldName" in obj).toBe(false);
    });

    it("handles multiple ops in sequence", () => {
        const ast = makeModule();
        const migration: Migration = {
            from: "1.0",
            to: "1.1",
            ops: [
                { op: "set_field", path: "schemaVersion", value: "1.1" },
                { op: "add_field", path: "newField", default: true },
            ],
        };
        const result = applyMigration(ast, migration);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const obj = result.ast as Record<string, unknown>;
        expect(obj.schemaVersion).toBe("1.1");
        expect(obj.newField).toBe(true);
    });
});

// =============================================================================
// Migration registry
// =============================================================================

describe("MIGRATION_REGISTRY", () => {
    it("has at least one migration", () => {
        expect(MIGRATION_REGISTRY.length).toBeGreaterThanOrEqual(1);
    });

    it("first migration is from 1.0 to 1.1", () => {
        expect(MIGRATION_REGISTRY[0].from).toBe("1.0");
        expect(MIGRATION_REGISTRY[0].to).toBe("1.1");
    });

    it("forms a contiguous chain from MINIMUM to CURRENT", () => {
        let version = MINIMUM_SCHEMA_VERSION;
        for (const migration of MIGRATION_REGISTRY) {
            expect(migration.from).toBe(version);
            version = migration.to;
        }
        expect(version).toBe(CURRENT_SCHEMA_VERSION);
    });
});

// =============================================================================
// Pipeline integration
// =============================================================================

describe("pipeline integration", () => {
    it("handleValidate accepts v1.0 AST (auto-migrates)", () => {
        const ast = makeModule(); // no schemaVersion
        const result = handleValidate(ast);
        expect(result.ok).toBe(true);
    });

    it("handleCheck accepts v1.0 AST (auto-migrates)", async () => {
        const ast = makeModule();
        const result = await handleCheck(ast);
        expect(result.ok).toBe(true);
    });

    it("handleValidate rejects unsupported version", () => {
        const ast = makeModule({ schemaVersion: "99.0" });
        const result = handleValidate(ast);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.errors![0]).toMatchObject({ error: "unsupported_schema_version" });
    });
});

// =============================================================================
// Version handler
// =============================================================================

describe("handleVersion", () => {
    it("reports current schema version", () => {
        const version = handleVersion();
        expect(version.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    });

    it("lists supported schema versions", () => {
        const version = handleVersion();
        expect(version.supportedSchemaVersions).toContain("1.0");
        expect(version.supportedSchemaVersions).toContain("1.1");
    });

    it("has schemaMigrations feature flag", () => {
        const version = handleVersion();
        expect(version.features.schemaMigrations).toBe(true);
    });
});

// =============================================================================
// applyMigration — nested paths and error cases
// =============================================================================

describe("applyMigration — nested paths", () => {
    it("applies set_field on nested dot-path", () => {
        const ast = makeModule({ metadata: { version: "old" } });
        const migration: Migration = {
            from: "1.0",
            to: "1.1",
            ops: [{ op: "set_field", path: "metadata.version", value: "new" }],
        };
        const result = applyMigration(ast, migration);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect((result.ast as any).metadata.version).toBe("new");
    });

    it("applies add_field on nested dot-path (adds only if missing)", () => {
        const ast = makeModule({ metadata: { existing: true } });
        const migration: Migration = {
            from: "1.0",
            to: "1.1",
            ops: [{ op: "add_field", path: "metadata.newKey", default: "hello" }],
        };
        const result = applyMigration(ast, migration);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect((result.ast as any).metadata.newKey).toBe("hello");
    });

    it("throws error when path segment does not resolve to object", () => {
        const ast = makeModule({ flat: 42 });
        const migration: Migration = {
            from: "1.0",
            to: "1.1",
            ops: [{ op: "set_field", path: "flat.nested", value: "x" }],
        };
        const result = applyMigration(ast, migration);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.errors[0]).toMatchObject({ error: "migration_failed" });
    });

    it("rename_field on missing field is a no-op", () => {
        const ast = makeModule();
        const migration: Migration = {
            from: "1.0",
            to: "1.1",
            ops: [{ op: "rename_field", path: "nonexistentField", newName: "newField" }],
        };
        const result = applyMigration(ast, migration);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        // Neither the old nor new field should exist
        expect("nonexistentField" in (result.ast as Record<string, unknown>)).toBe(false);
        expect("newField" in (result.ast as Record<string, unknown>)).toBe(false);
    });

    it("remove_field on nested dot-path", () => {
        const ast = makeModule({ metadata: { toRemove: true, keep: true } });
        const migration: Migration = {
            from: "1.0",
            to: "1.1",
            ops: [{ op: "remove_field", path: "metadata.toRemove" }],
        };
        const result = applyMigration(ast, migration);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect("toRemove" in (result.ast as any).metadata).toBe(false);
        expect((result.ast as any).metadata.keep).toBe(true);
    });
});
