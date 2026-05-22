# Skill Registry — cmms-ibero

Generated: 2026-05-21

## User Skills

| Skill | Trigger | Source |
|-------|---------|--------|
| branch-pr | PR creation, opening a PR, preparing changes for review | `~/.config/opencode/skills/branch-pr/SKILL.md` |
| customize-opencode | Editing opencode config, agents, subagents, skills, plugins, MCP servers, permission rules | Built-in (`<built-in>`) |
| go-testing | Go tests, teatest, adding test coverage | `~/.config/opencode/skills/go-testing/SKILL.md` |
| issue-creation | GitHub issue creation, bug report, feature request | `~/.config/opencode/skills/issue-creation/SKILL.md` |
| judgment-day | "judgment day", adversarial review, dual review | `~/.config/opencode/skills/judgment-day/SKILL.md` |
| skill-creator | Creating new AI skills, agent instructions, documenting patterns | `~/.config/opencode/skills/skill-creator/SKILL.md` |

## Project Conventions

| File | Description |
|------|-------------|
| `AGENTS.md` | Code review rules: functional components, const/let, async/await, .jsx extensions, no any types |
| `DEVELOPMENT.md` | Architecture documentation: ISO 14224 schema, RBAC, audit trail, FSM lifecycle, no-Docker constraint |

## Notes

- SDD skills (sdd-*) and internal (_shared, skill-registry) are excluded from this registry.
- No project-level skill directories found.
- No TypeScript config (tsconfig) or formatter (prettier) detected.
