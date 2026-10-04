import { QueryClient, queryOptions } from "@tanstack/react-query";
import type { StationKind } from "@playstop/types";
import { ApiRequestError, getAvailability, getBooking, getVenue } from "./api.js";
import { freeOwnHeldCells, type OwnHold } from "./stations.js";

const AVAILABILITY_PREFIX = ["availability"] as const;

export const keys = {
  venue: () => ["venue"] as const,
  availability: (date: string, kind?: StationKind) => [...AVAILABILITY_PREFIX, date, kind ?? "all"] as const,
  booking: (id: string) => ["booking", id] as const,
};

export const venueOptions = () =>
  queryOptions({
    queryKey: keys.venue(),
    queryFn: getVenue,
    staleTime: Infinity,
  });

export const availabilityOptions = (
  date: string,
  kind: StationKind | undefined,
  holdPanelOpen: boolean,
  ownHold: OwnHold | null = null,
) =>
  queryOptions({
    queryKey: keys.availability(date, kind),
    queryFn: () => getAvailability({ date, kind }),
    select: (data) => ({ ...data, cells: freeOwnHeldCells(data.cells, ownHold) }),
    staleTime: 10_000,
    refetchInterval: (query) => {
      if (holdPanelOpen) return false;
      if (query.state.data?.closed) return false;
      if (query.state.status === "error") return 60_000;
      return 20_000;
    },
    refetchIntervalInBackground: false,
  });

export const bookingOptions = (id: string, code: string) =>
  queryOptions({
    queryKey: keys.booking(id),
    queryFn: () => getBooking(id, code),
    staleTime: 30_000,
  });

export const invalidateAvailability = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: AVAILABILITY_PREFIX });

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      gcTime: 5 * 60_000,
      retry: (failureCount, error) =>
        error instanceof ApiRequestError && error.status < 500 ? false : failureCount < 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
});
