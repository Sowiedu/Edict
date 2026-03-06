// =============================================================================
// MCP Prompt Templates — Pre-built system prompts for agent bootstrapping
// =============================================================================
// Each function returns a GetPromptResult-compatible object with messages.
// Prompts include the minimal schema (token-efficient) and relevant examples
// so agents can bootstrap themselves with Edict in a single prompt retrieval.

import { handleSchema, handleExamples, handleVersion } from "./handlers.js";
import { BUILTIN_FUNCTIONS } from "../builtins/builtins.js";

// =============================================================================
// Types (mirrors GetPromptResult from MCP SDK)
// =============================================================================

export interface PromptMessage {
    role: "user" | "assistant";
    content: { type: "text"; text: string };
}

export interface PromptResult {
    [key: string]: unknown;
    description?: string;
    messages: PromptMessage[];
}

// =============================================================================
// Helpers
// =============================================================================

function getMinimalSchema(): string {
    const result = handleSchema("minimal");
    return JSON.stringify(result.schema);
}

function getHelloExample(): string {
    const examples = handleExamples();
    const hello = examples.examples.find((e) => e.name === "hello");
    return hello ? JSON.stringify(hello.ast) : "{}";
}

function getContractsExample(): string {
    const examples = handleExamples();
    const contracts = examples.examples.find((e) => e.name === "contracts");
    return contracts ? JSON.stringify(contracts.ast) : "{}";
}

function getBuiltinList(): string {
    return Array.from(BUILTIN_FUNCTIONS.keys()).join(", ");
}

function getEffectsList(): string {
    return "pure, io, reads, writes, fails";
}

// =============================================================================
// Prompt: write_program
// =============================================================================

export function promptWriteProgram(task: string): PromptResult {
    const schema = getMinimalSchema();
    const hello = getHelloExample();
    const builtins = getBuiltinList();
    const version = handleVersion();

    return {
        description: "System prompt for writing a new Edict program from scratch",
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: [
                        "You are writing an Edict program. Edict is a programming language where the programmer is an AI agent. You produce JSON AST directly — there is no text syntax.",
                        "",
                        "## Rules",
                        "1. Output a single JSON object with kind: \"module\"",
                        "2. Every node MUST have a unique \"id\" field (format: \"kind-description-NNN\")",
                        "3. The module MUST have a \"main\" function that returns Int",
                        "4. Use only these effects: " + getEffectsList(),
                        "5. Available builtins: " + builtins,
                        "6. Schema version: " + version.schemaVersion,
                        "",
                        "## JSON Schema (minimal)",
                        schema,
                        "",
                        "## Example: Hello World",
                        hello,
                        "",
                        "## Task",
                        task,
                    ].join("\n"),
                },
            },
        ],
    };
}

// =============================================================================
// Prompt: fix_error
// =============================================================================

export function promptFixError(errorJson: string): PromptResult {
    return {
        description: "Prompt for fixing a structured Edict compiler error",
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: [
                        "You are fixing an Edict compiler error. The error is a structured JSON object from the Edict compiler pipeline.",
                        "",
                        "## Strategy",
                        "1. Read the error's \"error\" field to identify the error type",
                        "2. Read \"nodeId\" to locate the offending AST node",
                        "3. Read \"expected\" vs \"actual\" (if present) to understand the mismatch",
                        "4. Read \"candidates\" (if present) for suggested corrections",
                        "5. Read \"fix_suggestions\" (if present) for concrete AST patches",
                        "6. Produce a corrected AST or use edict_patch to apply targeted fixes",
                        "",
                        "## Common error types",
                        "- type_mismatch: expected/actual types differ → fix the expression or type annotation",
                        "- undefined_reference: name not found → check spelling, use candidates list",
                        "- effect_violation: function uses effects not in its declaration → add the missing effect",
                        "- contract_failure: pre/postcondition violated → fix the logic or weaken the contract",
                        "- duplicate_definition: two definitions share a name → rename one",
                        "",
                        "## The error to fix",
                        errorJson,
                    ].join("\n"),
                },
            },
        ],
    };
}

// =============================================================================
// Prompt: add_contracts
// =============================================================================

export function promptAddContracts(astJson: string): PromptResult {
    const contractsExample = getContractsExample();

    return {
        description: "Prompt for adding pre/postcondition contracts to existing Edict functions",
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: [
                        "You are adding contracts (preconditions and postconditions) to an existing Edict program. Contracts enable Z3 formal verification — the compiler will prove they hold for all inputs.",
                        "",
                        "## Rules",
                        "1. Preconditions (kind: \"pre\") constrain function inputs (reference parameter names)",
                        "2. Postconditions (kind: \"post\") constrain function outputs (reference \"result\" for the return value)",
                        "3. Every contract node needs a unique \"id\" (format: \"pre-description-NNN\" or \"post-description-NNN\")",
                        "4. Contract conditions are expressions that evaluate to Bool",
                        "5. Keep contracts provable — simple arithmetic/comparison predicates work best with Z3",
                        "6. The \"implies\" operator is useful for conditional postconditions",
                        "",
                        "## Example: contracts with Z3 verification",
                        contractsExample,
                        "",
                        "## AST to add contracts to",
                        astJson,
                    ].join("\n"),
                },
            },
        ],
    };
}

// =============================================================================
// Prompt: review_ast
// =============================================================================

export function promptReviewAst(astJson: string): PromptResult {
    const builtins = getBuiltinList();

    return {
        description: "Prompt for reviewing an Edict AST for quality issues",
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: [
                        "You are reviewing an Edict AST for quality issues. Check for potential problems and suggest improvements.",
                        "",
                        "## Review checklist",
                        "1. ID uniqueness: every node must have a unique \"id\" field",
                        "2. Effect correctness: functions using IO builtins (print) must declare \"io\" effect",
                        "3. Type consistency: literal values match their declared types",
                        "4. Dead code: unreachable expressions after returns",
                        "5. Missing contracts: public functions without pre/postconditions",
                        "6. Unused variables: let bindings that are never referenced",
                        "7. Builtin usage: prefer builtins over manual implementations",
                        "",
                        "## Available builtins",
                        builtins,
                        "",
                        "## Valid effects",
                        getEffectsList(),
                        "",
                        "## AST to review",
                        astJson,
                    ].join("\n"),
                },
            },
        ],
    };
}
