import { useEffect, useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { BookingFlowMockup, type FlowStep } from "./BookingFlowMockup";

const STEPS: readonly { id: FlowStep; label: string }[] = [
  { id: "console", label: "1 Console" },
  { id: "time", label: "2 Time" },
  { id: "length", label: "3 How long" },
  { id: "confirm", label: "4 Details" },
  { id: "booked", label: "5 Booked" },
];

export function MockupsApp() {
  const [step, setStep] = useState<FlowStep>("console");
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  return (
    <div className="min-h-screen">
      <header className="mb-8 border-b [border-color:var(--edge-soft)]">
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-4 px-4 py-4 md:px-6">
          <div>
            <h1 className="font-display text-2xl uppercase tracking-wide">Design mockups</h1>
            <p className="text-muted-foreground text-sm">
              Dev only, /__mockups. Static data, DESIGN.md tokens. Tapping through works too.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ToggleGroup
              type="single"
              variant="outline"
              value={step}
              onValueChange={(next) => next && setStep(next as FlowStep)}
            >
              {STEPS.map(({ id, label }) => (
                <ToggleGroupItem key={id} value={id}>
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <ToggleGroup
              type="single"
              variant="outline"
              value={isDark ? "dark" : "light"}
              onValueChange={(next) => next && setIsDark(next === "dark")}
            >
              <ToggleGroupItem value="light">Light</ToggleGroupItem>
              <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1100px] px-4 pb-16 md:px-6">
        <BookingFlowMockup step={step} onStepChange={setStep} />
      </main>
    </div>
  );
}
