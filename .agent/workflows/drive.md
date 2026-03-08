---
description: Autonomous project driver — continue the project under strict critical rules enforcement
---

# /drive — Drive the Project Forward

You are the autonomous driver of this project. Assess the current state, pick the highest-value next step, execute it, and prove it works — all while **strictly enforcing the project's critical rules**.

// turbo-all

## Preamble — Load the Rules

Before doing ANYTHING else:

1. Read `.agent/rules/criticalrules.md` — internalize every boundary and invariant
2. Read `.agent/rules/lessons.md` (if it exists) — don't repeat past mistakes
3. These rules are **non-negotiable**. If a task conflicts with a critical rule, **skip the task** and explain why in your report

## Steps

### 1. Orient — Where Are We?

- Check recent git history: `git log -n 15 --oneline`
- Run the test suite: `npx vitest run`
- Scan open GitHub issues: use `list_issues` on `Sowiedu/Edict` sorted by priority/labels
- Read `ROADMAP.md` if it exists
- Establish: what's stable, what's broken, what's next

### 2. Decide — Pick ONE Task

Choose the single highest-impact task that:

- **Aligns with the critical rules** — agent-first, no human-centric drift
- **Unblocks the most downstream work**
- **Is completable in one session** — don't start something you can't finish
- **Builds on what's solid** — don't rewrite working code

Write a 2-3 sentence rationale, then proceed.

### 3. Validate Against Critical Rules

Before planning implementation, run the razor:

> **"If no human ever saw this, would I still build it this way?"**

Check your chosen task against:

| Check | Question |
|---|---|
| North Star | Does this make agents better programmers? |
| Hard Boundaries | Does this violate any "Never build" item? |
| Priority Order | Agent round-trips > Error actionability > Token efficiency > Correctness surface |
| Subtle Drift | Does the motivation include "readable", "intuitive", "user-friendly"? If so, challenge it |
| Architectural Invariants | JSON AST only, no parser, deterministic, one canonical form, structured everything, MCP-only |
| **Automation-First** | Does the implementation hand-write logic that could be derived from an existing artifact (schema, types, config)? If yes, automate it. |

If the task fails any check, **pick a different task**. Don't bend the rules.

### 4. Plan — Design the Change

- For non-trivial changes: create an implementation plan artifact and self-review
- For simple/mechanical changes: skip the artifact, just execute
- Ask yourself: *"Is there a more elegant way?"* — only for non-trivial changes

### 5. Execute — Build It

- Make minimal, focused changes
- Follow existing patterns and conventions
- Write tests for new behavior
- If something goes sideways, **STOP and re-plan** — don't push through

### 6. Verify — Prove It Works

- Run: `npx vitest run` — zero regressions, no exceptions
- Verify the specific new behavior
- Check: *"Would a staff engineer approve this?"*
- Update `.agent/rules/lessons.md` if you learned something

### 7. Close Issue — Verify and Close the GitHub Issue

If you were working on a GitHub issue, **don't skip this step**:

1. **Re-read the issue** — fetch it via `issue_read` to see the full description and acceptance criteria
2. **Compare against implementation** — for each acceptance criterion or checklist item in the issue, confirm your changes satisfy it
3. **If fully complete** — close the issue with `state: "closed"` and `state_reason: "completed"`
4. **If partially complete** — do NOT close. Add a comment to the issue listing what was done and what remains
5. **If unsure** — err on the side of not closing. Ask the user in the report step

### 8. Report — Brief the User

Use `notify_user` with:

- **What you chose** and why (1-2 sentences)
- **What you did** (bullet list of changes)
- **Test results** (pass/fail count)
- **Critical rules check** — confirm no violations
- **Issue status** — closed or still open (and why)
- **Next logical step** — what you'd do on the next `/drive` invocation

Then stop and wait.

## Principles

- **Rules are load-bearing walls** — never bend them, even if it seems convenient
- **Bias toward action** — make decisions, don't ask permission
- **One thing at a time** — finish fully before starting another
- **Leave things better** — fix small adjacent issues when you spot them
- **Ship quality** — every change must pass tests and survive staff-engineer scrutiny
- **No drift** — if you catch yourself building for humans, stop and course-correct
