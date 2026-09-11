# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root: it points at one `CONTEXT.md` per context (package). Read each one relevant to the topic.
- **`docs/adr/`** at the repo root: system-wide decisions.
- **`<package>/docs/adr/`** (e.g. `services/finance-agent/docs/adr/`, `apps/frontend/docs/adr/`): context-scoped decisions for the package you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Multi-context repo — one context per yarn workspace package:

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← system-wide decisions
├── services/
│   ├── auth/
│   │   ├── CONTEXT.md
│   │   └── docs/adr/
│   ├── finance-agent/
│   │   ├── CONTEXT.md
│   │   └── docs/adr/
│   ├── logistics-agent/
│   │   ├── CONTEXT.md
│   │   └── docs/adr/
│   ├── notification/
│   │   ├── CONTEXT.md
│   │   └── docs/adr/
│   ├── orchestrator/
│   │   ├── CONTEXT.md
│   │   └── docs/adr/
│   ├── orchestrator-agent/
│   │   ├── CONTEXT.md
│   │   └── docs/adr/
│   ├── preference-agent/
│   │   ├── CONTEXT.md
│   │   └── docs/adr/
│   ├── shared/
│   │   ├── CONTEXT.md
│   │   └── docs/adr/
│   ├── sharing/
│   │   ├── CONTEXT.md
│   │   └── docs/adr/
│   ├── validator/
│   │   ├── CONTEXT.md
│   │   └── docs/adr/
│   └── ws-relay/
│       ├── CONTEXT.md
│       └── docs/adr/
└── apps/
    └── frontend/
        ├── CONTEXT.md
        └── docs/adr/
```

None of these files exist yet — this layout is where `/domain-modeling` will
create them as contexts get modelled, not a checklist to fill in now.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the relevant package's `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR (root `docs/adr/` or a package's `docs/adr/`), surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
