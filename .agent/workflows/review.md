---
description: Self-review checklist for implementation plans, feature specs, PRDs, design documents, and GitHub issues before presenting to user
---

# /review Workflow

Catch gaps, risks, and ambiguities in any planning document **before** presenting it to the user. Run this after drafting but before `notify_user`.

> [!TIP]
> Works on implementation plans, feature specs, PRDs, design docs, and GitHub issues.
> For code quality, use `/clean`. For strategic analysis, use `/visionaries`.

---

## Preamble — Load the Rules

Before reviewing, re-read `.agent/rules/criticalrules.md`. Every finding must be checked against the critical rules. **A plan that violates a critical rule is a blocker, not a suggestion.**

---

## Steps

### 1. Identify the Document

If no path was given, use the most recently created/edited artifact (usually `implementation_plan.md`).

---

### 2. Critical Rules Compliance

Run the razor on every proposed change:

> **"If no human ever saw this, would I still build it this way?"**

| Check | Question |
|---|---|
| North Star | Does this make agents better programmers? |
| Hard Boundaries | Does this violate any "Never build" item? |
| Priority Order | Agent round-trips > Error actionability > Token efficiency > Correctness surface |
| Subtle Drift | Does the motivation include "readable", "intuitive", "user-friendly"? If so, challenge it |
| Architectural Invariants | JSON AST only, no parser, deterministic, one canonical form, structured everything, MCP-only |
| **Automation-First** | Does the plan hand-write logic that could be derived from an existing artifact (schema, types, config)? If yes, redesign to derive from the source of truth. |

**Any violation is an automatic blocker. Fix it before proceeding.**

---

### 3. Completeness Check

Verify the document covers all mandatory sections. Check items relevant to the document type:

| Check | Implementation Plans | Feature Specs | GitHub Issues |
|-------|:---:|:---:|:---:|
| Problem statement / goal | ✅ | ✅ | ✅ |
| Proposed changes (file-level) | ✅ | — | — |
| File links with `[MODIFY]`/`[NEW]`/`[DELETE]` | ✅ | — | — |
| Acceptance criteria | — | ✅ | ✅ |
| Edge cases documented | ✅ | ✅ | ✅ |
| Verification plan (automated + manual) | ✅ | ✅ | — |
| User Review Required section (if breaking/risky) | ✅ | ✅ | — |

---

### 4. Technical Accuracy

For each proposed change, verify against the actual codebase:

- [ ] **File paths exist** — every linked file resolves (or is marked `[NEW]`)
- [ ] **Function signatures match** — referenced functions/methods actually exist with the stated signatures
- [ ] **Dependencies checked** — imports, packages, config keys referenced are real
- [ ] **No stale references** — code snippets aren't from an outdated version of the file
- [ ] **Test commands work** — `npx vitest run ...` paths are valid

Use `grep_search`, `view_file_outline`, and `view_code_item` to spot-check at least 3 claims.

---

### 5. Risk & Edge Case Scan

Ask yourself these questions:

1. **What breaks if this fails silently?** (malformed patches, missing nodeIds, corrupt AST)
2. **What breaks if this succeeds but behaves differently than expected?** (wrong types, mutation side effects, stale state)
3. **Does the test suite cover failure paths?** (not just happy path)
4. **Is the change backwards compatible?** Can existing MCP clients work without modification?
5. **Does this add schema surface?** Every new field agents must learn costs tokens
6. **Are structured errors returned for all failure modes?** (never prose, never crashes)

---

### 6. Clarity & Actionability

- [ ] Someone unfamiliar with the codebase could implement this from the plan alone
- [ ] No vague language ("maybe", "if needed", "consider") — replace with decisions
- [ ] Every `[MODIFY]` section says *what* changes, not just *that* something changes
- [ ] Verification steps are copy-paste runnable

---

### 7. Produce Findings Table

Append a `## Self-Review Findings` section to the document:

```markdown
## Self-Review Findings

| # | Finding | Resolution |
|---|---------|------------|
| 1 | [what was wrong or missing] | [how it was fixed in the plan] |
| 2 | ... | ... |
```

If no issues found, append:

```markdown
## Self-Review Findings

✅ No issues found — plan passed all checks.
```

---

### 8. Update the Plan

Apply all fixes inline in the document. Don't just list findings — actually fix the plan text.

---

## Anti-Patterns

❌ **Rubber-stamping** — "Looks good" without checking anything
❌ **Excessive nitpicking** — flagging style preferences as issues
❌ **Checking only happy path** — skipping error/edge case analysis
❌ **Critical rules bypass** — "It's just a small human-convenience feature" — no, it's drift
