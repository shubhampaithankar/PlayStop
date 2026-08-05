# Project: PlayStop

> Follow global rules at @~/.claude/CLAUDE.md. This file only adds project-specific
> facts and overrides, it never relaxes or contradicts a global rule.

## Stack
- Language: TypeScript 5.x, strict
- Web: Vite + React 19 + Tailwind CSS v4 (`@tailwindcss/vite`)
- API: Express 5 + Zod, run via `tsx` in dev, compiled with `tsc` for prod
- Shared: `packages/shared` exports Zod schemas consumed by both apps
- Package manager: pnpm workspaces (`packageManager` pinned in root `package.json`)

## Commands
- `pnpm install` (root)
- `pnpm --filter @playstop/shared build` (run once, or after editing shared, before `dev`/`build` elsewhere)
- `pnpm dev:web` (port 5173) / `pnpm dev:api` (port 3001)
- `pnpm typecheck` / `pnpm lint` / `pnpm build`

## Workflow
- **Brainstorm before building** — `superpowers:brainstorming` to settle intent and design first.
- **Docs via Context7** — query the `context7` MCP for any library/framework/API, do not trust memory.
- **Skill before acting** — `systematic-debugging` before a bugfix, `verification-before-completion` before claiming done.

## Conventions
- Workspace packages are scoped `@playstop/*`.
- `packages/shared` has no build-time dependency on `apps/*`, only the reverse.
- API env is parsed and validated with Zod at boot (`apps/api/src/env.ts`), invalid env fails fast.
- No DB, no auth, no booking logic yet. Milestone 1 is scaffold only, see "Do NOT" below.

## Testing
- No test suite yet (milestone 1 is scaffold-only). Add tests starting milestone 2.

## Key Files
- `apps/api/src/server.ts` — Express app, `/health` route, CORS bound to `WEB_ORIGIN`
- `apps/api/src/env.ts` — Zod env validation, fails fast on boot with a readable error
- `apps/web/src/App.tsx` — single page, pings `/health` on mount
- `packages/shared/src/index.ts` — `healthResponseSchema`, the proof the workspace link is real

## Reference
- @.claude/rules/lang.md
- @README.md — local dev and deploy steps (Cloudflare Pages, Render, keepalive ping)

## Do NOT
- Add shadcn/ui, TanStack Router/Query/Table, MongoDB, Mongoose, Redis, Docker, Turborepo,
  tests, auth, or booking logic. Those are milestone 2, adding them now is scope creep.
- Add a new dependency without checking `packages/shared` and existing workspace deps first.

## On compaction, preserve
- modified-files list, test commands and results, current plan, unresolved errors
