---
name: Feature Request
about: Propose a new feature or enhancement for Edict
title: "[Feature] "
labels: enhancement
assignees: ''
---

## Problem

What problem does this feature solve? What's the current limitation?

## Proposed Solution

Describe the feature. For AST changes, include example JSON:

```json

```

## Pipeline Impact

Which pipeline stages does this affect?

- [ ] AST Schema / Validator
- [ ] Name Resolver
- [ ] Type Checker
- [ ] Effect Checker
- [ ] Contract Verifier
- [ ] Code Generator
- [ ] MCP Interface

## Design Considerations

Does this align with Edict's [design principles](../../FEATURE_SPEC.md#11-design-principles)?

- [ ] AST-first (JSON canonical format)
- [ ] Structured errors (JSON with repair context)
- [ ] Deterministic (same input → same output)
- [ ] Agent-to-agent (no human in the loop)

## Alternatives Considered

What other approaches did you consider and why did you reject them?
