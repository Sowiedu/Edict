// =============================================================================
// Agent Bootstrap Guide — structured onboarding for MCP-only agents
// =============================================================================
// Provides the MCP `instructions` string and a full agent guide containing
// workflow, template, rules, error recovery, builtins, and tool reference.
// Designed for ≤ 3K tokens (~12K chars JSON).

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_FUNCTIONS } from "../builtins/builtins.js";

/** Compute __dirname safely — falls back to cwd in CJS bundles where import.meta.url is empty. */
function getDirname(): string {
    try {
        return dirname(fileURLToPath(import.meta.url));
    } catch {
        return process.cwd();
    }
}

const projectRoot = resolve(getDirname(), "..", "..");

// =============================================================================
// MCP Server Instructions — short bootstrap hint (~200 tokens)
// =============================================================================

export const EDICT_INSTRUCTIONS =
    "Edict is a programming language for AI agents. Programs are JSON ASTs, not text. " +
    "Call edict_schema(format: 'agent') ONCE to bootstrap — it returns the schema, builtins, effects, compact format maps, and an agent guide. " +
    "Then: write your program as a JSON AST → call edict_check → fix errors using the structured error response → call edict_compile → call edict_run. " +
    "NEVER re-fetch schema or examples within the same session. Cache the response from edict_schema.";

// =============================================================================
// Agent Guide — full structured guide (~2-3K tokens)
// =============================================================================

export interface AgentGuide {
    whatIsEdict: string;
    workflow: string[];
    template: unknown;
    rules: string[];
    errorRecovery: string[];
    builtins: string[];
    toolReference: Record<string, string>;
}

let cachedGuide: AgentGuide | null = null;

export function buildAgentGuide(): AgentGuide {
    if (cachedGuide) return cachedGuide;

    // Load hello-world template from examples (auto-updates if example changes)
    const templatePath = resolve(projectRoot, "examples", "hello.edict.json");
    const template = JSON.parse(readFileSync(templatePath, "utf-8"));

    cachedGuide = {
        whatIsEdict:
            "Edict programs are JSON ASTs, not text. " +
            "The compiler validates, type-checks, verifies contracts via Z3, and compiles to WebAssembly.",

        workflow: [
            "1. Call edict_schema(format: 'agent') ONCE — cache the response",
            "2. Write your program as a JSON AST conforming to the schema",
            "3. Call edict_check — if errors, read the structured error and fix your AST",
            "4. Call edict_compile to get a WASM binary (base64)",
            "5. Call edict_run with the WASM binary to execute",
            "6. NEVER re-fetch schema or examples — use your cached response",
        ],

        template,

        rules: [
            "Every AST node needs a unique 'id' field (convention: {kind}-{name}-{NNN}, e.g. 'fn-main-001')",
            "Every module needs a 'main' function with returnType { kind: 'basic', name: 'Int' }",
            "Functions calling 'print' or other IO builtins need effects: ['io']",
            "Enum variants need fields: [] even when they carry no data",
            "Use compact format (k, i, n instead of kind, id, name) to save tokens",
            "The module must have kind: 'module', id, name, imports: [], and definitions: [...]",
        ],

        errorRecovery: [
            "Read the 'error' field — it tells you exactly what went wrong (e.g. 'type_mismatch', 'undefined_reference')",
            "Check 'suggestion' or 'candidates' — they contain concrete fixes or similar valid names ranked by relevance",
            "Check 'validKinds' — if present, it lists all valid node kind values you can use",
        ],

        builtins: Array.from(BUILTIN_FUNCTIONS.keys()),

        toolReference: {
            edict_schema: "Get the JSON Schema defining valid AST programs. Use format 'agent' for one-call bootstrapping.",
            edict_check: "Full pipeline check: validate + resolve names + type-check + effect-check + verify contracts. Use this before compile.",
            edict_compile: "Compile a valid AST to WebAssembly (base64). Runs full check first.",
            edict_run: "Execute a compiled WASM binary. Returns output and exit code.",
            edict_validate: "Schema validation only (no type/effect checking). Use edict_check instead for full checking.",
            edict_patch: "Apply targeted AST patches by nodeId — fix specific nodes without rewriting the whole AST.",
            edict_debug: "Compile and run with step-level tracing. Returns call stack and crash location if applicable.",
            edict_examples: "Get all example programs as AST JSON. Includes schema snippet for bootstrapping.",
            edict_errors: "Machine-readable catalog of all error types the compiler can produce.",
            edict_explain: "Explain a structured error — returns pipeline stage, cause, and repair strategy.",
            edict_lint: "Non-blocking quality warnings (unused variables, naming conventions, etc.).",
        },
    };

    return cachedGuide;
}
