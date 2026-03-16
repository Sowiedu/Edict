// =============================================================================
// Deploy Handler
// =============================================================================

import { check } from "../../check.js";
import { compile } from "../../codegen/codegen.js";
import type { StructuredError } from "../../errors/structured-errors.js";
import { scaffoldFailed, deployFailed, unknownDeployTarget } from "../../errors/structured-errors.js";
import type { EdictModule } from "../../ast/nodes.js";
import { generateWorkerScaffold } from "../../deploy/scaffold.js";
import type { WorkerConfig } from "../../deploy/scaffold.js";
import { deployToCloudflare } from "../../deploy/cloudflare-api.js";

// =============================================================================
// Result types
// =============================================================================

export interface DeployConfig {
    name?: string;
    route?: string;
    compatibilityDate?: string;
    kvNamespaces?: { binding: string; id: string }[];
}

export interface DeployResult {
    ok: boolean;
    target: string;
    // wasm_binary target fields
    wasm?: string;
    wasmSize?: number;
    verified?: boolean;
    effects?: string[];
    contracts?: number;
    // cloudflare target fields
    bundle?: { path: string; content: string }[];
    // common
    url?: string;
    status?: string;
    errors?: StructuredError[];
    /** Env vars required for live deployment (set when falling back to bundle-only). */
    credentialsRequired?: string[];
}

// =============================================================================
// Handler
// =============================================================================

export async function handleDeploy(
    ast: unknown,
    target: string,
    config?: DeployConfig,
): Promise<DeployResult> {
    const checkResult = await check(ast);
    if (!checkResult.ok || !checkResult.module) {
        return { ok: false, target, errors: checkResult.errors };
    }

    const compileResult = compile(checkResult.module, { typeInfo: checkResult.typeInfo });
    if (!compileResult.ok) {
        return { ok: false, target, errors: compileResult.errors };
    }

    // Extract metadata from the checked module
    const module = checkResult.module as EdictModule;
    const allEffects = new Set<string>();
    let contractCount = 0;
    for (const def of module.definitions) {
        if (def.kind === "fn") {
            for (const eff of def.effects) {
                const effStr = typeof eff === "string" ? eff : (eff as { name: string }).name;
                allEffects.add(effStr);
            }
            contractCount += def.contracts.length;
        }
    }
    const hasContracts = contractCount > 0;
    const verified = hasContracts && checkResult.coverage?.contracts.proven === checkResult.coverage?.contracts.total;

    // Step 2: Dispatch to target
    switch (target) {
        case "wasm_binary": {
            const base64 = Buffer.from(compileResult.wasm).toString("base64");
            return {
                ok: true,
                target: "wasm_binary",
                wasm: base64,
                wasmSize: compileResult.wasm.length,
                verified,
                effects: Array.from(allEffects),
                contracts: contractCount,
                status: "ready",
            };
        }

        case "cloudflare": {
            const workerName = config?.name || module.name || "edict-worker";
            const workerConfig: WorkerConfig = {
                name: workerName,
                compatibilityDate: config?.compatibilityDate,
                kvNamespaces: config?.kvNamespaces,
            };

            const scaffoldResult = generateWorkerScaffold(compileResult.wasm, workerConfig);
            if (!scaffoldResult.ok) {
                return {
                    ok: false,
                    target: "cloudflare",
                    errors: [scaffoldFailed(scaffoldResult.error)],
                };
            }

            const commonMeta = {
                wasmSize: compileResult.wasm.length,
                verified,
                effects: Array.from(allEffects),
                contracts: contractCount,
            };

            // Live deployment when credentials are available
            const cfApiToken = process.env.CLOUDFLARE_API_TOKEN;
            const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;

            if (cfApiToken && cfAccountId) {
                const deployResult = await deployToCloudflare({
                    accountId: cfAccountId,
                    apiToken: cfApiToken,
                    scriptName: workerName,
                    bundle: scaffoldResult.bundle,
                    compatibilityDate: config?.compatibilityDate,
                });

                if (deployResult.ok) {
                    return {
                        ok: true,
                        target: "cloudflare",
                        ...commonMeta,
                        url: `${deployResult.url}${config?.route || ""}`,
                        status: "live",
                    };
                }

                return {
                    ok: false,
                    target: "cloudflare",
                    errors: [deployFailed(deployResult.code, deployResult.error, deployResult.responseBody)],
                };
            }

            // Fallback: bundle-only when no credentials
            const bundle = scaffoldResult.bundle.files.map(f => ({
                path: f.path,
                content: f.content instanceof Uint8Array
                    ? Buffer.from(f.content).toString("base64")
                    : f.content,
            }));

            return {
                ok: true,
                target: "cloudflare",
                bundle,
                ...commonMeta,
                url: `https://${workerName}.workers.dev${config?.route || ""}`,
                status: "bundled",
                credentialsRequired: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
            };
        }

        default:
            return {
                ok: false,
                target,
                errors: [unknownDeployTarget(target, ["wasm_binary", "cloudflare"])],
            };
    }
}
