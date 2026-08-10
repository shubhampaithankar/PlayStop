# Naming, builds and scripts

## Filenames

kebab-case, except files whose default export is a React component, which are PascalCase.

`apps/web/src/components/ui/` is shadcn output and keeps whatever the generator writes. Do not
fight the CLI there.

**Never name a non-test file so it matches Node's test glob** (`test-*.js`, `*-test.js`,
`*_test.js`, `*.test.js`). See `testing.md` for what that cost.

## Builds

Every package's `build` removes its output directory before compiling. `tsc` does not clean,
and a stale compiled file keeps running after its source moves or is renamed. This has bitten
the repo twice, most recently making a rename look like it added six tests.

```
pnpm build                            every package, dependency order
pnpm --filter "@playstop/api..." build one app plus only what it needs
pnpm clean                            wipe every dist and dist-tests
```

The `...` suffix on a filter means "and its dependencies". Prefer it over naming packages
explicitly, so the command keeps working when dependencies change. `render.yaml` uses it for
exactly that reason: it previously named packages by hand and silently stopped building
`engine`, which would have crashed the API on boot.

## TypeScript

`exactOptionalPropertyTypes` is on everywhere. Do not switch it off to make something compile.

Two shadcn files carry a documented one-line fix for this, because the generated code is not
written against it. Regenerating them reverts the fix and `pnpm typecheck` fails with `TS2375`
naming the file. Reapply the one-liner; do not disable the option to accommodate two lines of
vendor code. See `apps/web/README.md`.

## The web bundle

`apps/web`'s build runs `scripts/check-no-luxon.mjs`, which greps the built output for luxon
internals (`IANAZone`, `Invalid DateTime`) rather than the string `luxon`. Bundling erases
module specifiers, so grepping the package name finds nothing whether or not the code is
present. The check is wired into the build so it cannot be forgotten.
