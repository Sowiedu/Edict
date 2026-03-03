// =============================================================================
// MCP Tool Handlers — Pure functions (no MCP SDK dependency)
// =============================================================================
// Each handler takes validated input and returns a structured result.
// Extracted from the server for testability.

import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { validate } from "../validator/validate.js";
import { check } from "../check.js";
import { compile } from "../codegen/codegen.js";
import { run } from "../codegen/runner.js";
import type { StructuredError } from "../errors/structured-errors.js";

// =============================================================================
// Path resolution (relative to this file, works regardless of cwd)
// =============================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..", "..");
const schemaPath = resolve(projectRoot, "schema", "edict.schema.json");
const examplesDir = resolve(projectRoot, "examples");

// =============================================================================
// Cached assets (loaded once at startup)
// =============================================================================

let cachedSchema: string | null = null;
let cachedExamples: { name: string; ast: unknown }[] | null = null;

function loadSchema(): string {
    if (!cachedSchema) {
        cachedSchema = readFileSync(schemaPath, "utf-8");
    }
    return cachedSchema;
}

function loadExamples(): { name: string; ast: unknown }[] {
    if (!cachedExamples) {
        const files = readdirSync(examplesDir)
            .filter((f) => f.endsWith(".edict.json"))
            .sort();
        cachedExamples = files.map((f) => ({
            name: f.replace(".edict.json", ""),
            ast: JSON.parse(readFileSync(resolve(examplesDir, f), "utf-8")) as unknown,
        }));
    }
    return cachedExamples;
}

// =============================================================================
// Handler results
// =============================================================================

export interface SchemaResult {
    schema: unknown;
}

export interface ExamplesResult {
    count: number;
    examples: { name: string; ast: unknown }[];
}

export interface ValidateResult {
    ok: boolean;
    errors?: StructuredError[];
}

export interface CheckResult {
    ok: boolean;
    errors?: StructuredError[];
}

export interface CompileResult {
    ok: boolean;
    wasm?: string; // base64
    errors?: StructuredError[] | string[];
}

export interface RunResult {
    output: string;
    exitCode: number;
    returnValue?: number;
}

// =============================================================================
// Handlers
// =============================================================================

export function handleSchema(): SchemaResult {
    const raw = loadSchema();
    return { schema: JSON.parse(raw) as unknown };
}

export function handleExamples(): ExamplesResult {
    const examples = loadExamples();
    return { count: examples.length, examples };
}

export function handleValidate(ast: unknown): ValidateResult {
    const result = validate(ast);
    if (result.ok) {
        return { ok: true };
    }
    return { ok: false, errors: result.errors };
}

export async function handleCheck(ast: unknown): Promise<CheckResult> {
    const result = await check(ast);
    if (result.ok) {
        return { ok: true };
    }
    return { ok: false, errors: result.errors };
}

export async function handleCompile(ast: unknown): Promise<CompileResult> {
    // Full pipeline: check first, then compile
    const checkResult = await check(ast);
    if (!checkResult.ok || !checkResult.module) {
        return { ok: false, errors: checkResult.errors };
    }

    const compileResult = compile(checkResult.module);
    if (!compileResult.ok) {
        return { ok: false, errors: compileResult.errors };
    }

    // Encode WASM as base64
    const base64 = Buffer.from(compileResult.wasm).toString("base64");
    return { ok: true, wasm: base64 };
}

export async function handleRun(wasmBase64: string): Promise<RunResult> {
    const wasmBytes = new Uint8Array(Buffer.from(wasmBase64, "base64"));
    const result = await run(wasmBytes);
    return {
        output: result.output,
        exitCode: result.exitCode,
        returnValue: result.returnValue,
    };
}
