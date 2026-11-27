import type { APIRoute } from 'astro';
import { getEntry } from 'astro:content';

export const prerender = true;

export const GET: APIRoute = async () => {
  const gpsEntry = await getEntry('gps', 'gps');
  const gpsDates = gpsEntry.data.sessions
    .filter((s: any) => s.has_data)
    .map((s: any) => s.date);

  const homeAlt = { en: 'https://or9.uk/', it: 'https://or9.uk/it/' };
  const footageAlt = { en: 'https://or9.uk/footage/', it: 'https://or9.uk/it/footage/' };

  const pages: Array<{
    loc: string;
    changefreq: string;
    priority: string;
    alternates?: { en: string; it: string };
  }> = [
    { loc: '/', changefreq: 'weekly', priority: '1.0', alternates: homeAlt },
    { loc: '/it/', changefreq: 'weekly', priority: '1.0', alternates: homeAlt },
    { loc: '/footage/', changefreq: 'monthly', priority: '0.7', alternates: footageAlt },
    { loc: '/it/footage/', changefreq: 'monthly', priority: '0.7', alternates: footageAlt },
    { loc: '/gps/', changefreq: 'weekly', priority: '0.8' },
    ...gpsDates.map((date: string) => ({
      loc: `/gps/${date}/`,
      changefreq: 'monthly',
      priority: '0.6',
    })),
  ];

  const alternateLinks = (alt: { en: string; it: string }) => `    <xhtml:link rel="alternate" hreflang="en" href="${alt.en}"/>
    <xhtml:link rel="alternate" hreflang="it" href="${alt.it}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${alt.en}"/>`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${pages.map(p => `  <url>
    <loc>https://or9.uk${p.loc}</loc>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
${p.alternates ? `${alternateLinks(p.alternates)}\n` : ''}  </url>`).join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml' },
  });
};
