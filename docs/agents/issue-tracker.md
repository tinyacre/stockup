# Issue tracker: Linear

Issues and specs for this repo live in Linear: team **Apps** (key `APP`, so issues are `APP-123`), project **StockUp**. The team holds several repositories, one project each, so every StockUp issue belongs to the `StockUp` project. Use the `linear` CLI for all operations; `.linear.toml` at the repo root makes `APP` the default team.

## Conventions

- **Create an issue**: `linear issue create --project StockUp --title "..." --description-file body.md --label ready-for-agent --yes`. Add `--parent APP-12` when it is part of a larger piece of work.
- **Read an issue**: `linear issue view APP-12 --no-pager` (comments included); `--json` for labels, state, parent, children and project.
- **List issues**: `linear issue query --project StockUp --json --label ready-for-agent`, narrowed with `--state` (`triage`, `backlog`, `unstarted`, `started`, `completed`, `canceled`, or a state name).
- **Comment on an issue**: `linear issue comment add APP-12 --body "..."` (or `--body-file`).
- **Apply / remove labels**: `linear issue update APP-12 --add-label "..."` / `--remove-label "..."`.
- **Change state**: `linear issue update APP-12 --state "In Progress"`.
- **Close**: comment with the outcome, then `linear issue update APP-12 --state Done` (or `Canceled` for won't-do).
- **Anything the CLI lacks**: `linear api '<GraphQL>'`; `linear schema` prints the schema.

## Referencing issues from git

The Linear GitHub integration links branches, commits and PRs that mention `APP-123`. Put the ID in the branch name (`linear issue start APP-12` checks one out) or the PR title; `Fixes APP-12` in a merged commit or PR closes the issue. `linear issue describe APP-12` prints a title plus trailer for a commit message; `Refs APP-12` links without closing.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, external PRs on GitHub go through the same roles: read with `gh pr view <number> --comments` and `gh pr diff <number>`, list with `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` keeping only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR` or `NONE`, and file a Linear issue for each one accepted as a request, linking the PR with `linear issue link APP-12 <pr-url>`.

## When a skill says "publish to the issue tracker"

Create a Linear issue in team `APP`, project `StockUp`.

## When a skill says "fetch the relevant ticket"

Run `linear issue view <APP-N> --no-pager`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a parent issue with its **children** as sub-issues.

- **Map**: an issue in project `StockUp` labelled `wayfinder:map`, whose description holds the Notes / Decisions-so-far / Fog body.
- **Child ticket**: a sub-issue of the map (`--parent <map>`). Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: Linear's native relation, `linear issue relation add <blocker> blocks <child>`. `linear issue relation list <child>` shows its `blocked-by` edges. A ticket is unblocked when every blocker is Done or Canceled.
- **Frontier query**: the map's children from `linear issue view <map> --json` (`.children`), keeping those in an unstarted or backlog state with no assignee, dropping any whose blockers are still open; first in the order listed wins.
- **Claim**: `linear issue update <APP-N> --assignee @me --state "In Progress"` — the session's first write.
- **Resolve**: `linear issue comment add <APP-N> --body "<answer>"`, then `--state Done`, then append a context pointer (gist + link) to the map's Decisions-so-far.
