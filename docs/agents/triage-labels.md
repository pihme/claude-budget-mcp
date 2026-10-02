# Triage labels

The engineering skills (`triage` and friends) speak in canonical roles. This table maps them to the label strings in this repo's tracker (created by `scripts/sync-labels.sh` in presets from `labels.json`).

| Role | Label in this tracker | Meaning |
| --- | --- | --- |
| category: bug | `bug` | Something is broken |
| category: enhancement | `enhancement` | New feature or improvement |
| `needs-triage` | `needs-triage` | Maintainer needs to evaluate this issue |
| `needs-info` | `needs-info` | Waiting on the reporter for more information |
| `ready-for-agent` | `ready-for-agent` | Fully specified, ready for an agent to pick up |
| `ready-for-human` | `ready-for-human` | Needs a human to implement or decide |
| `wontfix` | `wontfix` | Will not be actioned |

A triaged issue carries one category and one state label. Rejected enhancements get a short note in `.out-of-scope/<slug>.md` so the same request is recognised next time. Edit the middle column if this repo uses other strings.
