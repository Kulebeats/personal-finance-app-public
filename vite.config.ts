import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { metaImagesPlugin } from "./vite-plugin-meta-images";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    metaImagesPlugin(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer()
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner()
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  css: {
    postcss: {
      plugins: [],
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    modulePreload: {
      resolveDependencies(filename, deps, context) {
        if (context.hostType !== "html") return deps;

        // Chart vendors are behind lazy route/widget boundaries. Avoid making
        // the browser fetch them as startup preloads; the owning route imports
        // them on demand.
        return deps.filter((dep) => !dep.includes("recharts-vendor"));
      },
    },
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          // recharts is the dominant charting cost and is shared across many
          // lazy-loaded pages (Reports, Dashboard, CashFlow, Investments,
          // Goals, Accounts). Keep it in its own chunk so it is fetched once
          // and cached, instead of being merged with the rarely-used nivo
          // Sankey bundle.
          "recharts-vendor": ["recharts"],
          // nivo Sankey is only used by the cash-flow Sankey view; isolate it
          // so it is fetched on demand and never pulled in by recharts-only
          // pages. (@nivo/bar, /line, /pie are not imported by production
          // code, so they are intentionally omitted here.)
          "nivo-sankey": ["@nivo/sankey"],
          dnd: ["@dnd-kit/core", "@dnd-kit/sortable", "@dnd-kit/utilities"],
          radix: [
            "@radix-ui/react-dialog",
            "@radix-ui/react-toast",
            "@radix-ui/react-select",
            "@radix-ui/react-navigation-menu",
            "@radix-ui/react-dropdown-menu",
          ],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    hmr: {
      overlay: false,
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
