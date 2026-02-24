import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { compileAndRun } from "../../src/compile.js";

describe("E2E — compileAndRun", () => {
    it("runs hello.edict.json and produces Hello, World!", async () => {
        const helloPath = path.resolve(__dirname, "../../examples/hello.edict.json");
        const ast = JSON.parse(fs.readFileSync(helloPath, "utf-8"));

        const result = await compileAndRun(ast);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.output).toBe("Hello, World!");
        expect(result.exitCode).toBe(0);
        expect(result.returnValue).toBe(0);
    });

    it("reports check-phase errors for invalid AST", async () => {
        const result = await compileAndRun({ invalid: true });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.phase).toBe("check");
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it("reports check-phase errors for bad module", async () => {
        const badModule = {
            kind: "module",
            id: "mod-bad",
            name: "bad",
            imports: [],
            definitions: [{
                kind: "fn",
                id: "fn-1",
                name: "main",
                params: [],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{
                    kind: "ident",
                    id: "i-1",
                    name: "nonexistent",
                }],
            }],
        };

        const result = await compileAndRun(badModule);

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.phase).toBe("check");
    });

    it("compiles and runs arithmetic program", async () => {
        const ast = {
            kind: "module",
            id: "mod-arith",
            name: "arith",
            imports: [],
            definitions: [{
                kind: "fn",
                id: "fn-main",
                name: "main",
                params: [],
                effects: ["pure"],
                returnType: { kind: "basic", name: "Int" },
                contracts: [],
                body: [{
                    kind: "binop",
                    id: "b-1",
                    op: "+",
                    left: { kind: "literal", id: "l-a", value: 20 },
                    right: { kind: "literal", id: "l-b", value: 22 },
                }],
            }],
        };

        const result = await compileAndRun(ast);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.returnValue).toBe(42);
        expect(result.output).toBe("");
    });

    it("compiles and runs fibonacci with function parameters", async () => {
        const fibPath = path.resolve(__dirname, "../../examples/fibonacci.edict.json");
        const fibAst = JSON.parse(fs.readFileSync(fibPath, "utf-8"));

        // fibonacci.edict.json has fib(n) but no main — add a main wrapper
        const fibDef = fibAst.definitions[0];
        const astWithMain = {
            ...fibAst,
            definitions: [
                fibDef,
                {
                    kind: "fn",
                    id: "fn-main",
                    name: "main",
                    params: [],
                    effects: ["pure"],
                    returnType: { kind: "basic", name: "Int" },
                    contracts: [],
                    body: [{
                        kind: "call",
                        id: "call-fib-main",
                        fn: { kind: "ident", id: "ident-fib-main", name: "fib" },
                        args: [{ kind: "literal", id: "lit-10", value: 10 }],
                    }],
                },
            ],
        };

        const result = await compileAndRun(astWithMain);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.returnValue).toBe(55);
    });
});

