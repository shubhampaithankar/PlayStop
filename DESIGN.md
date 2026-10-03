# DESIGN.md: PlayStop web (milestone 3, round 5)

Binding design contract for `apps/web`. Implementation must not deviate without updating this
file. Grounded in one test, not a mood board: a 15-year-old on a phone, or their parent, books
a PS5 for tonight without anyone explaining the screen. Not: an ops dashboard, a timing tower,
a data visualisation, or anything that needs a legend.

## Superseded (2026-08-11, round 3) -- do not rebuild

Two rounds died the same way: optimising for information density instead of obviousness.

- Round 1: the all-stations availability matrix (stations x 24 time columns). Read as
  property management software. Staff view at best, out of scope.
- Round 2: station-first browse with night-strips, transport glyphs as status language,
  six chip textures, and a legend to decode them. The venue owner could not tell what the
  screen was doing.

Dead and not coming back in the player flow: the night-strip and its playhead tick, transport
glyphs (play triangle / square / wrench) as status, the six-texture chip system (stripes,
crosshatch, dashed outlines), the state legend, the half-hour chip row, the -30/+30 steppers,
the kind filter, kind badges on cards, party size and email fields, 24-hour time.

The rule that replaced them: **if it needs a legend, it failed.** Words carry every state.
One decision per screen. Color, typography, and the contrast table carry over unchanged.

Round 4 (2026-08-11) kept that structure whole and rebuilt only the visual layer: elevation,
motion, per-kind card art, and a stronger type scale. Nothing about the flow, the words, or
the states changed.

Round 5 (2026-08-12) is the same kind of change again: round 4 read flat and dated, hard 1px
mid-grey outlines on flat fills. Surfaces became gradient planes on hairline edges with
three-layer shadows, radii grew (10px controls, 16px cards), green gained its own ambient
glow, the page got a dot field and two far-off hue washes, and hover added a lift plus one
light sweep. Structure, words, and states are untouched.

## Brand and Voice

- Product: self-serve station booking for a physical gaming lounge (PS5/PS3/PS2/racing sim,
  14:00 to 02:00, half-hour slots in the backend, whole hours in the player flow).
- Audience: a teenager or casual adult on a phone, often standing in the venue, mildly
  impatient, never trained on the UI. Their whole intent: "I want a PS5 tonight at 8, for
  two hours."
- The page's one job: get from that sentence to a confirmation code in under a minute.
- Structure: four screens, one decision each. Which console. What time. How long. Who are
  you. Then the code, big enough to read across a room.
- Words, not symbols. Every state is a plain phrase: "Free now", "Free from 8:30 pm",
  "Full tonight", "Being fixed", "taken". No glyph, texture, or color ever carries meaning
  alone; color only reinforces words.
- Times are 12-hour with am/pm ("8:30 pm"). Money is rupees with the sign, always a total
  the player can pay, never a rate to multiply: "₹300 an hour", "2 hours, ₹600".
- Wordmark (round 7, 2026-09-23): `PlayStop` set as one uppercase word in the display face,
  single weight, no color split. Cobalt is the single accent, carried by the whole word and
  the trailing filled-square mark alike. It is a logo only, not a status language. Superseded:
  the round 3-6 two-colour `PLAY`(cobalt)+`STOP`(ink) split, which read as two words.
- Green means go (free, selected, confirm), red means stop (cancel, expiry). Functional,
  never decorative.
- Voice: short plain sentences, sentence case, active verbs ("Book for ₹600"). Errors are
  direct: "Someone took 9:30 pm while you were looking. Pick another time." Never "Oops".
- Nothing unavailable looks tappable: taken times and full consoles render as plain grey
  text (dashed border or line-through plus the word), never as disabled-looking buttons.

## Color

Tailwind v4 tokens, paste into the global CSS. Light is default, dark via `.dark` on `<html>`
(shadcn convention, `@custom-variant dark (&:is(.dark *));`).

```css
@import "tailwindcss";
@custom-variant dark (&:is(.dark *));

@theme {
  /* base, dark ("night race") */
  --color-pit-950: #101318;   /* page bg */
  --color-pit-900: #181D26;   /* raised surface: cards */
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
  /* console art hues, decorative only -- never a state color (see Imagery) */
  --color-kind-ps5: #38A8E8;  /* ice blue */
  --color-kind-ps2: #2F5FD0;  /* cobalt */
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
| Amber as text | amber-bright/pit-950 **11.15** | hold-amber/paper **4.64** |
| Red as text | red-bright/pit-950 **6.73** | stop-red/paper **5.98** |
| Label on red button | pit-950/red-bright **6.73** | white/stop-red **6.47** |
| Border (non-text) | edge-dark/pit-950 **3.52** | edge-light/paper **4.12** |

## Typography

Three faces by role, self-hosted (fontsource), subset to latin:

- **Display: Saira SemiCondensed** 700 only. Uppercase, `tracking-wide`. Screen titles,
  console names, the wordmark. Nowhere else.
- **Body: IBM Plex Sans** 400/600. Everything conversational: status words, labels, form
  fields, buttons.
- **Utility: IBM Plex Mono** 400/500 with `font-variant-numeric: tabular-nums`. Times,
  prices, the countdown, the confirmation code.

> Font budget, decided 2026-08-09: six files, roughly 120 KB (Saira 600 and Plex Sans 500
> cut). Reinstate only with a measured reason.

Scale (px, mobile-first): 12 (fine print, the word "taken", the step counter), 14 (secondary
lines), 16 (body, inputs, time buttons), 20 (console names on cards and recaps), 32 (screen
titles), 60 (confirmation code). Line-height 1.5 body, 1.1 display. One decorative exception:
the card art word (Saira 700 at 128px, clipped by the band, `aria-hidden`, never read as
text). No other font size outside this list.

## Spacing and Layout

4px base scale: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64. Content max-width 1100px centered on the
console grid; every later screen is a single centered column, max-width 28rem. 16px page
gutter on mobile, 24px from `md`. Every tap target at least 44px tall; time and length
buttons 56 to 64px.

Flow: `/book` pick a console -> pick a start time -> how long -> your details -> `/booking/:id`
code. Each screen after the first has a plain "Back" link. Screens one to
four show a muted fine-print step counter ("Step 2 of 4") above the title; it is the only
eyebrow in the app and it carries real information. `/` redirects into `/book`; there
is no separate landing screen to design.

### 1. Pick a console (`/book`)

Card grid: 1 column under `md`, 2 from `md`, 3 from `lg`, 16px gap. Card content, in full:

1. Art band, 104px tall (see Imagery). Desaturated and dimmed to 45% when the card is not
   bookable, so nothing unavailable looks inviting.
2. Console name (display 20px) with price right-aligned: "₹300 an hour" (number in mono).
3. "Now playing: EA FC 26" or "Nothing playing" (muted 14px). DATA GAP: `nowPlaying` has no
   API field yet; it stays in the design because it is the most human thing on the card.
   If it never ships, the line is dropped; the art band, not the game title, is the card's
   visual anchor (see Imagery).
4. Status in words, 16px semibold: "Free now" (go green) / "Free from 8:30 pm" /
   "Full tonight" / "Being fixed" (both muted).

Bookable cards (free now or free later) are whole-card buttons. Full or broken consoles are
plain dashed-border text blocks, all muted, not tappable. Nothing else is on the card.

### 2. Pick a start time

Header: Back, "Pick a start time", one recap line ("PS5-1, ₹300 an hour"). Then a 3-column
grid of 56px-tall time buttons, "8:00 pm" through the last start that fits an hour before the
booking window closes. Taken times render as grey line-through text with the word "taken"
(or "being fixed") beneath; they are not buttons. Past times are absent. A free half hour that
cannot fit the 1-hour minimum renders as taken. Tapping a time advances.

### 3. How long

Header: Back, "How long?", recap ("PS5-1, starting 8:30 pm"). Three full-width 64px buttons:
"1 hour ₹300", "2 hours ₹600", "3 hours ₹900" (prices per station rate). A length that
runs into someone else's booking renders as grey line-through text with "taken from 9:30 pm".
Tapping a length advances. Selected buttons here and on the time screen fill go green.

### 4. Your details

Recap card in plain sentences, built as the ticket stub (see Imagery), unissued: console
name, then the tear, then "Tonight, 8:30 pm to 10:30 pm", "2 hours, ₹600". Below: Name, then
a two-item segmented control "SMS | Email" (SMS default, aria-label "How should we send your
code?"; the selected item is muted grey with a semibold label, never green, because green
means "go" and a mode is not an advance), then one contact field for the chosen channel:
"Mobile number" (a fixed mono "+91" segment inside the same bordered box, 10 digits, pasted
"+91 98765 43210" is cleaned to digits) or "Email". Both required. Toggling keeps what was
typed for the other channel. Field errors sit under the field with `role="alert"` and clear
on the next keystroke. One full-width green button "Book for ₹600" sends a code and replaces
the form in place (no greyed form left behind) with the code panel: "Code sent to +91
98765 43210 · Change" ("Change" is a muted underline link back to the form), a single
6-digit input (mono 20px, wide tracking, centered, 48px tall), and a green "Verify and
book" button. No auto-submit on the sixth digit: verifying commits the booking. Below it a
muted "Send a new code in 0:24" (mono digits) that becomes the underline link "Send a new
code" at zero. In dev only, a separate notice shows "Mock code, dev only: NNNNNN". The
screen also carries one muted line:
"This spot is yours for the next 4:32" (mono digits, live against `expiresAt`, never a
client-only counter). Under 60 seconds the digits turn red and the line reads "Hurry, this
spot is yours for the next 0:41". At expiry the form disables and the screen says "Your time
ran out and someone may have taken the spot." with two buttons: "Try again" and "Pick
another time". A 410 on confirm lands on the same state. No progress bar, no 48px countdown
panel; the sentence is the countdown.

### 5. Booked (`/booking/:id`)

Centered column: "You're booked", then the same stub issued: the code in mono 60px above the
tear, station and time below it, one recap sentence including what to pay ("Pay ₹600 at the
counter."), and a quiet outline "Cancel this booking" (red text, confirm Dialog).

## Imagery (decided round 4)

CSS-generated console art, zero image assets. Real game artwork is publisher IP a lounge
cannot license for a booking page, and stock console photos read as a store listing. The art
is a band across the top of each console card, built from tokens only:

- A solid kind plate: ps5 `--color-kind-ps5` (ice blue), ps2 `--color-kind-ps2` (cobalt), ps3 and
  sims `--color-steel`. A 135deg gradient lifts the top-left toward chalk and settles into a
  kind-specific shade at the bottom-right: ps5 to cobalt, ps2 to deep cobalt, ps3 to
  `--color-pit-700`, sim to `--color-edge-dark`. A 1px chalk highlight on top and a faint dark
  edge below give it a machined lip. A 3px brand rule closes the bottom (ps2 darkens it so it
  still reads against its own plate). Sims add a checkered-flag strip, top-right, 32px tall,
  fading in from the left (`repeating-conic-gradient`, neutrals only, no new hue). No grain.
- The kind word ("PS5", "PS3", "PS2", "SIM") set enormous in Saira 700 (128px), debossed
  (dark 18% fill, one 1px chalk shadow below), bleeding off the left edge so the first letter
  survives the clip. Pure decoration, `aria-hidden`; the real console name sits in the card
  body below it.
- These hues are decorative only. They are never green, red, or amber, and no state is ever
  expressed by hue. Words still carry every state; the band never needs decoding.
- Unavailable cards render the band desaturated at 45% opacity, shadow-free, with no rule and no sim strip.
- If `nowPlaying` never gets an API field, the "Now playing" line is dropped and the card
  loses nothing structural: the band is the visual anchor, the game title is garnish.

The ticket stub (round 6): a booking is a ticket carried to the counter, so screens 4 and 5
are built as that object (`.stub` in `index.css`), not a plain recap card. Two semicircular
notches are cut into its left and right edges at the height of a dashed perforation, dividing
it into two zones the way a torn stub would be. Screen 4 (recap) is the object unissued: no
cap rule. Screen 5 (confirmation) is the same object issued: a cobalt `--color-brand`
(`--color-brand-bright` in dark) rule caps the top edge, and, motion permitting, the code
stamps in (scale 1.06 to 1, 220ms) while the cap rule draws left to right (300ms) -- the one
orchestrated moment on screen 5, same reduced-motion gate as everything else.

Theme: the header carries a sun/moon toggle next to the wordmark, cycling light and dark
(`next-themes`, `attribute="class"`, default follows the system preference). Before round 6
`.dark` was applied nowhere outside the dev-only `/__mockups` route.

## Radius, Elevation, Motion (rebuilt round 5)

- Radius: 10px controls (buttons, inputs, time cells), 16px cards (`--radius-card`).
  Nothing else.
- Surfaces are planes, not boxes. A card is `--surface-gradient` (a barely-there vertical
  gradient) on a hairline `--edge-soft` edge, with `--shadow-card` under it. The functional
  `--border` token stays as-is and is still what inputs and real dividers use; a card's
  outline is decoration and does not need 3:1.
- Elevation, two levels plus flat, per theme via tokens. Each is three stacked shadows so
  the falloff reads soft instead of stamped:
  - `--shadow-card`: resting cards and bookable buttons. Light: ink at 4-10% alpha. Dark:
    near-black ambient plus a 1px inset chalk top highlight, because shadows barely read on
    pit-950; the highlight does the lifting.
  - `--shadow-lift`: hover and the confirmation code box. Same recipe, longer throw.
  - `--shadow-go` / `--shadow-go-lift`: green things (selected cells, the book button) cast
    a green ambient, so go glows. Green is still functional-only; the glow follows the
    green, it never appears on its own.
  - Unavailable things stay flat: no shadow on dashed placeholders. Depth means tappable.
- Page background: a top glow, two far-off washes in the decorative console hues, and a
  26px dot field. Decorative depth only; carries no meaning.
- Motion budget, all inside `@media (prefers-reduced-motion: no-preference)` so the reduced
  path is simply the finished state, never a broken one:
  - Screen entrance: content rises 14px from 98.5% and fades in over 450ms on an ease-out
    curve, grid children staggered 35ms apart, delay capped at the ninth child. One
    orchestrated moment per screen; nothing loops.
  - Hover on a bookable thing: lifts 3px to `--shadow-lift`, plus one diagonal light sweep
    across the card over 750ms. Pointer only, garnish only.
  - Press: any bookable button compresses 1px and 99% scale for 120ms.
  - Selection beat: tapping a time or length fills it green, pops to 104% for 200ms, and
    the flow advances 180ms later. With reduced motion the advance is immediate (checked
    via `matchMedia`) and selection stays obvious: the green fill is color, not motion.
  - The countdown digit color change, and shadcn defaults for Dialog/Drawer. Nothing else
    moves.

## Components

shadcn/ui mapping, themed, never restyled beyond tokens:

| UI | shadcn | Notes |
|---|---|---|
| Book / confirm CTA | `Button` default (go green) | full-width on mobile |
| Cancel booking | `Button` outline, red text + `Dialog` confirm | |
| Player form | `Input` + `Label` | inline errors below fields, red text |
| Closed / degraded notice | `Alert` | plain words: "Bookings are closed today." / "Live updates are down. A console shown free may already be taken." |
| Taken-while-booking (409/410) | `Sonner` toast + refetch | names the time: "Someone took 9:30 pm while you were looking. Pick another time." |
| Loading | `Skeleton` in card / button geometry | route waits: after 200ms the STOP-square `LoadingScreen`, held 500ms minimum; a 3px brand bar fixed at the top shows on any pending navigation (static under reduced motion) |
| Confirmation code | custom bordered block | mono 60px |

Console cards, time buttons, and length buttons are custom elements (buttons when bookable,
plain text when not), not shadcn components. Focus ring: 2px go-green outline, 2px offset,
visible on every focusable element, both themes.

## Do NOT

- Do not add any element that needs explaining: no legends, no glyph languages, no textures,
  no strips, no data visualisation of the night. If a state cannot be said in one plain
  phrase, the state model is wrong, not the words.
- Do not put more than one decision on a screen.
- Do not render anything unavailable as a tappable-looking control.
- Do not show rates the player must multiply; show payable totals.
- Do not use 24-hour time anywhere player-facing.
- Do not compute slot adjacency with `startsAt + n * gridMinutes`; array order is the truth
  (DST nights break the arithmetic). Do not filter cells on `localLabel` dates.
- Do not run the countdown off `setInterval` drift; derive remaining from `expiresAt`.
- Do not use green or red decoratively. Green: free-now words, selection, focus ring, the
  book button. Red: cancel, errors, final countdown, expiry.
- Do not show a client-computed price as final; label it "estimated" until the hold's
  `quoteMinor` arrives; confirm response `totalMinor` is authoritative.
- Do not use pixel fonts, neon glows, purple/indigo gradients, glassmorphism, emoji as
  icons, `rounded-2xl` + `shadow-lg` cards, or Inter.
- Do not shrink tap targets below 44px or status text below 12px to fit more on screen.
  Fewer columns, never smaller type.