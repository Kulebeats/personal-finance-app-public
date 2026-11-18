import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";

export const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

export const TestWrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={createTestQueryClient()}>
    <Router>{children}</Router>
  </QueryClientProvider>
);
