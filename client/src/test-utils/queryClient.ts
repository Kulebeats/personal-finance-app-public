import {
  QueryClient,
  type DefaultOptions,
  type QueryClientConfig,
} from "@tanstack/react-query";

const silentLogger = {
  log: () => {},
  warn: () => {},
  error: () => {},
};

const defaultOptions: DefaultOptions = {
  queries: {
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  },
  mutations: {
    retry: false,
    gcTime: 0,
  },
};

export function createTestQueryClient(
  config: QueryClientConfig = {}
): QueryClient {
  const overrides = config.defaultOptions ?? {};

  return new QueryClient({
    ...config,
    defaultOptions: {
      queries: { ...defaultOptions.queries, ...overrides.queries },
      mutations: { ...defaultOptions.mutations, ...overrides.mutations },
    },
  });
}
