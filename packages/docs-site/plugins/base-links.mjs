// Astro does not add `base` to root-relative links written inside Markdown/MDX
// content (only the sidebar and page routes know about it). On GitHub Pages the
// site lives under /<repo>/, so a link like [x](/installation/) would 404.
// This Sätteri MDAST plugin prepends `base` to such links at build time.
export function baseLinks({ base = "" } = {}) {
  const prefix = base.replace(/\/+$/, "");
  return {
    name: "base-links",
    link(node, ctx) {
      const url = node.url;
      if (
        prefix &&
        typeof url === "string" &&
        url.startsWith("/") &&
        !url.startsWith("//") &&
        url !== prefix &&
        !url.startsWith(prefix + "/")
      ) {
        // `setField` in newer Sätteri releases, `setProperty` in older ones.
        const set = typeof ctx.setField === "function" ? ctx.setField : ctx.setProperty;
        set.call(ctx, node, "url", prefix + url);
      }
    },
  };
}
