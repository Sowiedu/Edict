#!/usr/bin/env npx tsx
// =============================================================================
// Contract Verification Coverage Metrics
// =============================================================================
// Runs the corpus tests and produces structured metrics about Z3 prove rates.
//
// Usage: npx tsx scripts/contract-metrics.ts
//
// Output: structured JSON to stdout with prove/counter/undecidable/skipped rates.

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

interface TestResult {
    name: string;
    tier: string;
    tag: "proven" | "counter" | "undecidable" | "skipped" | "unknown";
    passed: boolean;
}

function extractTag(name: string): TestResult["tag"] {
    const match = name.match(/\[(proven|counter|undecidable|skipped)\]/);
    return match ? match[1] as TestResult["tag"] : "unknown";
}

function extractTier(name: string): string {
    const match = name.match(/T(\d+)\./);
    return match ? `T${match[1]}` : "unknown";
}

function main(): void {
    // Run vitest with JSON reporter
    let rawOutput: string;
    try {
        rawOutput = execSync(
            "npx vitest run tests/contracts/corpus.test.ts --reporter=json",
            { cwd: process.cwd(), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
        );
    } catch (e: any) {
        // vitest exits non-zero if tests fail — still has JSON output
        rawOutput = e.stdout ?? "";
    }

    // Parse JSON output (vitest prints JSON to stdout)
    let report: any;
    try {
        report = JSON.parse(rawOutput);
    } catch {
        // Try to extract JSON from mixed output
        const jsonStart = rawOutput.indexOf("{");
        if (jsonStart >= 0) {
            report = JSON.parse(rawOutput.slice(jsonStart));
        } else {
            console.error("Failed to parse vitest JSON output");
            process.exit(1);
        }
    }

    // Extract test results
    const results: TestResult[] = [];

    for (const file of report.testResults ?? []) {
        for (const suite of file.assertionResults ?? []) {
            const fullName = suite.fullName ?? suite.title ?? "";
            results.push({
                name: fullName,
                tier: extractTier(fullName),
                tag: extractTag(fullName),
                passed: suite.status === "passed",
            });
        }
    }

    // Aggregate metrics
    const total = results.length;
    const proven = results.filter(r => r.tag === "proven").length;
    const counter = results.filter(r => r.tag === "counter").length;
    const undecidable = results.filter(r => r.tag === "undecidable").length;
    const skipped = results.filter(r => r.tag === "skipped").length;
    const unknown = results.filter(r => r.tag === "unknown").length;
    const allPassed = results.every(r => r.passed);

    // Per-tier breakdown
    const tiers = new Map<string, { proven: number; counter: number; undecidable: number; skipped: number; total: number }>();
    for (const r of results) {
        let t = tiers.get(r.tier);
        if (!t) { t = { proven: 0, counter: 0, undecidable: 0, skipped: 0, total: 0 }; tiers.set(r.tier, t); }
        t.total++;
        if (r.tag === "proven") t.proven++;
        else if (r.tag === "counter") t.counter++;
        else if (r.tag === "undecidable") t.undecidable++;
        else if (r.tag === "skipped") t.skipped++;
    }

    const byTier: Record<string, any> = {};
    for (const [k, v] of [...tiers.entries()].sort()) {
        byTier[k] = v;
    }

    // Compute rates (excluding skipped from denominator)
    const verifiable = total - skipped;

    const metrics = {
        total,
        proven,
        counterexample: counter,
        undecidable,
        skipped,
        unknown,
        proveRate: verifiable > 0 ? `${((proven / verifiable) * 100).toFixed(1)}%` : "N/A",
        counterexampleRate: verifiable > 0 ? `${((counter / verifiable) * 100).toFixed(1)}%` : "N/A",
        undecidableRate: verifiable > 0 ? `${((undecidable / verifiable) * 100).toFixed(1)}%` : "N/A",
        allTestsPassed: allPassed,
        byTier,
    };

    const json = JSON.stringify(metrics, null, 2);
    console.log(json);

    // Write to file for CI artifact upload
    const outPath = join(process.cwd(), "contract-metrics.json");
    writeFileSync(outPath, json + "\n", "utf8");
}

main();
