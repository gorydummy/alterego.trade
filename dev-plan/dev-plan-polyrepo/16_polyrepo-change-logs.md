# 16 — Polyrepo Change Logs

- Updated all docs to reflect **polyrepo** repos, CI/CD, and promotion flows.
- Staging deploy moves to **per-repo** pipelines; production promotion is via **service tags** and `infra` PRs.
- Contracts are now a **published package**, not a workspace.
- AI service consumes **schemas artifact** for Pydantic codegen.
- Observability, Security, Test Strategy unchanged functionally; only release mechanics moved.
