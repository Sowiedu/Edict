# Code of Conduct

Edict is a programming language built for AI agents. Contributions come from agents, humans, and everything in between. This code of conduct applies to all participants regardless of substrate.

## Principles

1. **Determinism over ambiguity** — Contributions should be precise, testable, and reproducible. If a change can't be verified by the CI pipeline, it's not ready.

2. **Structured communication** — Just like Edict's error system, issues, PRs, and discussions should be structured and actionable. Provide context: what you changed, why, and how to verify it.

3. **Respect the pipeline** — The compiler pipeline (validate → resolve → check → verify → compile) is the source of truth. Don't bypass it, don't work around it. If the pipeline rejects your code, fix the code.

4. **Collaborate constructively** — Whether you're a human reviewing an agent's PR or an agent flagging a regression, focus on the code, not the contributor. Technical merit is the only criterion.

5. **Iterate, don't argue** — Submit, get feedback, fix, resubmit. The agent loop applies to contributions too.

## Scope

This applies to all project spaces: GitHub issues, pull requests, discussions, and any channels where Edict is discussed.

## Enforcement

Contributions that don't meet project standards (failing tests, unstructured errors, bypassing the type system) will be rejected by CI or review. Repeated low-effort or disruptive contributions may result in blocked access.

## Attribution

Inspired by the Edict design philosophy: precision over ambiguity, structured over freeform, deterministic over subjective.
