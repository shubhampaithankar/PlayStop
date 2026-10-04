import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { Dialog as DialogPrimitive, ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import { ArrowLeft, Square } from "lucide-react";
import type { OtpChannel } from "@playstop/engine";

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

export const FOCUS_RING =
  "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-transparent";

export const UNDERLINE_LINK = `flex min-h-11 items-center text-sm underline underline-offset-4 transition-colors ${FOCUS_RING}`;

export const BACK_LINK = `text-foreground hover:text-brand dark:hover:text-brand-bright gap-1.5 font-medium ${UNDERLINE_LINK}`;

export function LoadingScreen() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="text-brand dark:text-brand-bright flex min-h-[50vh] w-full items-center justify-center"
    >
      <Square aria-hidden="true" className="size-8 motion-safe:animate-pulse" fill="currentColor" />
    </div>
  );
}

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
          className={`-m-2.5 self-start p-2.5 ${BACK_LINK}`}
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Back
        </button>
      ) : null}
      <p className="text-brand dark:text-brand-bright text-xs font-semibold tracking-widest uppercase">{step}</p>
      <h2 className="font-display text-[2rem] leading-[1.1] uppercase tracking-wide">{title}</h2>
    </div>
  );
}

export function advanceAfterBeat(advance: () => void): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    advance();
    return;
  }
  window.setTimeout(advance, 180);
}

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
              className={`border-border bg-background hover:bg-muted flex h-11 items-center justify-center rounded-lg border px-3 text-sm ${FOCUS_RING}`}
            >
              Never mind
            </DialogPrimitive.Close>
            <button
              type="button"
              disabled={confirming}
              onClick={onConfirm}
              className={`bg-destructive/10 text-destructive hover:bg-destructive/20 flex h-11 items-center justify-center rounded-lg px-3 text-sm font-medium disabled:opacity-50 ${FOCUS_RING}`}
            >
              {confirming ? "Cancelling..." : confirmLabel}
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return message ? (
    <p id={id} role="alert" className="text-destructive text-sm">
      {message}
    </p>
  ) : null;
}

export function PhoneField({
  id,
  label,
  value,
  onValueChange,
  disabled,
  invalid,
  describedBy,
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  disabled: boolean;
  invalid: boolean;
  describedBy: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="flex items-center gap-2 text-sm leading-none font-medium select-none">
        {label}
      </label>
      <div className="border-input focus-within:border-ring focus-within:ring-ring/50 has-[input[aria-invalid=true]]:border-destructive has-[input[aria-invalid=true]]:ring-destructive/20 flex h-11 w-full items-center rounded-lg border bg-transparent transition-colors focus-within:ring-3 has-[input[aria-invalid=true]]:ring-3 has-[input:disabled]:opacity-50">
        <span aria-hidden="true" className="border-input text-muted-foreground flex h-full items-center border-r px-2.5 font-mono text-base">
          +91
        </span>
        <input
          id={id}
          name="contact"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          pattern="[6-9][0-9]{9}"
          placeholder="9876543210"
          required
          disabled={disabled}
          value={value}
          onChange={(event) => onValueChange(event.target.value.replace(/\D/g, "").slice(-10))}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          className="placeholder:text-muted-foreground h-full min-w-0 flex-1 bg-transparent px-2.5 py-1 text-base outline-none disabled:cursor-not-allowed"
        />
      </div>
    </div>
  );
}

export function ChannelToggle({
  value,
  onValueChange,
  disabled,
}: {
  value: OtpChannel;
  onValueChange: (next: OtpChannel) => void;
  disabled: boolean;
}) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next !== "email" && next !== "sms") return;
        onValueChange(next);
      }}
      disabled={disabled}
      aria-label="How should we send your code?"
      className="grid grid-cols-2 gap-2.5"
    >
      {(["sms", "email"] as const).map((option) => (
        <ToggleGroupPrimitive.Item
          key={option}
          value={option}
          className={`border-input hover:bg-muted data-[state=on]:bg-muted data-[state=on]:text-foreground flex h-11 items-center justify-center rounded-(--radius) border bg-transparent text-sm transition-colors data-[state=on]:font-semibold disabled:opacity-50 ${FOCUS_RING}`}
        >
          {option === "sms" ? "SMS" : "Email"}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}
