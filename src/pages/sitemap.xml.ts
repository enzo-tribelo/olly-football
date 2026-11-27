import type { APIRoute } from 'astro';
import { getEntry } from 'astro:content';

export const prerender = true;

export const GET: APIRoute = async () => {
  const gpsEntry = await getEntry('gps', 'gps');
  const gpsDates = gpsEntry.data.sessions
    .filter((s: any) => s.has_data)
    .map((s: any) => s.date);

  const pages = [
    { loc: '/', changefreq: 'weekly', priority: '1.0', alternates: true },
    { loc: '/it/', changefreq: 'weekly', priority: '1.0', alternates: true },
    { loc: '/footage/', changefreq: 'monthly', priority: '0.7', alternates: false },
    { loc: '/gps/', changefreq: 'weekly', priority: '0.8', alternates: false },
    ...gpsDates.map((date: string) => ({
      loc: `/gps/${date}/`,
      changefreq: 'monthly',
      priority: '0.6',
      alternates: false,
    })),
  ];

  const alternates = `    <xhtml:link rel="alternate" hreflang="en" href="https://or9.uk/"/>
    <xhtml:link rel="alternate" hreflang="it" href="https://or9.uk/it/"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://or9.uk/"/>`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${pages.map(p => `  <url>
    <loc>https://or9.uk${p.loc}</loc>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
${p.alternates ? `${alternates}\n` : ''}  </url>`).join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml' },
  });
};
