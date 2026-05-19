import { getCreators, getVideoMetasForCreator } from "@/lib/content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Returns a shortcode → { slug, filename, title } index across the whole vault.
// Used by the chat client to render [[shortcode]] wiki-links as proper
// clickable links to the video page.
export async function GET() {
  const creators = await getCreators();
  const index: Record<
    string,
    { slug: string; filename: string; title: string }
  > = {};

  await Promise.all(
    creators.map(async (c) => {
      const videos = await getVideoMetasForCreator(c.slug);
      for (const v of videos) {
        if (!v.shortcode) continue;
        // first-write wins; shortcodes are globally unique anyway
        if (!index[v.shortcode]) {
          index[v.shortcode] = {
            slug: c.slug,
            filename: v.filename,
            title: v.title,
          };
        }
      }
    })
  );

  return Response.json(
    { shortcodes: index },
    { headers: { "Cache-Control": "no-store" } }
  );
}
