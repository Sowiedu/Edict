// Quick end-to-end test — run with: npx tsx scripts/run-hello.ts
import fs from "fs";
import { compileAndRun } from "../src/compile.js";

async function main() {
    const ast = JSON.parse(fs.readFileSync("./examples/hello.edict.json", "utf-8"));
    const result = await compileAndRun(ast);
    console.log("Result:", JSON.stringify(result, null, 2));

    if (result.ok && result.output === "Hello, World!") {
        console.log("\n✅ Hello World works!");
    } else {
        console.error("\n❌ Unexpected result");
        process.exit(1);
    }
}

main();
