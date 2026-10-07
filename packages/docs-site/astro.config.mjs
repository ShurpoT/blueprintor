import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { satteri } from "@astrojs/markdown-satteri";
import { baseLinks } from "./plugins/base-links.mjs";
import react from "@astrojs/react";

const base = "/blueprintor";

export default defineConfig({
    site: "https://shurpot.github.io",
    base,
    markdown: { processor: satteri({ mdastPlugins: [baseLinks({ base })] }) },

    server: {
        open: true,
    },

    devToolbar: {
        enabled: false,
    },

    integrations: [
        starlight({
            title: "Blueprintor",
            social: [{ icon: "github", label: "GitHub", href: "https://github.com/ShurpoT/blueprintor" }],

            sidebar: [
                {
                    label: "Getting started",
                    items: ["introduction", "installation"],
                },
                {
                    label: "API",
                    items: [{ autogenerate: { directory: "api" } }],
                },
                {
                    label: "Configuration",
                    items: [{ autogenerate: { directory: "configuration" } }],
                },
                {
                    label: "Examples",
                    items: [{ autogenerate: { directory: "examples" } }],
                },
            ],
        }),

        react(),
    ],
});
