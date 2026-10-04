import { useState, type ReactNode } from "react";
import { createRoute, Outlet, useChildMatches, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { STATION_KINDS, type StationKind } from "@playstop/types";
import type { AvailabilityCell, StationSummary } from "@playstop/engine";
import { rootRoute } from "./root.js";
import { queryClient, venueOptions, availabilityOptions } from "../lib/query-client.js";
import { ApiRequestError, errorPresentation } from "../lib/api.js";
import { businessDateStrip, currentBusinessDate, type BusinessDateChip } from "../lib/business-date.js";
import { ownHoldOf, readAttempt, readSelectedDate, writeSelectedDate } from "../lib/attempt.js";
import {
  groupStationsByKind,
  hourlyRateRupees,
  kindGroupStatus,
  pickStationForKind,
  type KindStatus,
} from "../lib/stations.js";
import { Notice, SkeletonBox, LoadingScreen, FOCUS_RING, riseDelay, StepHeading } from "../components/screen-ui.js";

const ART_WORD: Record<StationKind, string> = {
  [STATION_KINDS.PS5]: "PS5",
  [STATION_KINDS.PS3]: "PS3",
  [STATION_KINDS.PS2]: "PS2",
  [STATION_KINDS.RACING_SIM]: "SIM",
};

const KIND_LABEL: Record<StationKind, string> = {
  [STATION_KINDS.PS5]: "PS5",
  [STATION_KINDS.PS3]: "PS3",
  [STATION_KINDS.PS2]: "PS2",
  [STATION_KINDS.RACING_SIM]: "Sim Rig",
};

function ConsoleArt({ kind, dimmed }: { kind: StationKind; dimmed?: boolean }) {
  return (
    <div aria-hidden className={`art-band art-${kind}${dimmed ? " art-dimmed" : ""}`}>
      <span className="art-word font-display">{ART_WORD[kind]}</span>
    </div>
  );
}

function StatusLine({ status }: { status: KindStatus }) {
  return (
    <p
      className={
        status.kind === "free_now"
          ? "text-go dark:text-go-bright text-base font-semibold"
          : "text-base font-semibold"
      }
    >
      {status.kind === "free_now" ? `${status.count} free now` : null}
      {status.kind === "free_from" ? `Free from ${status.timeLabel}` : null}
      {status.kind === "booked_out" ? "Full tonight" : null}
      {status.kind === "maintenance" ? "Being fixed" : null}
    </p>
  );
}

function ConsoleCard({
  kind,
  stations,
  cells,
  status,
  index,
  onPick,
}: {
  kind: StationKind;
  stations: StationSummary[];
  cells: readonly AvailabilityCell[];
  status: KindStatus;
  index: number;
  onPick: (station: StationSummary) => void;
}) {
  const representative = stations[0];
  if (!representative) return null;
  const bookable = status.kind === "free_now" || status.kind === "free_from";
  const body = (
    <div className="flex flex-col gap-1.5 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-display text-xl uppercase tracking-wide">{KIND_LABEL[kind]}</span>
        <span className="text-sm">
          <span className="font-mono font-medium">₹{hourlyRateRupees(representative)}</span> an hour
        </span>
      </div>
      <StatusLine status={status} />
    </div>
  );
  return bookable ? (
    <button
      type="button"
      onClick={() => {
        const target = pickStationForKind(stations, cells);
        if (target) onPick(target);
      }}
      style={riseDelay(index)}
      className={`anim-rise pressable surface sheen lift relative flex flex-col overflow-hidden text-left ${FOCUS_RING}`}
    >
      <ConsoleArt kind={kind} />
      {body}
    </button>
  ) : (
    <div
      style={riseDelay(index)}
      className="anim-rise ghost text-muted-foreground flex flex-col overflow-hidden [&_p]:text-muted-foreground [&_span]:text-muted-foreground"
    >
      <ConsoleArt kind={kind} dimmed />
      {body}
    </div>
  );
}

function PageShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-[1100px] flex-col gap-6 px-4 py-8 md:px-6">
      <StepHeading step="Step 1 of 4" title="Pick a console" />
      {children}
    </main>
  );
}

function DateStrip({
  chips,
  selected,
  onSelect,
}: {
  chips: BusinessDateChip[];
  selected: string;
  onSelect: (date: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Pick a date"
      className="anim-rise -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0"
    >
      {chips.map((chip) => {
        const isSelected = chip.date === selected;
        return (
          <button
            key={chip.date}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelect(chip.date)}
            className={
              isSelected
                ? `pressable tile-on h-11 shrink-0 rounded-(--radius) px-4 text-sm font-semibold ${FOCUS_RING}`
                : `pressable tile lift h-11 shrink-0 rounded-(--radius) px-4 text-sm ${FOCUS_RING}`
            }
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}

function ErrorNotice({ error }: { error: unknown }) {
  const message =
    error instanceof ApiRequestError ? errorPresentation[error.code].detail : "Something went wrong. Please try again.";
  return <Notice tone="destructive">{message}</Notice>;
}

function SkeletonGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 4 }, (_, index) => (
        <SkeletonBox key={index} className="h-56 rounded-(--radius-card)" />
      ))}
    </div>
  );
}

function BookPage() {
  const childMatches = useChildMatches();
  const navigate = useNavigate();
  const venueQuery = useQuery(venueOptions());
  const venue = venueQuery.data;

  const [selectedDate, setSelectedDate] = useState<string | undefined>(() => readSelectedDate() ?? undefined);
  const date = venue ? (selectedDate ?? currentBusinessDate(venue, new Date())) : undefined;
  const chips = venue ? businessDateStrip(venue, new Date()) : [];

  function handleSelectDate(nextDate: string) {
    setSelectedDate(nextDate);
    writeSelectedDate(nextDate);
  }

  const availabilityQuery = useQuery({
    ...availabilityOptions(date ?? "", undefined, false, ownHoldOf(readAttempt())),
    enabled: date !== undefined,
  });

  if (childMatches.length > 0) return <Outlet />;

  if (venueQuery.isError) {
    return (
      <PageShell>
        <ErrorNotice error={venueQuery.error} />
      </PageShell>
    );
  }

  if (!venue) {
    return (
      <PageShell>
        <SkeletonGrid />
      </PageShell>
    );
  }

  if (availabilityQuery.isPending) {
    return (
      <PageShell>
        <DateStrip chips={chips} selected={date ?? ""} onSelect={handleSelectDate} />
        <SkeletonGrid />
      </PageShell>
    );
  }

  if (availabilityQuery.isError) {
    return (
      <PageShell>
        <DateStrip chips={chips} selected={date ?? ""} onSelect={handleSelectDate} />
        <ErrorNotice error={availabilityQuery.error} />
      </PageShell>
    );
  }

  const availability = availabilityQuery.data;
  if (!availability) return <PageShell><LoadingScreen /></PageShell>;

  return (
    <PageShell>
      <DateStrip chips={chips} selected={date ?? ""} onSelect={handleSelectDate} />
      {availability.closed ? <Notice>Bookings are closed that day.</Notice> : null}
      {availability.degraded ? (
        <Notice>Live updates are down. A console shown free may already be taken.</Notice>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {groupStationsByKind(venue.stations).map((group, index) => (
          <ConsoleCard
            key={group.kind}
            kind={group.kind}
            stations={group.stations}
            cells={availability.cells}
            status={kindGroupStatus(group.stations, availability.cells)}
            index={index}
            onPick={(picked) => navigate({ to: "/book/$stationId", params: { stationId: picked.id } })}
          />
        ))}
      </div>
    </PageShell>
  );
}

export const bookRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/book",
  loader: async () => {
    const venue = await queryClient.ensureQueryData(venueOptions()).catch(() => undefined);
    if (!venue) return;
    const date = readSelectedDate() ?? currentBusinessDate(venue, new Date());
    await queryClient.ensureQueryData(availabilityOptions(date, undefined, false)).catch(() => undefined);
  },
  component: BookPage,
});
