# StockUp

家庭共享的好价记忆工具。领域术语见 `CONTEXT.md`，架构决策见 `docs/adr/`。

## Agent skills

### Issue tracker

Issues live in Linear, team Apps (`APP-123`), project StockUp, via the `linear` CLI; `.linear.toml` sets the default team. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles: `needs-triage` and `wontfix` are the `Triage` and `Canceled` states, the other three are labels of the same name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
