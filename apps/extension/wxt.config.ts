import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  // WXT sin dev-server bruker ellers port 3000, som er web-appens port.
  dev: { server: { port: 3100, origin: "http://localhost:3100" } },
  // Byggetidspunktet vises i popupen, så det er lett å se om Chrome har lastet inn siste versjon.
  vite: () => ({ plugins: [tailwindcss()], define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) } }),
  manifest: {
    name: "Masterkey",
    description: "Fyll ut jobbsøknader med ett klikk, med profilen din fra Masterkey.",
    // activeTab + scripting: vi får bare tilgang til en fane når brukeren selv ber om det.
    permissions: ["storage", "activeTab", "scripting"],
    commands: {
      "fill-page": {
        suggested_key: { default: "Alt+Shift+F" },
        description: "Fyll ut søknaden på denne siden",
      },
    },
    action: { default_title: "Masterkey" },
  },
});
