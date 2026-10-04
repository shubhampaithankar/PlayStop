import { useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  cellStateAt,
  FAR_INDEX,
  freeSlotsFrom,
  hourlyRateRupees,
  maxHoursFrom,
  NOW_INDEX,
  STATIONS,
  stationStatus,
  timeLabel12,
  type MockStation,
  type StationKind,
} from "./fake-data";

export type FlowStep = "console" | "time" | "length" | "confirm" | "booked";

const DEFAULT_STATION = STATIONS[4] ?? STATIONS[0]!;
const DEFAULT_START = NOW_INDEX + 1;
const DEFAULT_HOURS = 2;

const rupees = (amount: number) => `₹${amount}`;

const FOCUS_RING =
  "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-transparent";

const riseDelay = (index: number): CSSProperties =>
  ({ "--rise-delay": `${Math.min(index, 8) * 35}ms` }) as CSSProperties;

function advanceAfterBeat(advance: () => void) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    advance();
    return;
  }
  window.setTimeout(advance, 180);
}

function StepHeading({
  step,
  title,
  onBack,
}: {
  step?: string | undefined;
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
      {step ? (
        <p className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
          {step}
        </p>
      ) : null}
      <h2 className="font-display text-[2rem] leading-[1.1] uppercase tracking-wide">{title}</h2>
    </div>
  );
}

function ConsoleArt({ kind, dimmed }: { kind: StationKind; dimmed?: boolean }) {
  return (
    <div aria-hidden className={`art-band art-${kind}${dimmed ? " art-dimmed" : ""}`}>
      <span className="art-word font-display">{kind.toUpperCase()}</span>
    </div>
  );
}

function PickConsole({ onPick }: { onPick: (station: MockStation) => void }) {
  return (
    <div className="flex flex-col gap-6">
      <StepHeading step="Step 1 of 4" title="Pick a console" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {STATIONS.map((station, index) => {
          const status = stationStatus(station);
          const bookable = status.kind === "free_now" || status.kind === "free_from";
          const body = (
            <div className="flex flex-col gap-1.5 p-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-display text-xl uppercase tracking-wide">{station.name}</span>
                <span className="text-sm">
                  <span className="font-mono font-semibold">{rupees(hourlyRateRupees(station))}</span>{" "}
                  an hour
                </span>
              </div>
              <p className="text-muted-foreground text-sm">
                {station.nowPlaying ? `Now playing: ${station.nowPlaying}` : "Nothing playing"}
              </p>
              <p
                className={
                  status.kind === "free_now"
                    ? "text-go dark:text-go-bright text-base font-semibold"
                    : "text-base font-semibold"
                }
              >
                {status.kind === "free_now" ? "Free now" : null}
                {status.kind === "free_from" ? `Free from ${status.timeLabel}` : null}
                {status.kind === "booked_out" ? "Full tonight" : null}
                {status.kind === "maintenance" ? "Being fixed" : null}
              </p>
            </div>
          );
          return bookable ? (
            <button
              key={station.id}
              type="button"
              onClick={() => onPick(station)}
              style={riseDelay(index)}
              className={`anim-rise pressable surface sheen lift relative flex flex-col overflow-hidden text-left ${FOCUS_RING}`}
            >
              <ConsoleArt kind={station.kind} />
              {body}
            </button>
          ) : (
            <div
              key={station.id}
              style={riseDelay(index)}
              className="anim-rise ghost text-muted-foreground flex flex-col overflow-hidden [&_p]:text-muted-foreground [&_span]:text-muted-foreground"
            >
              <ConsoleArt kind={station.kind} dimmed />
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PickTime({
  station,
  selectedStart,
  onBack,
  onPick,
}: {
  station: MockStation;
  selectedStart: number | null;
  onBack: () => void;
  onPick: (cellIndex: number) => void;
}) {
  const cells = Array.from({ length: FAR_INDEX - NOW_INDEX }, (_, i) => NOW_INDEX + i);
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
      <StepHeading step="Step 2 of 4" title="Pick a start time" onBack={onBack} />
      <p className="anim-rise text-muted-foreground text-sm">
        {station.name},{" "}
        <span className="font-mono font-semibold">{rupees(hourlyRateRupees(station))}</span> an hour
      </p>
      <div className="grid grid-cols-3 gap-2.5">
        {cells.map((cellIndex, index) => {
          const label = timeLabel12(cellIndex);
          const state = cellStateAt(station, cellIndex);
          const pickable = state === "free" && maxHoursFrom(station, cellIndex) >= 1;
          if (pickable) {
            const selected = cellIndex === selectedStart;
            return (
              <button
                key={cellIndex}
                type="button"
                onClick={() => onPick(cellIndex)}
                aria-pressed={selected}
                style={riseDelay(index)}
                className={
                  selected
                    ? `anim-select tile-on h-14 font-mono text-base font-semibold ${FOCUS_RING}`
                    : `anim-rise pressable tile lift h-14 font-mono text-base ${FOCUS_RING}`
                }
              >
                {label}
              </button>
            );
          }
          return (
            <div
              key={cellIndex}
              style={riseDelay(index)}
              className="anim-rise text-muted-foreground flex h-14 flex-col items-center justify-center rounded-(--radius)"
            >
              <span className="font-mono text-base line-through">{label}</span>
              <span className="text-xs">{state === "maintenance" ? "being fixed" : "taken"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PickLength({
  station,
  startIndex,
  selectedHours,
  onBack,
  onPick,
}: {
  station: MockStation;
  startIndex: number;
  selectedHours: number | null;
  onBack: () => void;
  onPick: (hours: number) => void;
}) {
  const fitsUpTo = maxHoursFrom(station, startIndex);
  const takenFromLabel = timeLabel12(startIndex + freeSlotsFrom(station, startIndex));
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
      <StepHeading step="Step 3 of 4" title="How long?" onBack={onBack} />
      <p className="anim-rise text-muted-foreground text-sm">
        {station.name}, starting {timeLabel12(startIndex)}
      </p>
      <div className="flex flex-col gap-2.5">
        {[1, 2, 3].map((hours, index) => {
          const price = hours * hourlyRateRupees(station);
          const hourWord = hours === 1 ? "1 hour" : `${hours} hours`;
          if (hours > fitsUpTo) {
            return (
              <div
                key={hours}
                style={riseDelay(index)}
                className="anim-rise text-muted-foreground flex h-16 items-center justify-between rounded-(--radius) px-4"
              >
                <span className="text-base line-through">{hourWord}</span>
                <span className="text-sm">taken from {takenFromLabel}</span>
              </div>
            );
          }
          const selected = hours === selectedHours;
          return (
            <button
              key={hours}
              type="button"
              onClick={() => onPick(hours)}
              aria-pressed={selected}
              style={riseDelay(index)}
              className={
                selected
                  ? `anim-select tile-on flex h-16 items-center justify-between px-4 text-base font-semibold ${FOCUS_RING}`
                  : `anim-rise pressable tile lift flex h-16 items-center justify-between px-4 text-base ${FOCUS_RING}`
              }
            >
              <span className="font-semibold">{hourWord}</span>
              <span className="font-mono font-semibold">{rupees(price)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ConfirmDetails({
  station,
  startIndex,
  hours,
  onBack,
  onBook,
}: {
  station: MockStation;
  startIndex: number;
  hours: number;
  onBack: () => void;
  onBook: () => void;
}) {
  const total = hours * hourlyRateRupees(station);
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
      <StepHeading step="Step 4 of 4" title="Your details" onBack={onBack} />
      <div style={riseDelay(1)} className="anim-rise surface flex flex-col gap-1 p-5">
        <p className="font-display text-xl uppercase tracking-wide">{station.name}</p>
        <p className="text-base">
          Tonight, {timeLabel12(startIndex)} to {timeLabel12(startIndex + hours * 2)}
        </p>
        <p className="text-base">
          {hours === 1 ? "1 hour" : `${hours} hours`},{" "}
          <span className="font-mono font-semibold">{rupees(total)}</span>
        </p>
      </div>
      <form
        style={riseDelay(2)}
        className="anim-rise flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onBook();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="flow-name">Name</Label>
          <Input id="flow-name" name="name" placeholder="Your name" required defaultValue="Arjun Rao" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="flow-phone">Phone</Label>
          <Input id="flow-phone" name="phone" type="tel" placeholder="98765 43210" required />
        </div>
        <Button
          type="submit"
          size="lg"
          className="pressable btn-go mt-2 h-12 text-base"
        >
          Book for {rupees(total)}
        </Button>
        <p className="text-muted-foreground text-center text-sm">
          This spot is yours for the next <span className="font-mono">4:32</span>
        </p>
      </form>
    </div>
  );
}

function Booked({
  station,
  startIndex,
  hours,
}: {
  station: MockStation;
  startIndex: number;
  hours: number;
}) {
  const total = hours * hourlyRateRupees(station);
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-5 text-center">
      <h2 className="anim-rise font-display text-[2rem] leading-[1.1] uppercase tracking-wide">
        You&apos;re booked
      </h2>
      <div style={riseDelay(1)} className="anim-rise code-box w-full p-7">
        <p className="font-mono text-6xl font-semibold tracking-widest">K7Q4</p>
      </div>
      <p style={riseDelay(2)} className="anim-rise text-base font-semibold">
        Show this code at the counter.
      </p>
      <p style={riseDelay(3)} className="anim-rise text-muted-foreground text-sm">
        {station.name}, tonight {timeLabel12(startIndex)} to {timeLabel12(startIndex + hours * 2)}.
        Pay <span className="font-mono">{rupees(total)}</span> at the counter.
      </p>
      <Button
        variant="outline"
        className="pressable text-stop-red dark:text-stop-red-bright"
        style={riseDelay(4)}
      >
        Cancel this booking
      </Button>
    </div>
  );
}

export function BookingFlowMockup({
  step,
  onStepChange,
}: {
  step: FlowStep;
  onStepChange: (step: FlowStep) => void;
}) {
  const [station, setStation] = useState<MockStation>(DEFAULT_STATION);
  const [startIndex, setStartIndex] = useState<number>(DEFAULT_START);
  const [hours, setHours] = useState<number>(DEFAULT_HOURS);

  switch (step) {
    case "console":
      return (
        <PickConsole
          onPick={(picked) => {
            setStation(picked);
            onStepChange("time");
          }}
        />
      );
    case "time":
      return (
        <PickTime
          station={station}
          selectedStart={startIndex}
          onBack={() => onStepChange("console")}
          onPick={(cellIndex) => {
            setStartIndex(cellIndex);
            advanceAfterBeat(() => onStepChange("length"));
          }}
        />
      );
    case "length":
      return (
        <PickLength
          station={station}
          startIndex={startIndex}
          selectedHours={hours}
          onBack={() => onStepChange("time")}
          onPick={(picked) => {
            setHours(picked);
            advanceAfterBeat(() => onStepChange("confirm"));
          }}
        />
      );
    case "confirm":
      return (
        <ConfirmDetails
          station={station}
          startIndex={startIndex}
          hours={Math.min(hours, Math.max(1, maxHoursFrom(station, startIndex)))}
          onBack={() => onStepChange("length")}
          onBook={() => onStepChange("booked")}
        />
      );
    case "booked":
      return <Booked station={station} startIndex={startIndex} hours={hours} />;
  }
}
