# Conventions

Short, single-topic rules. Each file is the source of truth for its topic; `CLAUDE.md` links
here rather than restating them.

- `modules.md`: folder-per-thing, when a companion file is earned, per-package layout
- `constants.md`: enum-like values, one declaration with the union derived from it
- `contracts.md`: the types/engine boundary, parse never cast, request headers
- `testing.md`: three layers, the CI gate, and two hazards that each cost hours
- `naming-and-builds.md`: filenames, build cleaning, filters, the bundle check
- `booking-correctness.md`: why Redis is UX and Mongo is truth

Most of these exist because something broke. Where a rule has a cost attached, the file says
what it was, so the rule can be argued with on the evidence rather than followed on faith.
