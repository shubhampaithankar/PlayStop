# Testing

Node's built-in runner (`node --test`) against compiled output. No Vitest, no Jest.

Tests live in `tests/` mirroring `src/`, never beside source. They compile to `dist-tests/`,
kept out of the shipped `dist/` so no package ever ships its own tests.

```
pnpm test                                          everything
node --test dist-tests/grid.test.js                one file, after building the package
node --test --test-name-pattern="spring forward" dist-tests/    one test by name
```

## Three layers, deliberately separate

| Layer | Where | Against |
|---|---|---|
| Pure engine tests | `packages/engine/tests/` | nothing, no I/O, sub-second |
| Low-volume integration | `apps/api/tests/` | the shared Atlas dev database |
| The concurrency proof | `apps/api/tests/`, gated | CI service containers only |

The fast layer having no I/O is the property worth protecting. It is why each package keeps
its own runner invocation rather than one suite at the workspace root.

## The CI gate

The concurrency proof is gated behind `TEST_PROFILE=ci`. **Never set that locally.** Atlas M0
throttles at 100 operations per second, and a 50-way burst there produces failures that look
exactly like genuine race conditions.

`testing-support.ts` throws if `CI` is set without `TEST_PROFILE=ci`, so the proof cannot be
silently dropped while CI still reports green.

## Two hazards that have each cost hours

**Filenames.** A non-test file must never match `test-*.js`, `*-test.js`, `*_test.js` or
`*.test.js`. The runner executes anything matching, whether or not it calls `test()`. The
shared harness is `testing-support.ts` for exactly this reason: as `test-support.ts` it was
executed, and because it opens a Redis connection at import the whole run deadlocked.

**Cleanup.** Any test that starts a server must release it through the shared `teardown`
helper in a `try/finally`. Cleanup skipped after a failed assertion leaves the Redis client
retrying, the event loop never drains, and a **failure becomes a hang**. `teardown` is also
safe when setup itself threw, so the real error surfaces instead of a `TypeError` about
undefined.

## Reading the count

A count that is unexpectedly **high** is as much a red flag as a low one: it means stale
compiled output is being executed alongside the new. Delete the directory rather than
explaining it. Every `build` script removes its output first for this reason.
