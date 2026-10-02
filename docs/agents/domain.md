# Domain docs

How agents and skills consume this repo's domain documentation.

## Before exploring, read these

- **`SPEC.md`**: what the project is, and its decisions. Decisions marked "do not reopen" are settled.
- **`GLOSSARY.md`** at the repo root, if it exists. If it does not, proceed silently; it is created lazily (for example by `/domain-modeling`) when terms actually get resolved.
- **`AGENTS.md`**: working rules and the "Do not invent" list.

Decisions live in `SPEC.md`, not in `docs/adr/`.

## Use the project's vocabulary

When your output names a domain concept (issue title, refactor proposal, test name), use the term as `SPEC.md` / `GLOSSARY.md` define it; do not drift to synonyms. A concept that is missing there is either invented language (reconsider) or a real gap (note it).

## Flag decision conflicts

If your output contradicts a decision in `SPEC.md`, say so explicitly instead of silently overriding:

> _Contradicts the SPEC decision on X, but worth reopening because…_
