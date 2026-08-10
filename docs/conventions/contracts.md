# Contracts and the package boundary

Every shape that crosses the web-to-api network boundary is a Zod contract in
`packages/engine/src/contracts/<name>/`, defined once and imported by both sides.

## Which package holds what

| | `packages/types` | `packages/engine` |
|---|---|---|
| Holds | declarations, plus the enum const objects | everything with runtime behaviour |
| Contents | domain unions, compute vocabulary, Mongo document shapes | Zod contracts, inferred types, shared constants, pure logic |
| Dependencies | none | zod, luxon |

Direction is one way: `engine` may import `types`; `types` imports nothing. Both apps may
import either.

The split is runtime versus declaration, not domain versus generic. A Zod schema is runtime,
so it is in `engine` even though it describes a domain shape.

## Parse, never cast

```ts
const booking = bookingResponseSchema.parse(await res.json());   // yes
const booking = (await res.json()) as BookingResponse;           // no
```

A cast is a compile-time lie. Structural drift is caught by the controllers' return
annotations, but **refinement drift is not**: tightening a regex, a `min`, a `max`, `.uuid()`
or `.datetime()` infers to the same TypeScript type, compiles clean through typecheck, lint,
build and test, and then fails to parse in the browser. Tests validating whole responses
against their schema is the only thing that closes that gap.

## Epoch milliseconds versus the wire

`engine`'s compute types use epoch milliseconds (`cellStartMs: number`); the wire uses ISO
8601 UTC strings (`startsAt: string`). Same concept, two representations, deliberately. The
millisecond form is what makes the DST arithmetic safe. Do not try to unify them.

## Request headers

The client never sends `X-Request-Id`. The API always generates its own and ignores any
incoming header, so a client-supplied id would correlate with nothing. The client reads it off
the response, falling back to `error.requestId` in the body.

`X-Request-Id`, `Retry-After` and `Idempotent-Replay` are only readable cross-origin because
`app.ts` lists them in the CORS `exposedHeaders`. Removing that breaks the client silently,
with no test failure.
