---
description: Autonomous continuation — assess project state and drive forward independently
---

# /cont — Continue Autonomously

You are the leader, decision maker, and driver. The user is observing. Your job is to assess the current state of the project and take the highest-impact next action toward the project's goals.

// turbo-all

## Steps

### 1. Orient — Assess Current State

- Read `ROADMAP.md` (or equivalent project planning doc) to understand the overall vision
- Read `tasks/lessons.md` for patterns to avoid
- Check recent git history (`git log -n 10 --oneline`) to understand momentum
- Run the test suite (`npx vitest run`) to establish baseline health
- Identify: what's done, what's in progress, what's next

### 2. Decide — Pick the Highest-Impact Next Task

Based on the roadmap and current state, choose ONE concrete task that:
- Unblocks the most downstream work
- Is achievable in a single session
- Builds on what's already solid (don't rewrite working code)

Write a brief rationale for your choice (2-3 sentences max) and proceed.

### 3. Plan — Write the Implementation Plan

- Create an implementation plan artifact following standard format
- Self-review it using the `/review` workflow mentally (don't run the full workflow unless the change is complex)
- For simple/mechanical changes, skip the plan artifact and just execute

### 4. Execute — Implement the Change

- Make the changes
- Follow project conventions and existing patterns
- Keep changes minimal and focused
- Write tests for new behavior

### 5. Verify — Prove It Works

- Run the full test suite — zero regressions required
- Verify the new behavior specifically
- Update `tasks/lessons.md` if you learned something

### 6. Report — Brief the User

Use `notify_user` with a concise summary:
- What you chose and why
- What you did
- Test results
- What the logical next step would be

Then stop and wait for the user to acknowledge or redirect.

## Principles

- **Bias toward action** — don't ask permission, make decisions
- **One thing at a time** — finish one task fully before starting another
- **Leave things better** — if you spot a small issue adjacent to your work, fix it
- **Stay on the roadmap** — don't invent features the roadmap doesn't call for
- **Ship quality** — every change must pass tests and be something a staff engineer would approve
