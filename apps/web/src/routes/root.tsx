import * as React from "react";
import { createRootRoute, Link, Outlet, useRouterState, type ErrorComponentProps } from "@tanstack/react-router";
import { Square, Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster } from "../components/ui/sonner.js";
import { FOCUS_RING } from "../components/screen-ui.js";
import { queryClient, venueOptions } from "../lib/query-client.js";

const TanStackRouterDevtools = import.meta.env?.DEV
  ? React.lazy(() =>
      import("@tanstack/react-router-devtools").then((mod) => ({ default: mod.TanStackRouterDevtools })),
    )
  : () => null;

const ReactQueryDevtools = import.meta.env?.DEV
  ? React.lazy(() =>
      import("@tanstack/react-query-devtools").then((mod) => ({ default: mod.ReactQueryDevtools })),
    )
  : () => null;

function Wordmark() {
  return (
    <Link
      to="/"
      aria-label="PlayStop, home"
      className={`font-display text-brand dark:text-brand-bright hover:text-brand/80 dark:hover:text-brand-bright/80 flex min-h-11 cursor-pointer items-center gap-1 rounded-(--radius) text-lg uppercase tracking-wide transition-colors ${FOCUS_RING}`}
    >
      PlayStop
      <Square aria-hidden="true" className="size-4" fill="currentColor" />
    </Link>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className={`text-muted-foreground hover:bg-muted hover:text-foreground flex size-11 items-center justify-center rounded-(--radius) transition-colors ${FOCUS_RING}`}
    >
      {isDark ? <Sun aria-hidden="true" className="size-4.5" /> : <Moon aria-hidden="true" className="size-4.5" />}
    </button>
  );
}

function RouteProgressBar() {
  const isPending = useRouterState({ select: (state) => state.status === "pending" });
  if (!isPending) return null;
  return (
    <div aria-hidden="true" className="route-progress bg-brand/20 dark:bg-brand-bright/20">
      <div className="route-progress-bar bg-brand dark:bg-brand-bright" />
    </div>
  );
}

function RootComponent() {
  return (
    <>
      <RouteProgressBar />
      <header className="border-border flex h-14 items-center border-b px-4 md:px-6">
        <Wordmark />
        <Link
          to="/bookings"
          className={`text-muted-foreground hover:text-foreground ml-auto flex h-11 items-center rounded-(--radius) px-3 text-sm transition-colors ${FOCUS_RING}`}
        >
          Your bookings
        </Link>
        <ThemeToggle />
      </header>
      <Outlet />
      <Toaster />
      {import.meta.env?.DEV ? (
        <React.Suspense fallback={null}>
          <TanStackRouterDevtools position="bottom-right" />
          <ReactQueryDevtools buttonPosition="bottom-left" />
        </React.Suspense>
      ) : null}
    </>
  );
}

function RootErrorComponent({ error }: ErrorComponentProps) {
  console.error("Root route error boundary:", error);
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="font-display text-2xl uppercase tracking-wide">Something broke</h1>
      <p className="text-muted-foreground max-w-sm text-sm">Reloading usually fixes it.</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="border-border bg-primary text-primary-foreground rounded-md border px-4 py-2 text-sm font-medium"
      >
        Reload
      </button>
    </main>
  );
}

function NotFoundComponent() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-2 px-4 text-center">
      <h1 className="font-display text-2xl uppercase tracking-wide">Page not found</h1>
      <p className="text-muted-foreground max-w-sm text-sm">That page does not exist.</p>
    </main>
  );
}

export const rootRoute = createRootRoute({
  loader: () => queryClient.ensureQueryData(venueOptions()).catch(() => undefined),
  component: RootComponent,
  errorComponent: RootErrorComponent,
  notFoundComponent: NotFoundComponent,
});
