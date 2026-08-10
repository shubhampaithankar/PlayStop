// The root route: header/wordmark, the outlet the four screens render into,
// the toast host, and the fallbacks for a render error or an unmatched URL
// (milestone-3-spec.md section 14 step 4).
//
// Relative imports with explicit .js extensions here rather than the "@/..."
// Vite alias: apps/web/tests/router.test.ts imports router.tsx (and
// therefore this file) under plain `node --test`, which has no alias
// resolution. Everything this file needs (sonner, lucide-react) is a real
// package, so the relative form costs nothing and stays dual-environment.
import * as React from "react";
import { createRootRoute, Outlet, type ErrorComponentProps } from "@tanstack/react-router";
import { Play, Square } from "lucide-react";
import { Toaster } from "../components/ui/sonner.js";

// import.meta.env is a Vite-only global (see lib/api.ts's envVar for the
// same guard) -- undefined under node --test, never true there, so
// devtools stay out of the test run without special-casing it.
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
    <span className="font-display flex items-center gap-0.5 text-lg uppercase tracking-wide">
      <span className="text-primary">PLAY</span>
      <Play aria-hidden="true" className="text-primary size-4" fill="currentColor" />
      {/* DESIGN.md: STOP's square is never the accent -- it stays ink. */}
      <span className="text-foreground">STOP</span>
      <Square aria-hidden="true" className="text-foreground size-4" fill="currentColor" />
    </span>
  );
}

function RootComponent() {
  return (
    <>
      <header className="border-border flex h-14 items-center border-b px-4 md:px-6">
        <Wordmark />
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
  component: RootComponent,
  errorComponent: RootErrorComponent,
  notFoundComponent: NotFoundComponent,
});
