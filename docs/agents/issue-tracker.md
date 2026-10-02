# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues in `pihme/claude-budget-mcp`. Use the `gh` CLI for all operations; inside a clone it infers the repo from `git remote -v`.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..." --label "..."`. Use a heredoc for multi-line bodies. Pick the label of the matching issue form (`bug`, `enhancement`, `documentation`, `question`).
- **Read an issue**: `gh issue view <number> --comments` (add `--json labels` for labels).
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with `--label` / `--state` filters.
- **Comment**: `gh issue comment <number> --body "..."`
- **Labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

**Who may write:** agents open issues for their own findings and close issues fixed by their own commits (`Closes #n` in the commit body). Comments, reviews, label changes or closes on other people's issues and PRs only when the maintainer asked for it in the session. Exception: Dependabot PRs (merge on green CI, `@dependabot rebase`).

## Pull requests as a triage surface

**PRs as a request surface: yes.** _(`yes` when outside PRs are accepted; the `triage` skill reads this flag.)_

When `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>`.
- **List outside PRs**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`, keeping only `authorAssociation` `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR` or `NONE`.
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label` / `--remove-label`, `gh pr close`.

Issues and PRs share one number space: resolve a bare `#42` with `gh pr view 42`, then fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder` (labels in the optional `labels-wayfinder.json` set). The **map** is one issue labelled `wayfinder:map` (body: Notes / Decisions so far / Fog); **child tickets** are its GitHub sub-issues, labelled `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling` or `wayfinder:task`.

- **Blocking**: GitHub's native issue dependencies: `gh api --method POST repos/pihme/claude-budget-mcp/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>` (database id from `gh api repos/pihme/claude-budget-mcp/issues/<n> --jq .id`). Fallback: a `Blocked by: #<n>` line at the top of the child body.
- **Frontier**: the map's open children without open blockers or assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: comment the answer, close the child, add a one-line pointer to the map's Decisions so far.
