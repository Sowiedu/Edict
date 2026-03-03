---
name: Bug Report
about: Report a bug in the Edict compiler pipeline
title: "[Bug] "
labels: bug
assignees: ''
---

## Pipeline Stage

Which stage produces the bug?

- [ ] Schema Validation (`edict_validate`)
- [ ] Name Resolution
- [ ] Type Checking (`edict_check`)
- [ ] Effect Checking
- [ ] Contract Verification (Z3)
- [ ] WASM Compilation (`edict_compile`)
- [ ] WASM Execution (`edict_run`)
- [ ] MCP Server

## Input AST

```json
{
  "kind": "module",
  "id": "...",
  "name": "...",
  "imports": [],
  "definitions": []
}
```

## Expected Behavior

What should the pipeline return?

## Actual Behavior

What does the pipeline actually return? Include the full structured error output if available.

```json

```

## Environment

- Node.js version:
- OS:
- Edict version/commit:

## Additional Context

Any other context about the problem.
