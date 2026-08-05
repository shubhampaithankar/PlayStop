# @playstop/web

Vite + React 19 + TypeScript + Tailwind CSS v4 front end for PlayStop.
Milestone 1 is a single page that pings the API's `/health` route and shows
the result, proving the web-to-api wiring works end to end.

## Run locally

```
pnpm --filter @playstop/types build   # once, or after editing packages/types
pnpm dev:web                            # http://localhost:5173
```

## Env vars

Copy `.env.example` to `.env` to override the default.

| Var | Default | Notes |
| --- | --- | --- |
| `VITE_API_URL` | `http://localhost:3001` | falls back in code, `App.tsx`, if unset |

## Module alias

`@/*` maps to `src/*`. Set in both `tsconfig.json` (`paths`, for typecheck
and editor tooling) and `vite.config.ts` (`resolve.alias`, for the actual
bundle), since Vite doesn't read tsconfig `paths` on its own.

## Tailwind v4

Set up via the `@tailwindcss/vite` plugin in `vite.config.ts`, styles pulled
in with `@import "tailwindcss";` in `src/index.css`. Tailwind v4 does config
through CSS, not a JS file, so there is deliberately no `tailwind.config.js`
in this package.

## Deployment

Deploys to Cloudflare Pages. Pages is configured entirely in the Cloudflare
dashboard (build command, output directory, env vars), not by a file in this
repo. See the root README's deployment section for the exact dashboard
settings.
