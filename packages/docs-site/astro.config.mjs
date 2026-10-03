import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { satteri } from "@astrojs/markdown-satteri";
import { baseLinks } from "./plugins/base-links.mjs";

const base = "/file-scaffolder";

export default defineConfig({
    site: "https://shurpot.github.io",
    base,
    markdown: { processor: satteri({ mdastPlugins: [baseLinks({ base })] }) },

    server: {
        open: true,
    },

    integrations: [
        starlight({
            title: "📦 File Scaffolder",
            social: [{ icon: "github", label: "GitHub", href: "https://github.com/ShurpoT/file-scaffolder" }],

            sidebar: [
                {
                    label: "Getting started",
                    items: ["introduction", "installation"],
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
    ],
});
