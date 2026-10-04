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
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}