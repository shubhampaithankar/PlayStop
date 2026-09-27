# Todos

| Issue | Severity | Effort | Status |
|-------|----------|--------|--------|
| Wire a real OTP/messaging sender before production; only the mock `devCode` path exists today, so prod is un-bookable | High | M | Todo |
| Seed pre-booked slots on a few consoles for the current business week so the demo grid shows taken cells and `free_from` runs; anchor the data to the running week so each fresh seed populates the week being demoed | Medium | S | Todo |
| Seed at least one non-active or under-maintenance station (seed forces `status:"active"`, `maintenanceWindows:[]`) so the unavailable ghost card and the "being fixed" cell state appear in a demo | Medium | S | Todo |
| Seed one near-full station so the `free_from` and `booked_out` grid states show in a demo | Low | S | Todo |
