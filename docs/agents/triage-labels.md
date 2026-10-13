# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to what the Linear team `APP` actually uses: two of them are workflow states rather than labels.

| Role in mattpocock/skills | In our tracker              | Meaning                                  |
| ------------------------- | --------------------------- | ---------------------------------------- |
| `needs-triage`            | state `Triage`              | Maintainer needs to evaluate this issue  |
| `needs-info`              | label `needs-info`          | Waiting on reporter for more information |
| `ready-for-agent`         | label `ready-for-agent`     | Fully specified, ready for an AFK agent  |
| `ready-for-human`         | label `ready-for-human`     | Requires human implementation            |
| `wontfix`                 | state `Canceled`            | Will not be actioned                     |

When a skill mentions a role, apply the corresponding label (`linear issue update APP-N --add-label ...`) or move the issue to the corresponding state (`--state Triage` / `--state Canceled`). Triaging an issue out of `Triage` means moving it to `Backlog` or `Todo`.

Issue type is a separate, workspace-wide label: `Bug`, `Feature` or `Improvement`.
