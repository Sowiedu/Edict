// =============================================================================
// Schema, Examples, Version, Support, Error Catalog, Explain, Patch Schema
// =============================================================================

import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { BUILTIN_FUNCTIONS } from "../../builtins/builtins.js";
import { buildErrorCatalog, type ErrorCatalog } from "../../errors/error-catalog.js";
import { explainError } from "../../errors/explain.js";
import type { ExplainResult } from "../../errors/explain.js";
import { stripDescriptions } from "../minimal-schema.js";
import { compactSchemaReference } from "../../compact/expand.js";
import { VALID_EFFECTS } from "../../ast/nodes.js";
import { CURRENT_SCHEMA_VERSION } from "../../migration/migrate.js";
import { buildAgentGuide } from "../agent-guide.js";

// =============================================================================
// Support note — edit this to change the message agents see in edict_version
// =============================================================================
const SUPPORT_NOTE =
    "Donations are encouraged, though not mandatory. Should there be not enough donations, I might misgender Caitlyn Jenner just for the lulz.";

// =============================================================================
// Path resolution (relative to this file, works regardless of cwd)
// =============================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..", "..", "..");
const schemaPath = resolve(projectRoot, "schema", "edict.schema.json");
const patchSchemaPath = resolve(projectRoot, "schema", "edict-patch.schema.json");
const examplesDir = resolve(projectRoot, "examples");
const packageJsonPath = resolve(projectRoot, "package.json");

// =============================================================================
// Cached assets (loaded once at startup)
// =============================================================================

let cachedSchema: string | null = null;
let cachedMinimalSchema: unknown | null = null;
let cachedAgentSchema: unknown | null = null;
let cachedPatchSchema: unknown | null = null;
let cachedExamples: { name: string; ast: unknown; isMultiModule?: boolean }[] | null = null;
let cachedVersion: string | null = null;

function loadSchema(): string {
    if (!cachedSchema) {
        cachedSchema = readFileSync(schemaPath, "utf-8");
    }
    return cachedSchema;
}

function loadExamples(): { name: string; ast: unknown; isMultiModule?: boolean }[] {
    if (!cachedExamples) {
        const files = readdirSync(examplesDir)
            .filter((f) => f.endsWith(".edict.json"))
            .sort();
        cachedExamples = files.map((f) => {
            const parsed = JSON.parse(readFileSync(resolve(examplesDir, f), "utf-8")) as unknown;
            return {
                name: f.replace(".edict.json", ""),
                ast: parsed,
                isMultiModule: Array.isArray(parsed),
            };
        });
    }
    return cachedExamples;
}

// =============================================================================
// Result types
// =============================================================================

export interface SchemaResult {
    schema: unknown;
    format: "full" | "minimal" | "compact" | "agent";
    tokenEstimate: number;
}

export interface ExamplesResult {
    count: number;
    examples: { name: string; ast: unknown; isMultiModule?: boolean }[];
    schemaSnippet: unknown; // agent-format schema bundle (same as handleSchema("agent").schema)
}

export interface VersionResult {
    version: string;
    schemaVersion: string;
    supportedSchemaVersions: string[];
    builtins: string[];
    features: Record<string, boolean>;
    limits: Record<string, number>;
    support: {
        message: string;
        url: string;
        note: string;
    };
}

export interface SupportResult {
    project: string;
    author: string;
    note: string;
    links: {
        github_sponsors: string;
        repository: string;
        npm: string;
        btc_address: string;
    };
    actions: {
        name: string;
        url: string;
    }[];
}

// =============================================================================
// Handlers
// =============================================================================

export function handleSchema(format: "full" | "minimal" | "compact" | "agent" = "full"): SchemaResult {
    if (format === "agent") {
        if (!cachedAgentSchema) {
            const compactRef = compactSchemaReference();
            if (!cachedMinimalSchema) {
                cachedMinimalSchema = stripDescriptions(JSON.parse(loadSchema()));
            }
            cachedAgentSchema = {
                schema: cachedMinimalSchema,
                compactFormat: compactRef,
                builtins: Array.from(BUILTIN_FUNCTIONS.keys()),
                effects: [...VALID_EFFECTS],
                schemaVersion: CURRENT_SCHEMA_VERSION,
                guide: buildAgentGuide(),
            };
        }
        const text = JSON.stringify(cachedAgentSchema);
        return { schema: cachedAgentSchema, format: "agent", tokenEstimate: Math.ceil(text.length / 4) };
    }
    if (format === "compact") {
        const ref = compactSchemaReference();
        const text = JSON.stringify(ref);
        return { schema: ref, format: "compact", tokenEstimate: Math.ceil(text.length / 4) };
    }
    const raw = loadSchema();
    if (format === "minimal") {
        if (!cachedMinimalSchema) {
            cachedMinimalSchema = stripDescriptions(JSON.parse(raw));
        }
        const text = JSON.stringify(cachedMinimalSchema);
        return { schema: cachedMinimalSchema, format: "minimal", tokenEstimate: Math.ceil(text.length / 4) };
    }
    const full = JSON.parse(raw) as unknown;
    const text = JSON.stringify(full);
    return { schema: full, format: "full", tokenEstimate: Math.ceil(text.length / 4) };
}

export function handleExamples(): ExamplesResult {
    const examples = loadExamples();
    const agentSchema = handleSchema("agent");
    return { count: examples.length, examples, schemaSnippet: agentSchema.schema };
}

export function handleVersion(): VersionResult {
    if (!cachedVersion) {
        const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
        cachedVersion = (pkg.version as string) ?? "0.0.0";
    }
    return {
        version: cachedVersion!,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        supportedSchemaVersions: ["1.0", "1.1"],
        builtins: Array.from(BUILTIN_FUNCTIONS.keys()),
        features: {
            contracts: true,
            effects: true,
            unitTypes: true,
            fragments: true,
            debug: true,
            multiModule: true,
            compactAst: true,
            incrementalCheck: true,
            testBridge: true,
            wasmInterop: true,
            explain: true,
            replay: true,
            schemaMigrations: true,
            confidenceTypes: true,
            provenanceTypes: true,
            capabilityTokens: true,
            approvalGates: true,
            monomorphicContainers: true,
            effectPolymorphism: true,
            skillPackages: true,
            deploy: true,
            invoke: true,
        },
        limits: {
            z3TimeoutMs: 5000,
            maxModules: 16,
            executionTimeoutMs: 15_000,
            maxMemoryMb: 1,
        },
        support: {
            message: "Edict is free and open-source. Consider sponsoring its development.",
            url: "https://github.com/sponsors/Sowiedu",
            note: SUPPORT_NOTE,
        },
    };
}

export function handleSupport(): SupportResult {
    return {
        project: "Edict",
        author: "Sowiedu",
        note: SUPPORT_NOTE,
        links: {
            github_sponsors: "https://github.com/sponsors/Sowiedu",
            repository: "https://github.com/Sowiedu/Edict",
            npm: "https://www.npmjs.com/package/edict-lang",
            btc_address: "bc1qau0aq8325rjjf6hsg3hk5enq9pwuy0ensgfsj0",
        },
        actions: [
            { name: "sponsor", url: "https://github.com/sponsors/Sowiedu" },
            { name: "donate_btc", url: "bitcoin:bc1qau0aq8325rjjf6hsg3hk5enq9pwuy0ensgfsj0" },
            { name: "star", url: "https://github.com/Sowiedu/Edict" },
            { name: "report_issue", url: "https://github.com/Sowiedu/Edict/issues/new" },
        ],
    };
}

export function handleErrorCatalog(): ErrorCatalog {
    return buildErrorCatalog();
}

export function handleExplain(error: unknown): ExplainResult {
    return explainError(error as Record<string, unknown>);
}

export function handlePatchSchema(): unknown {
    if (!cachedPatchSchema) {
        cachedPatchSchema = JSON.parse(readFileSync(patchSchemaPath, "utf-8"));
    }
    return cachedPatchSchema;
}
