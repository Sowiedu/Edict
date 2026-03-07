// =============================================================================
// End-to-End Agent Simulation Test
// =============================================================================
// Proves the roadmap's Phase 6 verification criterion:
// "Give an LLM the schema, ask it to write a program, compile and run it via MCP tools."
//
// Simulates the full agent loop:
//   1. Agent calls edict_schema → learns the AST format
//   2. Agent writes a program with a bug → edict_compile → gets structured errors
//   3. Agent fixes the bug → edict_compile → gets WASM
//   4. Agent runs the WASM → edict_run → gets output
//
// This test does NOT use an actual LLM — it simulates the agent's actions directly.

import { describe, it, expect } from "vitest";
import {
    handleSchema,
    handleExamples,
    handleValidate,
    handleCheck,
    handleCompile,
} from "../../src/mcp/handlers.js";
import { runDirect } from "../../src/codegen/runner.js";

describe("agent simulation: full loop", () => {
    it("schema → write buggy program → fix → compile → run", async () => {
        // ─────────────────────────────────────────────────────────
        // Step 1: Agent reads the schema to learn the AST format
        // ─────────────────────────────────────────────────────────
        const schema = handleSchema();
        expect(schema.schema).toBeDefined();

        // Agent also reads examples to learn patterns
        const examples = handleExamples();
        expect(examples.count).toBe(19);

        // ─────────────────────────────────────────────────────────
        // Step 2: Agent writes a program — but with a type error
        // (declares Int return, but body returns String)
        // ─────────────────────────────────────────────────────────
        const buggyProgram = {
            kind: "module",
            id: "mod-agent-001",
            name: "agent_attempt",
            imports: [],
            definitions: [
                {
                    kind: "fn",
                    id: "fn-main-001",
                    name: "main",
                    params: [],
                    returnType: { kind: "basic", name: "Int" },
                    effects: ["io"],
                    contracts: [],
                    body: [
                        {
                            kind: "call",
                            id: "call-print-001",
                            fn: { kind: "ident", id: "ident-print-001", name: "print" },
                            args: [
                                {
                                    kind: "literal",
                                    id: "lit-msg-001",
                                    value: "Agent says hello!",
                                },
                            ],
                        },
                        // BUG: returning a string instead of Int
                        {
                            kind: "literal",
                            id: "lit-return-001",
                            value: "not an int",
                        },
                    ],
                },
            ],
        };

        // Agent submits for compilation
        const attempt1 = await handleCompile(buggyProgram);
        expect(attempt1.ok).toBe(false);
        expect(attempt1.errors).toBeDefined();

        // Agent reads the structured error — finds type_mismatch
        const typeError = attempt1.errors!.find(
            (e) => typeof e === "object" && "error" in e && e.error === "type_mismatch",
        );
        expect(typeError).toBeDefined();

        // ─────────────────────────────────────────────────────────
        // Step 3: Agent fixes the bug (returns 0 instead of string)
        // ─────────────────────────────────────────────────────────
        const fixedProgram = {
            ...buggyProgram,
            definitions: [
                {
                    kind: "fn",
                    id: "fn-main-001",
                    name: "main",
                    params: [],
                    returnType: { kind: "basic", name: "Int" },
                    effects: ["io"],
                    contracts: [],
                    body: [
                        {
                            kind: "call",
                            id: "call-print-001",
                            fn: { kind: "ident", id: "ident-print-001", name: "print" },
                            args: [
                                {
                                    kind: "literal",
                                    id: "lit-msg-001",
                                    value: "Agent says hello!",
                                },
                            ],
                        },
                        // FIX: return Int 0
                        {
                            kind: "literal",
                            id: "lit-return-001",
                            value: 0,
                        },
                    ],
                },
            ],
        };

        const attempt2 = await handleCompile(fixedProgram);
        expect(attempt2.ok).toBe(true);
        expect(attempt2.wasm).toBeDefined();

        // ─────────────────────────────────────────────────────────
        // Step 4: Agent runs the compiled WASM
        // ─────────────────────────────────────────────────────────
        const wasmBytes = new Uint8Array(Buffer.from(attempt2.wasm!, "base64"));
        const result = await runDirect(wasmBytes);
        expect(result.exitCode).toBe(0);
        expect(result.output).toContain("Agent says hello!");
        expect(result.returnValue).toBe(0);
    });

    it("schema → write program with effect violation → fix → compile → run", async () => {
        // ─────────────────────────────────────────────────────────
        // Agent writes a pure function that calls print (io effect)
        // ─────────────────────────────────────────────────────────
        const effectBug = {
            kind: "module",
            id: "mod-eff-001",
            name: "effect_test",
            imports: [],
            definitions: [
                {
                    kind: "fn",
                    id: "fn-sneaky-001",
                    name: "main",
                    params: [],
                    returnType: { kind: "basic", name: "Int" },
                    effects: ["pure"], // BUG: claims pure but calls print (io)
                    contracts: [],
                    body: [
                        {
                            kind: "call",
                            id: "call-print-eff-001",
                            fn: { kind: "ident", id: "ident-print-eff-001", name: "print" },
                            args: [
                                { kind: "literal", id: "lit-eff-001", value: "sneaky io" },
                            ],
                        },
                        { kind: "literal", id: "lit-ret-eff-001", value: 0 },
                    ],
                },
            ],
        };

        // Check catches the effect violation
        const check1 = await handleCheck(effectBug);
        expect(check1.ok).toBe(false);
        const effectError = check1.errors!.find(
            (e) => typeof e === "object" && "error" in e && e.error === "effect_in_pure",
        );
        expect(effectError).toBeDefined();

        // ─────────────────────────────────────────────────────────
        // Agent fixes by declaring io effect
        // ─────────────────────────────────────────────────────────
        const fixed = {
            ...effectBug,
            definitions: [
                {
                    ...effectBug.definitions[0],
                    effects: ["io"], // FIX: declare io
                },
            ],
        };

        const compiled = await handleCompile(fixed);
        expect(compiled.ok).toBe(true);

        const wasmBytes = new Uint8Array(Buffer.from(compiled.wasm!, "base64"));
        const result = await runDirect(wasmBytes);
        expect(result.exitCode).toBe(0);
        expect(result.output).toContain("sneaky io");
    });

    it("schema → write program with contract → verify → compile → run", async () => {
        // ─────────────────────────────────────────────────────────
        // Agent writes a function with a provable contract
        // ─────────────────────────────────────────────────────────
        const program = {
            kind: "module",
            id: "mod-contract-001",
            name: "contract_test",
            imports: [],
            definitions: [
                {
                    kind: "fn",
                    id: "fn-incr-001",
                    name: "increment",
                    params: [
                        {
                            kind: "param",
                            id: "param-x-001",
                            name: "x",
                            type: { kind: "basic", name: "Int" },
                        },
                    ],
                    returnType: { kind: "basic", name: "Int" },
                    effects: ["pure"],
                    contracts: [
                        {
                            kind: "post",
                            id: "post-001",
                            condition: {
                                kind: "binop",
                                id: "cond-001",
                                op: ">",
                                left: { kind: "ident", id: "ident-result-001", name: "result" },
                                right: { kind: "ident", id: "ident-x-001", name: "x" },
                            },
                        },
                    ],
                    body: [
                        {
                            kind: "binop",
                            id: "expr-add-001",
                            op: "+",
                            left: { kind: "ident", id: "ident-x-body-001", name: "x" },
                            right: { kind: "literal", id: "lit-one-001", value: 1 },
                        },
                    ],
                },
                {
                    kind: "fn",
                    id: "fn-main-002",
                    name: "main",
                    params: [],
                    returnType: { kind: "basic", name: "Int" },
                    effects: ["pure"],
                    contracts: [],
                    body: [
                        {
                            kind: "call",
                            id: "call-incr-001",
                            fn: { kind: "ident", id: "ident-incr-001", name: "increment" },
                            args: [
                                { kind: "literal", id: "lit-five-001", value: 5 },
                            ],
                        },
                    ],
                },
            ],
        };

        // Full check passes (including contract verification by Z3)
        const check = await handleCheck(program);
        expect(check.ok).toBe(true);

        // Compile and run
        const compiled = await handleCompile(program);
        expect(compiled.ok).toBe(true);

        const wasmBytes = new Uint8Array(Buffer.from(compiled.wasm!, "base64"));
        const result = await runDirect(wasmBytes);
        expect(result.exitCode).toBe(0);
        expect(result.returnValue).toBe(6); // increment(5) = 6
    });

    it("validate catches structural errors before check", async () => {
        // Agent submits malformed AST (missing required fields)
        const malformed = {
            kind: "module",
            // missing id, name, imports, definitions
        };

        const validateResult = handleValidate(malformed);
        expect(validateResult.ok).toBe(false);
        expect(validateResult.errors!.length).toBeGreaterThan(0);
    });
});
