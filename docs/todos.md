# Todos

| Issue | Severity | Effort | Status |
|-------|----------|--------|--------|
| Wire a real OTP/messaging sender before production; only the mock `devCode` path exists today, so prod is un-bookable by real customers (deliberately deferred: mock is the right choice for the portfolio demo, and it is a one-file swap in `apps/api/src/libs/notify` when a real sender is wanted) | High | M | Deferred |
| Seed pre-booked slots on a few consoles for the current business week so the demo grid shows taken cells and `free_from` runs; anchor to the running week | Medium | S | Done |
| Seed a non-active / under-maintenance station so the ghost card and "being fixed" cell state appear | Medium | S | Done |
| Seed one near-full station so the `free_from` and `booked_out` grid states show | Low | S | Done |

Seeding items shipped via `seedDemoData` in `apps/api/src/seed.ts` (default-on, re-anchors weekly) and kept fresh in prod by the Monday `weekly-seed` GitHub Actions cron.
