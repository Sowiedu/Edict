// =============================================================================
// Edict Benchmark Suite — measure pipeline performance across all examples
// =============================================================================
// Run: npx tsx scripts/benchmark.ts
//
// Measures 4 categories for each example program:
//   1. Check time (validate → resolve → typeCheck → effectCheck → contractVerify)
//   2. Compile time (AST → WASM)
//   3. Execute time (WASM execution via runDirect)
//   4. Full pipeline time (all three combined)
//
// Outputs:
//   - Summary table to stdout
//   - Structured JSON to benchmark-results.json
//   - Regression warnings if benchmark-baseline.json exists

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { check } from "../src/check.js";
import { compile } from "../src/codegen/codegen.js";
import { runDirect } from "../src/codegen/runner.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProgramResult {
    checkMs: number;
    compileMs: number;
    executeMs: number;
    pipelineMs: number;
    wasmBytes: number;
    error?: string;
}

interface BenchmarkResults {
    timestamp: string;
    nodeVersion: string;
    platform: string;
    programs: Record<string, ProgramResult>;
    totals: {
        checkMs: number;
        compileMs: number;
        executeMs: number;
        pipelineMs: number;
        programCount: number;
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
        ? sorted[mid]!
        : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function padEnd(str: string, len: number): string {
    return str.length >= len ? str : str + " ".repeat(len - str.length);
}

function padStart(str: string, len: number): string {
    return str.length >= len ? str : " ".repeat(len - str.length) + str;
}

function fmtMs(ms: number): string {
    return ms.toFixed(1);
}

// ---------------------------------------------------------------------------
// Benchmark a single program
// ---------------------------------------------------------------------------

const RUNS = 3;

async function benchmarkProgram(name: string, ast: unknown): Promise<ProgramResult> {
    const checkTimes: number[] = [];
    const compileTimes: number[] = [];
    const executeTimes: number[] = [];
    const pipelineTimes: number[] = [];
    let wasmBytes = 0;

    for (let i = 0; i < RUNS; i++) {
        const pipelineStart = performance.now();

        // --- Check ---
        const checkStart = performance.now();
        const checkResult = await check(ast);
        const checkEnd = performance.now();
        checkTimes.push(checkEnd - checkStart);

        if (!checkResult.ok || !checkResult.module) {
            return {
                checkMs: median(checkTimes),
                compileMs: 0,
                executeMs: 0,
                pipelineMs: 0,
                wasmBytes: 0,
                error: `Check failed: ${checkResult.errors[0]?.error ?? "unknown"}`,
            };
        }

        // --- Compile ---
        const compileStart = performance.now();
        const compileResult = compile(checkResult.module, { typeInfo: checkResult.typeInfo });
        const compileEnd = performance.now();
        compileTimes.push(compileEnd - compileStart);

        if (!compileResult.ok) {
            return {
                checkMs: median(checkTimes),
                compileMs: median(compileTimes),
                executeMs: 0,
                pipelineMs: 0,
                wasmBytes: 0,
                error: `Compile failed: ${compileResult.errors[0]?.error ?? "unknown"}`,
            };
        }

        wasmBytes = compileResult.wasm.byteLength;

        // --- Execute ---
        const execStart = performance.now();
        await runDirect(compileResult.wasm);
        const execEnd = performance.now();
        executeTimes.push(execEnd - execStart);

        const pipelineEnd = performance.now();
        pipelineTimes.push(pipelineEnd - pipelineStart);
    }

    return {
        checkMs: median(checkTimes),
        compileMs: median(compileTimes),
        executeMs: median(executeTimes),
        pipelineMs: median(pipelineTimes),
        wasmBytes,
    };
}

// ---------------------------------------------------------------------------
// Regression detection
// ---------------------------------------------------------------------------

const REGRESSION_THRESHOLD = 0.20; // 20%

function checkRegression(current: BenchmarkResults, baseline: BenchmarkResults): string[] {
    const warnings: string[] = [];

    // Check totals
    const categories: (keyof typeof current.totals)[] = ["checkMs", "compileMs", "executeMs", "pipelineMs"];
    for (const cat of categories) {
        if (cat === "programCount") continue;
        const baseVal = baseline.totals[cat] as number;
        const curVal = current.totals[cat] as number;
        if (baseVal > 0) {
            const delta = (curVal - baseVal) / baseVal;
            if (delta > REGRESSION_THRESHOLD) {
                warnings.push(
                    `⚠️  Total ${cat} regressed by ${(delta * 100).toFixed(1)}%: ${fmtMs(baseVal)}ms → ${fmtMs(curVal)}ms`,
                );
            }
        }
    }

    // Check per-program
    for (const [name, curProg] of Object.entries(current.programs)) {
        const baseProg = baseline.programs[name];
        if (!baseProg) continue;
        for (const cat of categories) {
            if (cat === "programCount") continue;
            const baseVal = baseProg[cat as keyof ProgramResult] as number;
            const curVal = curProg[cat as keyof ProgramResult] as number;
            if (typeof baseVal === "number" && typeof curVal === "number" && baseVal > 5) {
                // Only flag per-program if baseline > 5ms (to avoid noise on tiny values)
                const delta = (curVal - baseVal) / baseVal;
                if (delta > REGRESSION_THRESHOLD) {
                    warnings.push(
                        `  ⚠️  ${name} ${cat}: ${fmtMs(baseVal)}ms → ${fmtMs(curVal)}ms (+${(delta * 100).toFixed(1)}%)`,
                    );
                }
            }
        }
    }

    return warnings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const dir = "./examples";
    const files = readdirSync(dir)
        .filter((f) => f.endsWith(".edict.json"))
        .sort();

    console.log(`\nEdict Benchmark Suite`);
    console.log(`${"=".repeat(70)}`);
    console.log(`Node ${process.version} | ${process.platform}-${process.arch} | ${RUNS} runs per program\n`);

    const programs: Record<string, ProgramResult> = {};
    const totals = { checkMs: 0, compileMs: 0, executeMs: 0, pipelineMs: 0, programCount: files.length };

    // Header
    const nameCol = 35;
    console.log(
        `${padEnd("Program", nameCol)} ${padStart("Check", 8)} ${padStart("Compile", 8)} ${padStart("Execute", 8)} ${padStart("Pipeline", 9)} ${padStart("WASM", 7)}`,
    );
    console.log("-".repeat(nameCol + 8 + 8 + 8 + 9 + 7 + 5));

    for (const file of files) {
        const ast = JSON.parse(readFileSync(`${dir}/${file}`, "utf-8"));
        const result = await benchmarkProgram(file, ast);
        programs[file] = result;

        if (result.error) {
            console.log(`${padEnd(file, nameCol)} ERROR: ${result.error}`);
        } else {
            totals.checkMs += result.checkMs;
            totals.compileMs += result.compileMs;
            totals.executeMs += result.executeMs;
            totals.pipelineMs += result.pipelineMs;

            console.log(
                `${padEnd(file, nameCol)} ${padStart(fmtMs(result.checkMs), 7)}ms ${padStart(fmtMs(result.compileMs), 7)}ms ${padStart(fmtMs(result.executeMs), 7)}ms ${padStart(fmtMs(result.pipelineMs), 8)}ms ${padStart(String(result.wasmBytes), 6)}B`,
            );
        }
    }

    // Totals
    console.log("-".repeat(nameCol + 8 + 8 + 8 + 9 + 7 + 5));
    console.log(
        `${padEnd("TOTAL", nameCol)} ${padStart(fmtMs(totals.checkMs), 7)}ms ${padStart(fmtMs(totals.compileMs), 7)}ms ${padStart(fmtMs(totals.executeMs), 7)}ms ${padStart(fmtMs(totals.pipelineMs), 8)}ms`,
    );

    // Build results
    const results: BenchmarkResults = {
        timestamp: new Date().toISOString(),
        nodeVersion: process.version,
        platform: `${process.platform}-${process.arch}`,
        programs,
        totals,
    };

    // Write JSON
    const outPath = "benchmark-results.json";
    writeFileSync(outPath, JSON.stringify(results, null, 2) + "\n");
    console.log(`\n✓ Results written to ${outPath}`);

    // Regression check
    const baselinePath = "benchmark-baseline.json";
    if (existsSync(baselinePath)) {
        const baseline: BenchmarkResults = JSON.parse(readFileSync(baselinePath, "utf-8"));
        const warnings = checkRegression(results, baseline);
        if (warnings.length > 0) {
            console.log(`\n⚠️  Regressions detected (>${REGRESSION_THRESHOLD * 100}% threshold):`);
            for (const w of warnings) {
                console.log(w);
            }
            // Don't exit(1) — regressions are warnings, not failures
        } else {
            console.log(`✓ No regressions detected (baseline: ${baseline.timestamp})`);
        }
    } else {
        console.log(`ℹ  No baseline found at ${baselinePath} — skipping regression check`);
    }

    console.log();
}

main().catch((err) => {
    console.error("Benchmark failed:", err);
    process.exit(1);
});
