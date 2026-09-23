import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { queryClient } from "@/lib/query-client";
import { router } from "@/router";
import "@/index.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("root element not found");
}

// Dev-only design mockup route, entirely outside the real router: no search
// param validation, no loaders, no API calls. import.meta.env.DEV
// static-replaces to `false` in a production build, so Rollup dead-code
// eliminates this branch (and the dynamic import with it) out of the
// production bundle -- see src/mockups/MockupsApp.tsx to remove it entirely.
const isMockupsRoute = import.meta.env.DEV && window.location.pathname.startsWith("/__mockups");

if (isMockupsRoute) {
  void import("@/mockups/MockupsApp").then(({ MockupsApp }) => {
    createRoot(rootElement).render(
      <StrictMode>
        <MockupsApp />
      </StrictMode>,
    );
  });
} else {
  createRoot(rootElement).render(
    <StrictMode>
      {/* attribute="class" toggles .dark on <html>, DESIGN.md's shadcn convention.
          enableSystem + defaultTheme="system" is what makes .dark reachable at all
          outside mockups/ -- round-6 remainder, previously dead code. */}
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}