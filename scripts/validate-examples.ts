import { handleCompile, handleCompileMulti } from '../src/mcp/handlers.js';
import { readdirSync, readFileSync } from 'fs';

// Examples that use host-dispatched constructs (tool_call) can't emit WASM
const COMPILE_SKIP = new Set(['tool-calls']);

const dir = './examples';
const files = readdirSync(dir).filter(f => f.endsWith('.edict.json')).sort();
let pass = 0;
let fail = 0;
let skipped = 0;

for (const f of files) {
  const name = f.replace('.edict.json', '');

  if (COMPILE_SKIP.has(name)) {
    console.log('⊘', f, '(compile-exempt: tool_call)');
    skipped++;
    continue;
  }

  const ast = JSON.parse(readFileSync(`${dir}/${f}`, 'utf-8'));
  const isMultiModule = Array.isArray(ast);
  const result = isMultiModule
    ? await handleCompileMulti(ast)
    : await handleCompile(ast);

  console.log(result.ok ? '✓' : '✗', f);
  if (!result.ok) {
    console.error('  Errors:', JSON.stringify(result.errors));
    fail++;
  } else {
    pass++;
  }
}

console.log(`\n${pass}/${files.length - skipped} examples compile (${skipped} skipped)`);
if (fail > 0) process.exit(1);
