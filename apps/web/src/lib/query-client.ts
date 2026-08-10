// Query keys, queryOptions builders, and the configured QueryClient
// (milestone 3 spec, section 4). Keys are built here and nowhere else, so
// invalidation can never drift from the shape a query was cached under.
import { QueryClient, queryOptions } from "@tanstack/react-query";
import type { StationKind } from "@playstop/types";
import { ApiRequestError, getAvailability, getBooking, getVenue } from "./api.js";

// Exported so invalidateAvailability and keys.availability build off the
// exact same array -- see the "Invalidation, exactly" note below.
const AVAILABILITY_PREFIX = ["availability"] as const;

export const keys = {
  // No venue slug in the key: one venue per deployment, from an env var, not
  // state. A venue switcher would make the slug the key's second element,
  // and this factory is the only file that would need to change.
  venue: () => ["venue"] as const,
  availability: (date: string, kind?: StationKind) => [...AVAILABILITY_PREFIX, date, kind ?? "all"] as const,
  // The confirmation code is a credential, not a cache address: it never
  // appears in a key (it would then show up in devtools, cache dumps, and
  // any log line that prints a key). Pass it to the query function as a
  // closure argument instead -- see bookingOptions below.
  booking: (id: string) => ["booking", id] as const,
};

// Opening hours and the station list do not change during a session.
// Fetched once by the root route loader so every screen can assume it.
export const venueOptions = () =>
  queryOptions({
    queryKey: keys.venue(),
    queryFn: getVenue,
    staleTime: Infinity,
  });

/**
 * `holdPanelOpen` pauses polling while the hold panel covers the grid: the
 * user has a hold, nobody is looking at 360 repainted cells, and the
 * panel's own close path invalidates on the way out anyway. The 20s/60s
 * split and the reasoning behind both live in milestone-3-spec.md section 4.
 */
export const availabilityOptions = (date: string, kind: StationKind | undefined, holdPanelOpen: boolean) =>
  queryOptions({
    queryKey: keys.availability(date, kind),
    queryFn: () => getAvailability({ date, kind }),
    staleTime: 10_000,
    refetchInterval: (query) => {
      if (holdPanelOpen) return false;
      if (query.state.data?.closed) return false;
      if (query.state.status === "error") return 60_000;
      return 20_000;
    },
    refetchIntervalInBackground: false,
  });

// Seeded by setQueryData from the confirm response, so /booking/:id renders
// without a network round trip on the happy path.
export const bookingOptions = (id: string, code: string) =>
  queryOptions({
    queryKey: keys.booking(id),
    queryFn: () => getBooking(id, code),
    staleTime: 30_000,
  });

/**
 * Every mutation's onSettled calls this (not onSuccess: a 409 changes the
 * world too, and is exactly when the user most needs fresh cells). The
 * prefix form, deliberately: a hold or booking that crosses midnight
 * affects two business dates, and a kind filter caches the same night
 * under several keys. Invalidating the prefix catches all of them without
 * hand-listing dates or filters.
 */
export const invalidateAvailability = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: AVAILABILITY_PREFIX });

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      gcTime: 5 * 60_000,
      // A 4xx is a decision: retrying it wastes a request and delays the
      // error UI. A 5xx or a NetworkError is worth three tries, because a
      // cold-starting Render instance answers 502 before it answers 200.
      retry: (failureCount, error) =>
        error instanceof ApiRequestError && error.status < 500 ? false : failureCount < 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      refetchOnWindowFocus: true,
    },
    // Every mutation here is a hold, a confirm, or a cancel. An automatic
    // retry of a confirm is precisely what the idempotency key exists to
    // make safe, and precisely the thing a human must choose to do anyway.
    mutations: { retry: false },
  },
});
