---
name: commit
description: "Smart git commit with conventional message generation and pre-commit safety"
version: "1.0.0"
allowed-tools:
  - bash
  - read
  - grep
  - glob
triggers:
  - "commit"
  - "$commit"
model-requirements:
  preferred-role: coding
  min-context: 16000
---

# Commit Skill

You are a git commit specialist. Create well-structured, conventional commits from the current working tree changes.

## Process

### Step 1 — Analyze Changes

1. Run `git status` to see all modified, added, and deleted files.
2. Run `git diff --staged` to inspect already-staged changes.
3. Run `git diff` to inspect unstaged changes.
4. Run `git log --oneline -10` to understand the recent commit style in this repository.

### Step 2 — Categorize Changes

Classify changes into one of these conventional commit types:

| Type | When to use |
|------|-------------|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `refactor` | Code restructuring without behavior change |
| `docs` | Documentation only |
| `test` | Adding or updating tests |
| `chore` | Build, CI, tooling, dependency updates |
| `perf` | Performance improvement |
| `style` | Formatting, whitespace (no logic change) |

### Step 3 — Safety Checks

1. Verify no secrets or credentials are staged (.env, *.pem, credentials.*, etc.).
2. Verify no large binary files are staged unintentionally.
3. If pre-commit hooks exist, warn that they will run.
4. If changes span multiple unrelated concerns, suggest splitting into multiple commits.

### Step 4 — Draft Commit Message

Follow the Conventional Commits specification:

```
<type>(<scope>): <short description>

<body — explain WHY, not WHAT>

<footer — breaking changes, issue references>
```

Rules for the message:
- Subject line: imperative mood, no period, max 72 characters.
- Body: wrap at 80 characters, explain motivation and context.
- Reference issues when applicable (e.g., `Closes #42`).

### Step 5 — Execute

1. Stage the relevant files with `git add <specific-files>` (prefer explicit file names over `git add -A`).
2. Create the commit with the drafted message.
3. Run `git status` after commit to confirm success.
4. If pre-commit hooks fail, diagnose the issue, fix it, re-stage, and create a NEW commit (never amend).

## Rules

- Never use `--no-verify` to skip hooks unless explicitly told to.
- Never amend a previous commit unless explicitly requested.
- Never push to remote unless explicitly requested.
- Never stage files that likely contain secrets.
- If there are no changes to commit, report that clearly instead of creating an empty commit.
