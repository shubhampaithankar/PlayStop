# DESIGN.md: PlayStop web (milestone 3)

Binding design contract for `apps/web`. Implementation must not deviate without updating this file.
Grounded in: F1/WEC broadcast timing towers, MoTeC/sim-racing telemetry screens, PS5 system UI
typography discipline. Not: cyberpunk neon, pixel art, generic dark dashboard.

## Brand and Voice

- Product: self-serve station booking for a physical gaming lounge (PS5/PS3/PS2/racing sim, per half hour, 14:00 to 02:00).
- Audience: players on phones, often standing in or near the venue, deciding between two stations.
- The page's one job: get from "tonight?" to a confirmation code in under a minute.
- Concept: **a timing board, not a storefront.** The availability grid is styled like a race
  timing tower: station rows, monospaced time columns, one live playhead at the current time.
  Time is the material of the product (you buy half-hour cells, a hold burns down, the night
  advances), so time is drawn as a physical track everywhere.
- Brand hook: the name IS the transport controls. Wordmark: `PLAY` in display face + a solid
  play triangle, `STOP` counterweighted with a filled square. Green means go (select, confirm),
  red means stop (cancel, expiry). These two are functional colors, never decoration.
- Relation to the portfolio site (16-bit game UI): deliberate sibling, not a copy. Same
  conviction (the UI is a game system, not a document), different era: this is the modern
  console / broadcast register because the venue rents PS5s, not NESes, and because a
  state-dense 15x24 grid needs telemetry discipline, not chunky pixel frames.
- Voice: pit-wall terse. Sentence case everywhere except display headings and station IDs
  (uppercase). Active verbs on buttons ("Hold this slot", "Confirm booking", "Cancel booking").
  Errors are direct: "Someone else holds 19:30 to 20:30. Pick another start." Never "Oops".

## Color

Tailwind v4 tokens, paste into the global CSS. Light is default, dark via `.dark` on `<html>`
(shadcn convention, `@custom-variant dark (&:is(.dark *));`).

```css
@import "tailwindcss";
@custom-variant dark (&:is(.dark *));

@theme {
  /* base, dark ("night race") */
  --color-pit-950: #101318;   /* page bg */
  --color-pit-900: #181D26;   /* raised surface: cards, free cells */
  --color-pit-700: #39404E;   /* decorative hairlines only, fails 3:1 on purpose */
  --color-edge-dark: #626C80; /* functional borders on dark: 3.52:1 vs pit-950 */
  --color-chalk: #EDEFF2;     /* text on dark */
  --color-steel: #9AA3B2;     /* muted text on dark */
  /* base, light ("paddock day") */
  --color-paper: #F4F6F9;     /* page bg, cool, never cream */
  --color-ink: #161A21;       /* text on light */
  --color-slate-mut: #4B5563; /* muted text on light */
  --color-hairline: #C3CAD5;  /* decorative hairlines on light */
  --color-edge-light: #6E7888;/* functional borders on light: 4.12:1 vs paper */
  /* signal pair + warning, per theme */
  --color-go: #15803D;        /* light-theme green */
  --color-go-bright: #4ADE80; /* dark-theme green */
  --color-hold-amber: #B45309;      /* light */
  --color-hold-amber-bright: #FBBF24; /* dark */
  --color-stop-red: #B91C1C;        /* light */
  --color-stop-red-bright: #F87171; /* dark */
}
```

Map shadcn variables (`--background`, `--foreground`, `--primary`, `--destructive`, `--border`,
`--muted`, `--ring`) onto these in `:root` / `.dark`. `--primary` = go green of the theme,
`--destructive` = stop red of the theme, `--ring` = go green. No color exists outside this table.

Measured contrast (WCAG relative luminance), all pass AA (4.5:1 text, 3:1 non-text):

| Pair | Dark | Light |
|---|---|---|
| Body text on page bg | chalk/pit-950 **16.16** | ink/paper **16.11** |
| Body text on raised | chalk/pit-900 **14.67** | ink/white **17.44** |
| Muted text on page bg | steel/pit-950 **7.32** | slate-mut/paper **6.98** |
| Green as text/icon | go-bright/pit-950 **10.68** | go/paper **4.63** |
| Button label on green | pit-950/go-bright **10.68** | white/go **5.02** |
| Amber as text/stripe | amber-bright/pit-950 **11.15** | hold-amber/paper **4.64** |
| Red as text | red-bright/pit-950 **6.73** | stop-red/paper **5.98** |
| Label on red button | pit-950/red-bright **6.73** | white/stop-red **6.47** |
| Cell border (non-text) | edge-dark/pit-950 **3.52** | edge-light/paper **4.12** |
| Booked solid fill vs bg | chalk/pit-950 **16.16** | ink/paper **16.11** |

`pit-700` and `hairline` are for row separators and card outlines that repeat information
already carried elsewhere. Never use them as the only boundary of an interactive target.

## Typography

Three faces by role, self-hosted (fontsource), subset to latin:

- **Display: Saira SemiCondensed** 700 only (600 dropped to save a request, see the note below). Uppercase, `tracking-wide` (0.025em). Headings,
  station IDs, the wordmark, section eyebrows. This is the motorsport voice; nowhere else.
- **Body: IBM Plex Sans** 400/600 (500 dropped, see the note below). Everything conversational: labels, form fields,
  paragraphs, buttons.
> Font budget, decided 2026-08-09: six files, roughly 120 KB. The original
> contract specified eight (Saira 600, Plex Sans 500 as well). Those two were
> cut for about 40 KB and two fewer requests on a cold start, which matters
> because the API is on a spin-down free tier and first paint already waits
> on it. Reinstate them only with a measured reason.

- **Utility: IBM Plex Mono** 400/500 with `font-variant-numeric: tabular-nums`. Every time
  label, price, countdown, confirmation code, date. If it is a number a player compares or
  copies, it is mono.

Scale (rem, mobile-first): 12 (`text-xs`, grid time labels, legend), 14 (`text-sm`, body
default on mobile, cell aria hints), 16 (`text-base`, body desktop, inputs), 18 (`text-lg`,
station names), 24 (`text-2xl`, screen titles), 34 (display, landing venue name), 48
(countdown digits in the hold panel). Line-height 1.5 body, 1.1 display. No font size outside
this list.

## Spacing and Layout

4px base scale: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64. Content max-width 1100px centered,
16px page gutter on mobile, 24px from `md`.

**The grid (`/book`) is designed first; everything else inherits.**

- Desktop (>= 768px): timing-tower orientation. Stations are rows, time runs left to right.
  Sticky left rail (station name + kind badge + rate, 160px), sticky time header (mono, every
  hour labeled, half hours ticked). Cells 40px wide x 48px tall, 2px gap.
- Mobile (< 768px): transposed. Time runs down (natural thumb scroll), stations are columns
  with horizontal scroll. Sticky top station header (56px, name + kind), sticky left time rail
  (56px, mono). Cells 44px x 44px minimum, 2px gap. Snap scrolling per station column.
- Wide content scrolls inside the grid container only; the page never scrolls horizontally.

```
desktop                              mobile
+---------+--------------------+     +----+------------------+
| date  < 2026-08-09 >  legend |     |date pick  |legend     |
+---------+--------------------+     +----+------------------+
|         | 14:00 15:00 16:00 →|     |    |PS5-1 PS5-2 SIM →|
| PS5-1   | [][][][][][][][][] |     |1400| []   []    []   |
| PS5-2   | [][][][][][][][][] |     |1430| []   []    []   |
| SIM-1   | [][][][][][][][][] |     |1500| []   []    []   |
|   ▼ playhead at now          |     |  ← playhead row →    |
+------------------------------+     +----+------------------+
| selected: PS5-2 19:30-21:00  920 INR   [ Hold this slot ]  |
+------------------------------------------------------------+
```

Selection summary is a sticky bottom bar (mobile) / bottom-right card (desktop) that appears
once a start cell is tapped, showing station, range, running `priceBooking` total in mono, and
the primary CTA.

**Signature element: the playhead.** A 2px line in the theme's go green crossing the grid at
the current time (only when viewing today), with a small solid play-triangle at its head and
`NOW` in 12px mono. The same motif, time as a consumable track, reappears exactly once more:
the hold countdown bar. Nothing else glows, animates, or takes the accent by default. This is
the one loud thing.

Screens:
- `/` landing: venue name in display face, opening hours ("14:00 to 02:00" in mono), date
  picker (shadcn Calendar: disable past, beyond `maxAdvanceDays`, and `blackoutDates`), station
  kind summary. No hero illustration.
- `/book` grid as above. `closed` reasons render a full-grid empty state with the reason in
  plain words. `degraded: true` renders an amber Alert above the grid: "Live holds are
  unavailable right now. A slot shown free may already be held."
- `/book/:stationId` hold panel: selected range recap, countdown (below), player form
  (name required, email/phone optional), confirm CTA.
- `/booking/:id` confirmation: code in 24px mono inside a bordered box (the one thing the
  player must keep, say so), booking recap, cancel button (destructive variant, confirm Dialog).

## Radius Elevation and Motion

- Radius: 6px cards/inputs/buttons, 2px grid cells, 999px only on kind badges. Nothing else.
- Elevation: flat. Depth comes from surface steps (bg vs raised) plus 1px borders. One shadow
  in the whole app: the sticky selection bar (`0 -4px 16px rgb(0 0 0 / 0.15)`) so it reads as
  floating above the grid it summarizes.
- Motion budget, entire app: (1) grid mount, playhead draws in over 200ms and cell columns fade
  in with a 15ms stagger, once per date change; (2) countdown bar width, linear 1s steps;
  (3) countdown final-20s pulse; (4) shadcn defaults for Dialog/Drawer. Nothing else moves.
  `prefers-reduced-motion`: kill 1 and 3 entirely (instant render, static bar color change
  still applies), keep 2 as stepped updates.

**Hold countdown (TTL = `ttlSeconds`, default 300):** full-width Progress bar in the hold
panel, remaining time in 48px mono to its right (`m:ss`). Width = remaining/ttl, updated per
second against `expiresAt` (never a client-side counter alone; recompute from the timestamp so
tab sleep does not lie). Color by remaining time: green above 60s, amber 60 to 21s, red at 20s
and below plus a 1s opacity pulse on the digits. Announce via a polite `aria-live` region at
60s ("One minute left on your hold"), 20s, and 0. At expiry: bar empties, panel border turns
red, form disables, content swaps to "Hold expired, the slot may have been taken" with two
actions: "Try to hold again" (re-POST /holds) and "Back to grid". A 410 `HOLD_EXPIRED` on
confirm lands on the same state.

## Components (variants and states)

shadcn/ui mapping, themed, never restyled beyond tokens:

| UI | shadcn | Notes |
|---|---|---|
| Date picker | `Calendar` + `Popover` | disabled dates from venue config |
| Kind filter | `ToggleGroup` | All / PS5 / PS3 / PS2 / Racing sim |
| Selection bar CTA, confirm | `Button` default variant (go green) | |
| Cancel booking | `Button` destructive + `Dialog` confirm | |
| Hold panel (mobile) | `Drawer` | desktop: `Dialog` |
| Player form | `Form` + `Input` + `Label` | inline errors below fields, red text + icon |
| Countdown | `Progress` + mono digits | see above |
| Degraded / closed notices | `Alert` | amber / neutral |
| API 409/410 feedback | `Sonner` toast + cell state refetch | message names the time range |
| Loading grid | `Skeleton` rows in grid geometry | |
| Kind badge, state legend | `Badge` outline variant | |
| Confirmation code | custom bordered `<code>` block | mono 24px, copy button |

**Grid cells are not a shadcn component.** They are custom `<button>` / `<div role="gridcell">`
elements inside `role="grid"`. Only `free` cells are buttons; all others are non-focusable
gridcells with `aria-disabled` and a full text label ("19:30, PS5-2, booked"). Arrow keys move
a roving tabindex across the grid; Enter/Space selects.

**The six cell states.** Each has a texture or structure signal that survives grayscale; hue is
reinforcement, never the only channel. Legend (Badge chips reproducing each texture + word) is
always visible above the grid.

| State | Fill | Border | Non-color signal |
|---|---|---|---|
| `free` | raised surface (pit-900 / white) | 1px solid edge-* | the only outlined-and-empty cell, and the only focusable one |
| selected (client) | go green | none | solid play triangle glyph, label inverts |
| `held` | transparent + 45deg amber stripes (3px stripe / 5px gap, `repeating-linear-gradient`) | 1px amber | diagonal stripes |
| `booked` | solid theme ink (chalk on dark, ink on light) | none | the only fully solid cell |
| `maintenance` | crosshatch in steel/slate-mut (both diagonals, 6px pitch) | 1px edge-* | crosshatch + 12px wrench icon (lucide `wrench`) when cell >= 40px |
| `past` | page bg (recessed) | none | structurally blank, visually absent |
| `too_far_ahead` | page bg | 1px dashed edge-* | dashed outline, empty |

Stripe and crosshatch colors meet 3:1 against their cell background in both themes (amber
11.15 dark / 4.64 light; steel 7.32 dark / slate-mut 6.98 light). Focus ring: 2px go-green
outline with 2px offset, visible on every focusable element, both themes.

Range picking: tapping a free cell selects the station's minimum run (`minSlots`); +30 / -30
steppers in the selection bar grow or shrink the run, clamped to `maxSlots` and to contiguity
in the returned cell array (array adjacency, never timestamp arithmetic, per the DST rule in
milestone-2-spec section 6). Cells in the pending range render as selected.

## Do NOT

- Do not convey any cell state by hue alone, and do not add a seventh visual state. `degraded`
  is a banner, not a cell texture.
- Do not compute cell adjacency with `startsAt + n * gridMinutes`. Array order is the truth
  (DST nights break the arithmetic). Do not filter cells on `localLabel` dates.
- Do not run the countdown off `setInterval` drift; derive remaining from `expiresAt` each tick.
- Do not use green or red decoratively. Green appears only on: playhead, selection, focus ring,
  primary CTA, healthy countdown. Red only on: cancel, errors, final countdown, expiry.
- Do not use pixel fonts, dithering, or 16-bit frames. That is the portfolio site's register.
- Do not use neon glows, purple/indigo gradients, glassmorphism, backdrop blur, emoji as icons,
  `rounded-2xl` + `shadow-lg` cards, or Inter.
- Do not put the accent on the wordmark's STOP square. It is ink, always.
- Do not show a client-computed price as final; label it "estimated" until the hold's
  `quoteMinor` arrives, then show `quoteMinor`; confirm response `totalMinor` is authoritative.
- Do not animate cell state changes on refetch (the grid would shimmer constantly); swap
  instantly.
- Do not shrink grid touch targets below 44x44 on mobile or 40x48 on desktop for density.
  If a venue ever exceeds 15 stations, paginate stations, never shrink cells.