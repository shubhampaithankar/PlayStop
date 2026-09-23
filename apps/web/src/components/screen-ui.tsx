// Shared building blocks for the booking screens (DESIGN.md's step counter,
// notice, skeleton, focus ring, entrance stagger). Lifted out of book.tsx
// once book.station.tsx needed the same pieces -- docs/conventions/modules.md:
// a second file genuinely needing it earns a shared module. It sits beside
// components/ui/ rather than in lib/, which that same file scopes to api.ts
// and query-client.ts; this is markup, not a data concern.
//
// Not "@/lib/utils"-importing shadcn output (components/ui/alert.tsx,
// skeleton.tsx): apps/web/tests/router.test.ts imports routes under plain
// `node --test`, which has no Vite alias resolution. Relative .js-extension
// imports for the same reason as routes/root.tsx.
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

// Not the shadcn Alert/Skeleton -- same tokens, same rendered result, just
// inlined so this stays resolvable from a plain `node --test` run. See
// DESIGN.md's Components table for the mapping this stands in for.
export function Notice({ tone = "default", children }: { tone?: "default" | "destructive"; children: ReactNode }) {
  return (
    <div
      role="alert"
      className={`bg-card rounded-lg border px-2.5 py-2 text-sm ${tone === "destructive" ? "text-destructive" : "text-card-foreground"}`}
    >
      {children}
    </div>
  );
}

export function SkeletonBox({ className }: { className: string }) {
  return <div className={`bg-muted animate-pulse rounded-md ${className}`} />;
}

// Tailwind's ring compiles to box-shadow, which forced-colors mode drops. A
// transparent outline survives it: forced colors repaints it as Highlight.
export const FOCUS_RING =
  "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-transparent";

/* Entrance stagger (DESIGN.md motion): child N rises 35ms later, capped at 9. */
export const riseDelay = (index: number): CSSProperties =>
  ({ "--rise-delay": `${Math.min(index, 8) * 35}ms` }) as CSSProperties;

export function StepHeading({
  step,
  title,
  onBack,
}: {
  step: string;
  title: string;
  onBack?: (() => void) | undefined;
}) {
  return (
    <div className="anim-rise flex flex-col gap-2">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground self-start text-sm underline underline-offset-4 transition-colors"
        >
          Back
        </button>
      ) : null}
      <p className="text-brand dark:text-brand-bright text-xs font-semibold tracking-widest uppercase">{step}</p>
      <h2 className="font-display text-[2rem] leading-[1.1] uppercase tracking-wide">{title}</h2>
    </div>
  );
}

/* Selection beat (DESIGN.md motion): let the green fill land before the flow
   advances. Reduced motion skips the wait; the fill itself is a color
   change, not motion. */
export function advanceAfterBeat(advance: () => void): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    advance();
    return;
  }
  window.setTimeout(advance, 180);
}

// Not the shadcn Input/Label (components/ui/input.tsx, label.tsx) -- same
// classes, minus the "@/lib/utils" cn() import, for the same
// plain-`node --test`-resolvable reason as Notice/SkeletonBox above.
export function TextField({
  id,
  label,
  ...props
}: { id: string; label: string } & Omit<ComponentProps<"input">, "id">) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="flex items-center gap-2 text-sm leading-none font-medium select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50"
      >
        {label}
      </label>
      <input
        id={id}
        className="border-input h-11 w-full min-w-0 rounded-lg border bg-transparent px-2.5 py-1 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
        {...props}
      />
    </div>
  );
}

// Not the shadcn Dialog (components/ui/dialog.tsx) -- same Radix primitive
// and rendered result, minus the "@/lib/utils" cn() import.
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  confirming,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  confirming: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content className="fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none sm:max-w-sm">
          <div className="flex flex-col gap-2">
            <DialogPrimitive.Title className="text-base leading-none font-medium">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-muted-foreground text-sm">
              {description}
            </DialogPrimitive.Description>
          </div>
          <div className="-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end">
            <DialogPrimitive.Close
              className={`border-border bg-background hover:bg-muted rounded-lg border px-3 py-1.5 text-sm ${FOCUS_RING}`}
            >
              Never mind
            </DialogPrimitive.Close>
            <button
              type="button"
              disabled={confirming}
              onClick={onConfirm}
              className={`bg-destructive/10 text-destructive hover:bg-destructive/20 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${FOCUS_RING}`}
            >
              {confirming ? "Cancelling..." : confirmLabel}
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
