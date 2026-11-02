---
name: writing
description: "Load this skill before you write agent instructions in a project with AGENTS.md or SKILL.md, or when the task names technical writing. Covers agent instructions, skill descriptions, docs, RFCs, PR descriptions, and commit messages."
license: MIT
metadata:
  author: your-org
---

# Writing

Paths in this file are relative to the folder that contains this SKILL.md.

- Before you write or edit a skill, `AGENTS.md`, `CLAUDE.md`, or another document that agents read, read writing-for-agents. Read its supporting files when its index.md points to them.
- When the user asks for technical writing by name, read technical-writing before you write docs, READMEs, RFCs, PR descriptions, or commit messages.

## mattpocock

- [writing-for-agents](references/mattpocock/writing-for-agents/index.md): Writing documents for agents. Use when creating or editing skills, or modifying AGENTS.md or CLAUDE.md.

## pstack

### Use only when the user asks for it by name

- [technical-writing](references/pstack/technical-writing/index.md): Layered technical-writing standard: Diátaxis structure, Google developer style sentences, STE instruction rules, Global English syntax. Use for /technical-writing or when writing or reviewing docs, RFCs, readmes, PR descriptions, or commit messages. (`disable-model-invocation: true`)

## Sources

- mattpocock: https://github.com/mattpocock/skills.git revision `4ae2317ddb22b046e26455e4f9c9b3aaaf62212d`.
- pstack: https://github.com/cursor/plugins.git revision `ae5650febf4320793844c12c4adaa937f417f8da`.
