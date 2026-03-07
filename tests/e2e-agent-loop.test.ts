// =============================================================================
// End-to-End Agent Loop Smoke Test
// =============================================================================
//
// Proves the Phase 1 acceptance criterion (FEATURE_SPEC §10):
//   "Give an LLM the schema, have it produce a valid AST, validate it"
//
// Extended to the full pipeline: validate → resolve → typeCheck → effectCheck
// → contractVerify → compile → run.
//
// Unlike tests/mcp/agent-simulation.test.ts (which uses MCP handlers), this
// test exercises the *raw public API* — proving the pipeline works
// independently of MCP transport.
//
// ─── Extending to a real LLM ───────────────────────────────────────────────
//
// Test case 4 is env-gated behind EDICT_LLM_API_KEY. To run it:
//
//   EDICT_LLM_API_KEY=sk-... npx vitest run tests/e2e-agent-loop.test.ts
//
// By default it calls OpenAI's chat completions API. Override:
//   EDICT_LLM_BASE_URL=https://your-provider.com/v1  (default: https://api.openai.com/v1)
//   EDICT_LLM_MODEL=gpt-4o                           (default: gpt-4o)
//
// To add more LLM scenarios, duplicate the test case and change the prompt.
// The pattern is: prompt → parse JSON → pipeline → assert.
// =============================================================================

import { describe, it, expect, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import {
    validate,
    resolve,
    typeCheck,
    effectCheck,
    contractVerify,
    resetZ3,
    compile,
} from "../src/index.js";
import { runDirect } from "../src/codegen/runner.js";
import type { EdictModule } from "../src/index.js";

afterAll(() => resetZ3());

// =============================================================================
// Test 1: Hardcoded "LLM response" → explicit pipeline → correct output
// =============================================================================

describe("e2e agent loop: hardcoded LLM response", () => {
    it("full pipeline: validate → resolve → typeCheck → effectCheck → contractVerify → compile → run", async () => {
        // Simulated LLM output: a program with a greet function and main
        // that calls greet, prints a message, and returns 42.
        const ast = {
            kind: "module",
            id: "mod-llm-001",
            name: "llm_generated",
            imports: [],
            definitions: [
                {
                    kind: "fn",
                    id: "fn-greet-001",
                    name: "greet",
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
                                    value: "Hello from the agent!",
                                },
                            ],
                        },
                        {
                            kind: "literal",
                            id: "lit-ret-001",
                            value: 42,
                        },
                    ],
                },
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
                            id: "call-greet-001",
                            fn: { kind: "ident", id: "ident-greet-001", name: "greet" },
                            args: [],
                        },
                    ],
                },
            ],
        };

        // Stage 1: Validate — structural correctness
        const vResult = validate(ast);
        expect(vResult.ok).toBe(true);
        if (!vResult.ok) return;

        const module = ast as EdictModule;

        // Stage 2a: Resolve — name resolution
        const resolveErrors = resolve(module);
        expect(resolveErrors).toEqual([]);

        // Stage 2b: Type check — type consistency
        const { errors: typeErrors } = typeCheck(module);
        expect(typeErrors).toEqual([]);

        // Stage 3: Effect check — effect consistency
        const { errors: effectErrors } = effectCheck(module);
        expect(effectErrors).toEqual([]);

        // Stage 4: Contract verify — pre/post conditions (no contracts here, but runs clean)
        const { errors: contractErrors } = await contractVerify(module);
        expect(contractErrors).toEqual([]);

        // Stage 5: Compile — AST → WASM
        const compileResult = compile(module);
        expect(compileResult.ok).toBe(true);
        if (!compileResult.ok) return;
        expect(compileResult.wasm).toBeInstanceOf(Uint8Array);

        // Stage 6: Run — execute WASM
        const runResult = await runDirect(compileResult.wasm);
        expect(runResult.output).toContain("Hello from the agent!");
        expect(runResult.returnValue).toBe(42);
        expect(runResult.exitCode).toBe(0);
    });
});

// =============================================================================
// Test 2: Self-repair loop — bug → structured error → fix → success
// =============================================================================

describe("e2e agent loop: self-repair", () => {
    it("type error → inspect structured error → fix → full pipeline succeeds", async () => {
        // Attempt 1: Agent writes main returning String but declares Int return type
        const buggyAst = {
            kind: "module",
            id: "mod-buggy-001",
            name: "buggy",
            imports: [],
            definitions: [
                {
                    kind: "fn",
                    id: "fn-main-001",
                    name: "main",
                    params: [],
                    returnType: { kind: "basic", name: "Int" },
                    effects: ["pure"],
                    contracts: [],
                    body: [
                        {
                            kind: "literal",
                            id: "lit-bad-001",
                            value: "oops this is a string",
                        },
                    ],
                },
            ],
        };

        // Validate passes — it's structurally valid
        const vResult = validate(buggyAst);
        expect(vResult.ok).toBe(true);
        if (!vResult.ok) return;

        const buggyModule = buggyAst as EdictModule;

        // Resolve passes — no name issues
        const resolveErrors = resolve(buggyModule);
        expect(resolveErrors).toEqual([]);

        // Type check fails — String returned where Int expected
        const { errors: typeErrors } = typeCheck(buggyModule);
        expect(typeErrors.length).toBeGreaterThan(0);

        // Agent inspects the structured error
        const typeError = typeErrors.find(
            (e) => typeof e === "object" && "error" in e && e.error === "type_mismatch",
        );
        expect(typeError).toBeDefined();
        // Verify error has actionable fields for the agent
        expect(typeError).toHaveProperty("nodeId");
        expect(typeError).toHaveProperty("expected");
        expect(typeError).toHaveProperty("actual");

        // ─── Agent self-repairs ───

        // Attempt 2: Fix by returning Int 0
        const fixedAst = {
            ...buggyAst,
            definitions: [
                {
                    ...buggyAst.definitions[0],
                    body: [
                        {
                            kind: "literal",
                            id: "lit-fixed-001",
                            value: 0,
                        },
                    ],
                },
            ],
        };

        const fixedModule = fixedAst as EdictModule;

        // All stages pass now
        const v2 = validate(fixedAst);
        expect(v2.ok).toBe(true);

        expect(resolve(fixedModule)).toEqual([]);
        expect(typeCheck(fixedModule).errors).toEqual([]);
        expect(effectCheck(fixedModule).errors).toEqual([]);
        expect((await contractVerify(fixedModule)).errors).toEqual([]);

        const compiled = compile(fixedModule);
        expect(compiled.ok).toBe(true);
        if (!compiled.ok) return;

        const result = await runDirect(compiled.wasm);
        expect(result.exitCode).toBe(0);
        expect(result.returnValue).toBe(0);
    });
});

// =============================================================================
// Test 3: All example programs pass the full explicit pipeline
// =============================================================================

describe("e2e agent loop: all examples through explicit pipeline", () => {
    const examplesDir = path.resolve(__dirname, "../examples");
    const files = fs.readdirSync(examplesDir)
        .filter((f) => f.endsWith(".edict.json"))
        .sort();

    // Examples with contracts need Z3 — they're handled but we include them
    for (const file of files) {
        it(`${file} passes validate → resolve → typeCheck → effectCheck → compile`, async () => {
            const ast = JSON.parse(
                fs.readFileSync(path.join(examplesDir, file), "utf-8"),
            );

            // Stage 1: Validate
            const vResult = validate(ast);
            expect(vResult.ok).toBe(true);
            if (!vResult.ok) return;

            const module = ast as EdictModule;

            // Stage 2a: Resolve
            const resolveErrors = resolve(module);
            expect(resolveErrors).toEqual([]);

            // Stage 2b: Type check
            const { errors: typeErrors } = typeCheck(module);
            expect(typeErrors).toEqual([]);

            // Stage 3: Effect check
            const { errors: effectErrors } = effectCheck(module);
            expect(effectErrors).toEqual([]);

            // Stage 4: Contract verify (includes Z3 for examples with contracts)
            const { errors: contractErrors } = await contractVerify(module);
            expect(contractErrors).toEqual([]);

            // Stage 5: Compile to WASM
            const compileResult = compile(module);
            expect(compileResult.ok).toBe(true);
        });
    }
});

// =============================================================================
// Test 4: Real LLM integration (env-gated)
// =============================================================================
//
// To run this test:
//   EDICT_LLM_API_KEY=sk-... npx vitest run tests/e2e-agent-loop.test.ts
//
// Supported providers (auto-detected from key prefix):
//   - OpenAI:    sk-... keys → calls /v1/chat/completions
//   - Anthropic: sk-ant-... keys → calls /v1/messages
//
// Optional env vars:
//   EDICT_LLM_BASE_URL - Override the API base URL
//   EDICT_LLM_MODEL    - Model name (default: gpt-4o for OpenAI, claude-sonnet-4-6 for Anthropic)
//
// This test is inherently non-deterministic. It proves the real agent
// experience: can an LLM read the schema and produce a valid program?
// Failures here reveal schema clarity issues, not compiler bugs.

const LLM_API_KEY = process.env.EDICT_LLM_API_KEY;
const IS_ANTHROPIC = LLM_API_KEY?.startsWith("sk-ant-") ?? false;
const LLM_BASE_URL = process.env.EDICT_LLM_BASE_URL ??
    (IS_ANTHROPIC ? "https://api.anthropic.com" : "https://api.openai.com/v1");
const LLM_MODEL = process.env.EDICT_LLM_MODEL ??
    (IS_ANTHROPIC ? "claude-sonnet-4-6" : "gpt-4o");

/** Call an LLM and return the text response. Supports OpenAI and Anthropic APIs. */
async function callLLM(prompt: string): Promise<string> {
    if (IS_ANTHROPIC) {
        const response = await fetch(`${LLM_BASE_URL}/v1/messages`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": LLM_API_KEY!,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
                model: LLM_MODEL,
                max_tokens: 8192,
                messages: [{ role: "user", content: prompt }],
                temperature: 0,
            }),
        });
        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Anthropic API ${response.status}: ${err}`);
        }
        const data = await response.json() as {
            content: { type: string; text: string }[];
        };
        return data.content[0].text;
    } else {
        const response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${LLM_API_KEY}`,
            },
            body: JSON.stringify({
                model: LLM_MODEL,
                messages: [{ role: "user", content: prompt }],
                temperature: 0,
                response_format: { type: "json_object" },
            }),
        });
        if (!response.ok) {
            const err = await response.text();
            throw new Error(`OpenAI API ${response.status}: ${err}`);
        }
        const data = await response.json() as {
            choices: { message: { content: string } }[];
        };
        return data.choices[0].message.content;
    }
}

describe("e2e agent loop: real LLM integration", () => {
    const runLLM = LLM_API_KEY ? it : it.skip;

    runLLM("LLM reads schema → produces factorial AST → full pipeline → correct output", async () => {
        // Read the JSON schema — same one the MCP edict_schema tool returns
        const schemaPath = path.resolve(__dirname, "../schema/edict.schema.json");
        const schema = fs.readFileSync(schemaPath, "utf-8");

        // Ask the LLM to produce a valid Edict AST
        const prompt = [
            "You are given a JSON schema for the Edict programming language AST.",
            "Produce a valid Edict program as a JSON AST that computes factorial(5).",
            "The program must have:",
            "- A recursive `factorial` function that takes an Int parameter `n`",
            "- If n <= 1 return 1, else return n * factorial(n-1)",
            "- A `main` function that calls factorial(5) and returns the result",
            "- Both functions should have effects: [\"pure\"] and correct return types",
            "- Every node must have a unique `id` field following the pattern: kind-name-NNN",
            "- The `fn` field in call expressions must be an object: { kind: \"ident\", id: \"...\", name: \"functionName\" }",
            "",
            "Return ONLY the raw JSON object. No markdown fences. No explanation.",
            "",
            "Schema:",
            schema,
        ].join("\n");

        const llmOutput = await callLLM(prompt);

        // Extract JSON — LLM might wrap in markdown code fences
        let jsonStr = llmOutput.trim();
        const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fenceMatch) jsonStr = fenceMatch[1].trim();

        const ast = JSON.parse(jsonStr);

        // Run through the full pipeline
        const vResult = validate(ast);
        if (!vResult.ok) {
            console.log("LLM validation errors:", JSON.stringify(vResult.errors, null, 2));
        }
        expect(vResult.ok).toBe(true);
        if (!vResult.ok) return;

        const module = ast as EdictModule;

        const resolveErrors = resolve(module);
        if (resolveErrors.length > 0) {
            console.log("LLM resolve errors:", JSON.stringify(resolveErrors, null, 2));
        }
        expect(resolveErrors).toEqual([]);

        const { errors: typeErrors } = typeCheck(module);
        if (typeErrors.length > 0) {
            console.log("LLM type errors:", JSON.stringify(typeErrors, null, 2));
        }
        expect(typeErrors).toEqual([]);

        const { errors: effectErrors } = effectCheck(module);
        expect(effectErrors).toEqual([]);

        const { errors: contractErrors2 } = await contractVerify(module);
        expect(contractErrors2).toEqual([]);

        const compileResult = compile(module);
        expect(compileResult.ok).toBe(true);
        if (!compileResult.ok) return;

        const runResult = await runDirect(compileResult.wasm);
        expect(runResult.exitCode).toBe(0);
        expect(runResult.returnValue).toBe(120); // 5! = 120
    }, 60_000); // 60s timeout for LLM API call
});
