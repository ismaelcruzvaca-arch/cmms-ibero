# Skill Registry — cmms-ibero

Generated: 2026-06-04

## User Skills

| Skill | Trigger | Source |
|-------|---------|--------|
| branch-pr | PR creation, opening a PR, preparing changes for review | `~/.config/opencode/skills/branch-pr/SKILL.md` |
| chained-pr | PRs over 400 lines, stacked PRs, review slices | `~/.config/opencode/skills/chained-pr/SKILL.md` |
| cognitive-doc-design | Writing guides, READMEs, RFCs, onboarding, architecture, or review-facing docs | `~/.config/opencode/skills/cognitive-doc-design/SKILL.md` |
| comment-writer | PR feedback, issue replies, reviews, Slack messages, or GitHub comments | `~/.config/opencode/skills/comment-writer/SKILL.md` |
| customize-opencode | Editing opencode config, agents, subagents, skills, plugins, MCP servers, permission rules | Built-in (`<built-in>`) |
| go-testing | Go tests, teatest, adding test coverage | `~/.config/opencode/skills/go-testing/SKILL.md` |
| issue-creation | GitHub issue creation, bug report, feature request | `~/.config/opencode/skills/issue-creation/SKILL.md` |
| judgment-day | "judgment day", adversarial review, dual review | `~/.config/opencode/skills/judgment-day/SKILL.md` |
| skill-creator | New skills, agent instructions, documenting AI usage patterns | `~/.config/opencode/skills/skill-creator/SKILL.md` |
| work-unit-commits | Implementation, commit splitting, chained PRs, keeping tests/docs with code | `~/.config/opencode/skills/work-unit-commits/SKILL.md` |

## Compact Rules

### branch-pr
- Every PR MUST link an approved issue (status:approved) — no exceptions
- Branch naming: `type/description` with `^feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert` prefix
- Exactly one `type:*` label per PR
- Conventional commits: `type(scope): description` regex enforced
- PR body must include Linked Issue, PR Type, Summary, Changes Table, Test Plan, Contributor Checklist
- No `Co-Authored-By` trailers allowed
- Automated checks must pass before merge

### chained-pr
- Split PRs over 400 changed lines unless explicit `size:exception`
- Keep each PR reviewable in ≤60 minutes
- One deliverable work unit per PR; tests/docs with the unit
- Every child PR needs dependency diagram with `📍` marker
- Feature Branch Chain: create draft tracker PR; child PR #1 targets tracker branch
- Fix base bugs by retargeting/rebasing until diff is clean

### cognitive-doc-design
- Lead with the answer — decision/action first, context after
- Progressive disclosure: happy path → details → edge cases → references
- Chunk related info into small sections; keep flat lists short
- Signpost with headings, labels, callouts, summaries
- Recognition over recall: tables, checklists, examples over prose
- PR docs: state what to review first, what's out of scope, link prev/next PR

### comment-writer
- Start with actionable point; no recaps
- Be warm and direct like a thoughtful teammate
- Keep to 1-3 short paragraphs or a tight bullet list
- Explain WHY when asking for a change
- Avoid pile-ons — comment on highest-value issue only
- Match thread language; in Spanish use Rioplatense voseo (podés, tenés)
- No em dashes; use commas, periods, or parentheses

### customize-opencode
- Use ONLY when editing opencode's own config (opencode.json, .opencode/, ~/.config/opencode/)
- NOT for user application code or non-opencode projects
- Covers: agents, subagents, skills, plugins, MCP servers, permission rules

### go-testing
- Prefer table-driven tests with `t.Run(tt.name, ...)`
- Use `t.TempDir()` for filesystem tests
- Test behavior/state transitions, not implementation trivia
- Integration tests skippable with `testing.Short()`
- Golden files: only update through `-update` path; rerun without it to confirm
- Bubbletea: test `Model.Update()` directly for state; use `teatest` for interactive flows

### issue-creation
- Blank issues disabled — MUST use template (bug_report or feature_request)
- Every issue gets `status:needs-review` automatically on creation
- Maintainer MUST add `status:approved` before any PR can be opened
- Questions go to Discussions, not issues
- Pre-flight: search duplicates, choose correct template, fill all required fields

### judgment-day
- Resolve project skills from registry before launching judges
- Launch TWO blind judges in parallel on identical target; never review yourself
- Wait for BOTH judges before synthesis
- `WARNING (real)` only if normal intended use triggers it; else downgrade to INFO
- Re-judge after fix agent runs before commit/push/done
- Terminal states: `JUDGMENT: APPROVED` or `JUDGMENT: ESCALATED`
- After 2 fix iterations with remaining issues, ask user whether to continue

### skill-creator
- Check `docs/skill-style-guide.md` first if it exists
- Skill is runtime instruction contract for LLM, not human documentation
- Body: target 180–450 tokens, hard max 1000
- `description`: one physical line, quoted, ≤250 chars, trigger-first
- Frontmatter required: name, description, license, metadata.author, metadata.version
- Code/schemas → `assets/`; detail/edge-cases → local `references/` links

### work-unit-commits
- Commit by work unit (deliverable behavior/fix/migration/docs), NOT by file type
- Keep tests with the code they verify; docs with the user-visible change
- Each commit should be independently reviewable and candidate for chained PR
- SDD workload guard: if forecast >400 lines, group into chained PR slices pre-implementation
- Rollback must be reasonable without reverting unrelated work

## Project Conventions

| File | Description |
|------|-------------|
| `AGENTS.md` | Code review rules: functional components, const/let, async/await, .jsx extensions, no any types |
| `DEVELOPMENT.md` | Architecture documentation: ISO 14224 schema, RBAC, audit trail, FSM lifecycle, no-Docker constraint |
| `openspec/config.yaml` | SDD initialization context, strict_tdd, testing capabilities, phase rules |

## Notes

- SDD skills (sdd-*) and internal (_shared, skill-registry) are excluded from this registry.
- No project-level skill directories found.
- No TypeScript config (tsconfig) or formatter (prettier) detected.
