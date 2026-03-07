// =============================================================================
// Structured Error Constructor Branch Coverage Tests
// =============================================================================
// Tests the suggestion/detail branches in error factory functions that are
// conditionally included via `if (suggestion)` / `if (detail)` guards.

import { describe, it, expect } from "vitest";
import {
    undefinedReference,
    unknownRecord,
    unknownEnum,
    unknownVariant,
    typeMismatch,
    unknownField,
    missingRecordFields,
    effectViolation,
    effectInPure,
    analysisDiagnostic,
} from "../../src/errors/structured-errors.js";

const INT = { kind: "basic" as const, name: "Int" as const };
const FIX: { nodeId: string; field: string; value: unknown } = { nodeId: "n-001", field: "name", value: "fixed" };

describe("structured error constructors — suggestion branches", () => {
    // -------------------------------------------------------------------------
    // undefinedReference
    // -------------------------------------------------------------------------
    describe("undefinedReference", () => {
        it("includes suggestion when provided", () => {
            const err = undefinedReference("node-001", "foo", ["foo_bar"], FIX);
            expect(err.suggestion).toEqual(FIX);
        });

        it("omits suggestion when not provided", () => {
            const err = undefinedReference("node-001", "foo", ["foo_bar"]);
            expect(err.suggestion).toBeUndefined();
        });
    });

    // -------------------------------------------------------------------------
    // unknownRecord
    // -------------------------------------------------------------------------
    describe("unknownRecord", () => {
        it("includes suggestion when provided", () => {
            const err = unknownRecord("node-001", "Rec", ["Record"], FIX);
            expect(err.suggestion).toEqual(FIX);
        });

        it("omits suggestion when not provided", () => {
            const err = unknownRecord("node-001", "Rec", ["Record"]);
            expect(err.suggestion).toBeUndefined();
        });
    });

    // -------------------------------------------------------------------------
    // unknownEnum
    // -------------------------------------------------------------------------
    describe("unknownEnum", () => {
        it("includes suggestion when provided", () => {
            const err = unknownEnum("node-001", "Colr", ["Color"], FIX);
            expect(err.suggestion).toEqual(FIX);
        });

        it("omits suggestion when not provided", () => {
            const err = unknownEnum("node-001", "Colr", ["Color"]);
            expect(err.suggestion).toBeUndefined();
        });
    });

    // -------------------------------------------------------------------------
    // unknownVariant
    // -------------------------------------------------------------------------
    describe("unknownVariant", () => {
        it("includes suggestion when provided", () => {
            const err = unknownVariant("node-001", "Color", "Rd", ["Red", "Blue"], FIX);
            expect(err.suggestion).toEqual(FIX);
        });

        it("omits suggestion when not provided", () => {
            const err = unknownVariant("node-001", "Color", "Rd", ["Red", "Blue"]);
            expect(err.suggestion).toBeUndefined();
        });
    });

    // -------------------------------------------------------------------------
    // typeMismatch
    // -------------------------------------------------------------------------
    describe("typeMismatch", () => {
        it("includes suggestion when provided", () => {
            const err = typeMismatch("node-001", INT, { kind: "basic", name: "Float" }, FIX);
            expect(err.suggestion).toEqual(FIX);
        });

        it("omits suggestion when not provided", () => {
            const err = typeMismatch("node-001", INT, { kind: "basic", name: "Float" });
            expect(err.suggestion).toBeUndefined();
        });
    });

    // -------------------------------------------------------------------------
    // unknownField
    // -------------------------------------------------------------------------
    describe("unknownField", () => {
        it("includes suggestion when provided", () => {
            const err = unknownField("node-001", "Point", "xx", ["x", "y"], FIX);
            expect(err.suggestion).toEqual(FIX);
        });

        it("omits suggestion when not provided", () => {
            const err = unknownField("node-001", "Point", "xx", ["x", "y"]);
            expect(err.suggestion).toBeUndefined();
        });
    });

    // -------------------------------------------------------------------------
    // missingRecordFields
    // -------------------------------------------------------------------------
    describe("missingRecordFields", () => {
        it("includes suggestion when provided", () => {
            const err = missingRecordFields("node-001", "Point", ["y"], FIX);
            expect(err.suggestion).toEqual(FIX);
        });

        it("omits suggestion when not provided", () => {
            const err = missingRecordFields("node-001", "Point", ["y"]);
            expect(err.suggestion).toBeUndefined();
        });
    });

    // -------------------------------------------------------------------------
    // effectViolation
    // -------------------------------------------------------------------------
    describe("effectViolation", () => {
        it("includes suggestion when provided", () => {
            const err = effectViolation("fn-001", "main", ["io"], "call-001", "print", FIX);
            expect(err.suggestion).toEqual(FIX);
        });

        it("omits suggestion when not provided", () => {
            const err = effectViolation("fn-001", "main", ["io"], "call-001", "print");
            expect(err.suggestion).toBeUndefined();
        });
    });

    // -------------------------------------------------------------------------
    // effectInPure
    // -------------------------------------------------------------------------
    describe("effectInPure", () => {
        it("includes suggestion when provided", () => {
            const err = effectInPure("fn-001", "main", "call-001", "print", ["io"], FIX);
            expect(err.suggestion).toEqual(FIX);
        });

        it("omits suggestion when not provided", () => {
            const err = effectInPure("fn-001", "main", "call-001", "print", ["io"]);
            expect(err.suggestion).toBeUndefined();
        });
    });

    // -------------------------------------------------------------------------
    // analysisDiagnostic
    // -------------------------------------------------------------------------
    describe("analysisDiagnostic", () => {
        it("includes detail when provided", () => {
            const d = analysisDiagnostic("effect_skipped_import", "main", "fn-001", "effects", "import_name");
            expect(d.detail).toBe("import_name");
        });

        it("omits detail when not provided", () => {
            const d = analysisDiagnostic("effect_skipped_import", "main", "fn-001", "effects");
            expect(d.detail).toBeUndefined();
        });
    });
});
