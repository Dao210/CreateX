import "./styles.css";

import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StandaloneNavigation } from "./navigation";
import { SiegeWorkshop, createWebSiegePlatform } from "@auro/views/siege";

// Standalone shell for `make up C=siege`. The game itself lives in
// @auro/views/siege so web and desktop mount the same implementation.
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } },
});
const root = document.getElementById("root");
if (!root) throw new Error("Missing game root");
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <StandaloneNavigation>
        <SiegeWorkshop platform={createWebSiegePlatform()} campaignHref="/siege/play/" />
      </StandaloneNavigation>
    </QueryClientProvider>
  </React.StrictMode>,
);
