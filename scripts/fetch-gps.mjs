#!/usr/bin/env node
// GPS data fetcher — provider-agnostic orchestration.
// Reads GPS_PROVIDER_TYPE to select the provider adapter.
// All provider-specific logic lives in scripts/providers/{type}.mjs

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

const {
  GPS_PROVIDER_TYPE = 'playerdata',
  GPS_PROVIDER_EMAIL,
  GPS_PROVIDER_PASSWORD,
  XAI_API_KEY,
  GPS_FORCE_TAGLINES = 'false',
} = process.env;

if (!GPS_PROVIDER_EMAIL || !GPS_PROVIDER_PASSWORD) {
  console.log('⚠️ GPS provider credentials not set, skipping GPS fetch');
  process.exit(0);
}

// Dynamic provider load
const provider = await import(`./providers/${GPS_PROVIDER_TYPE}.mjs`);

// ─── Zone Analysis ────────────────────────────────────────────────────────────
// Generic — operates on normalized path data (provider-agnostic coordinate format)

function analyzeZones(periodMetricSets) {
  const sprintPts = [];
  const hiPts = [];
  let avgXNorm = null;
  let maxX = 105;
  let maxY = 68;

  for (const pm of (periodMetricSets || [])) {
    const isSecondHalf = pm.matchSessionPeriod?.name === 'Second Half';
    const pathmaps = pm.pathmaps || [];
    const pMaxX = pathmaps[0]?.pitchLimits?.maxX || 105;
    const pMaxY = pathmaps[0]?.pitchLimits?.maxY || 68;
    maxX = pMaxX;
    maxY = pMaxY;

    const normX = x => isSecondHalf ? pMaxX - x : x;

    for (const sp of pathmaps.filter(p => p.pathType === 'sprint')) {
      for (const path of (sp.paths || [])) {
        for (const pt of path) sprintPts.push([normX(pt[0]), pt[1]]);
      }
    }

    for (const hp of pathmaps.filter(p => p.pathType === 'high_intensity')) {
      for (const path of (hp.paths || [])) {
        for (const pt of path) hiPts.push([normX(pt[0]), pt[1]]);
      }
    }

    if (pm.averagePosition) {
      const ap = pm.averagePosition;
      const nx = isSecondHalf ? ap.maxX - ap.xPosition : ap.xPosition;
      avgXNorm = avgXNorm === null ? nx / (ap.maxX || maxX) : (avgXNorm + nx / (ap.maxX || maxX)) / 2;
    }
  }

  if (sprintPts.length === 0 && hiPts.length === 0) return null;

  const zoneBreakdown = (pts) => {
    if (pts.length === 0) return null;
    const att = pts.filter(p => p[0] > maxX * 2 / 3).length / pts.length;
    const mid = pts.filter(p => p[0] >= maxX / 3 && p[0] <= maxX * 2 / 3).length / pts.length;
    const def = pts.filter(p => p[0] < maxX / 3).length / pts.length;
    const left = pts.filter(p => p[1] < maxY / 3).length / pts.length;
    const centre = pts.filter(p => p[1] >= maxY / 3 && p[1] <= maxY * 2 / 3).length / pts.length;
    const right = pts.filter(p => p[1] > maxY * 2 / 3).length / pts.length;
    const dominantThird = att >= mid && att >= def ? 'attacking' : mid >= def ? 'middle' : 'defensive';
    const dominantCh = centre >= left && centre >= right ? 'central' : left >= right ? 'left' : 'right';
    return { attPct: Math.round(att * 100), midPct: Math.round(mid * 100), defPct: Math.round(def * 100), dominantThird, dominantCh };
  };

  return {
    sprint: zoneBreakdown(sprintPts),
    hi: zoneBreakdown(hiPts),
    avgPosPct: avgXNorm !== null ? Math.round(avgXNorm * 100) : null,
  };
}

function buildZoneSummaries(pathParticipations) {
  const map = {};
  for (const p of (pathParticipations || [])) {
    const date = p.matchSession.startTime.slice(0, 10);
    map[date] = analyzeZones(p.periodMetricSets);
  }
  return map;
}

function formatZoneInfo(zone) {
  if (!zone) return '';
  const lines = [];
  if (zone.sprint) {
    const z = zone.sprint;
    lines.push(`Sprint zone breakdown: ${z.attPct}% attacking third / ${z.midPct}% middle / ${z.defPct}% defensive, predominantly ${z.dominantCh} channel`);
  }
  if (zone.hi) {
    const z = zone.hi;
    lines.push(`High-intensity zone: ${z.attPct}% attacking / ${z.midPct}% middle / ${z.defPct}% defensive, ${z.dominantCh} channel`);
  }
  if (zone.avgPosPct !== null) {
    const desc = zone.avgPosPct > 65 ? 'advanced striker position' : zone.avgPosPct > 50 ? 'forward-leaning' : zone.avgPosPct > 35 ? 'mid-pitch' : 'deep-lying';
    lines.push(`Average position: ${desc} (${zone.avgPosPct}% up the pitch)`);
  }
  return lines.join('\n');
}

// ─── AI Taglines ──────────────────────────────────────────────────────────────

async function generateTagline(s, zoneInfo) {
  if (!XAI_API_KEY) return null;

  const playingMins = s.actual_mins ?? Math.min(90, Math.max(30, s.duration_mins - 15));
  const dateFormatted = new Date(s.date + 'T12:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  const zoneContext = zoneInfo ? `\nPitch movement:\n${formatZoneInfo(zoneInfo)}` : '';
  const resultContext = s.result && s.score ? `Result: ${s.result.toUpperCase()} ${s.score}\n` : s.result ? `Result: ${s.result.toUpperCase()}\n` : '';

  const prompt = `Write ONE punchy tagline (max 12 words) for a young player's GPS match report on a football profile website. Use the pitch movement data to make it specific — mention zones, channels, or positioning when they're interesting. If a result is provided, weave it in naturally. Sound like a match report excerpt, not a data dump. No quotes. No emoji.

Match: ${s.match}, ${dateFormatted}
${resultContext}Playing time: ~${playingMins} mins
Distance: ${(s.distance_m / 1000).toFixed(1)}km | Top speed: ${s.max_speed_kph} km/h | Avg speed: ${s.avg_speed_kph} km/h
Sprints: ${s.sprints} (${s.sprint_distance_m}m) | High intensity: ${s.high_intensity} events | High speed runs: ${s.high_speed_run_events}
Metres/min: ${s.metres_per_min} | Workload: ${s.workload}${zoneContext}

Examples of good taglines:
- "Explosive in the channels — 74% of sprints in the attacking third"
- "Relentless pressing, covering 9.4km with 12 sprints from deep"
- "Drove hard through the centre, peaking at 29.4 km/h"`;

  try {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${XAI_API_KEY}` },
      body: JSON.stringify({ model: 'grok-3-mini', messages: [{ role: 'user', content: prompt }], max_tokens: 60, temperature: 0.7 }),
    });
    if (!res.ok) {
      console.warn(`⚠️ xAI error ${res.status} for ${s.date}: ${(await res.text()).slice(0, 100)}`);
      return null;
    }
    const json = await res.json();
    const tagline = json.choices?.[0]?.message?.content?.trim() ?? null;
    if (tagline) console.log(`  ✨ ${s.date}: "${tagline}"`);
    return tagline;
  } catch (e) {
    console.warn(`⚠️ xAI failed for ${s.date}: ${e.message}`);
    return null;
  }
}

async function generatePerformanceSummary(sessions, zoneByDate) {
  if (!XAI_API_KEY) return null;

  const dataSessions = sessions.filter(s => s.has_data).slice(0, 10);
  if (dataSessions.length < 2) return null;

  const rows = dataSessions.map(s => {
    const result = s.result ? ` [${s.result.toUpperCase()}${s.score ? ` ${s.score}` : ''}]` : '';
    const zone = zoneByDate?.[s.date];
    const zoneLine = zone ? ` | ${zone.sprintZone ?? ''} ${zone.channel ?? ''}`.trim() : '';
    return `- ${s.date} vs ${s.match}${result}: ${(s.distance_m/1000).toFixed(1)}km, ${s.max_speed_kph}km/h top, ${s.sprints} sprints, ${s.high_intensity} HI runs${zoneLine}`;
  }).join('\n');

  const prompt = `Write exactly 2 sentences for a football scout's player profile. Identify one clear pattern from the GPS data — ideally linking high output to positive results. Be specific with numbers. No generic phrases. No emoji. Complete sentences only — do not trail off.

GPS Sessions:\n${rows}`;

  try {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${XAI_API_KEY}` },
      body: JSON.stringify({ model: 'grok-3-mini', messages: [{ role: 'user', content: prompt }], max_tokens: 250, temperature: 0.6 }),
    });
    if (!res.ok) { console.warn(`⚠️ xAI summary error ${res.status}`); return null; }
    const json = await res.json();
    const summary = json.choices?.[0]?.message?.content?.trim() ?? null;
    if (summary) console.log(`  ✨ Performance summary generated`);
    return summary;
  } catch (e) {
    console.warn(`⚠️ xAI summary failed: ${e.message}`);
    return null;
  }
}

async function generateAllTaglines(sessions, existingTaglines, zoneByDate) {
  const taglines = { ...existingTaglines };
  const missing = sessions.filter(s => s.has_data && !taglines[s.session_id]);

  if (missing.length === 0) { console.log('✅ All sessions already have AI taglines'); return taglines; }
  if (!XAI_API_KEY) { console.log('⚠️ XAI_API_KEY not set, skipping taglines'); return taglines; }

  console.log(`✨ Generating ${missing.length} AI tagline(s) via Grok with zone context...`);
  for (let i = 0; i < missing.length; i++) {
    const s = missing[i];
    const tagline = await generateTagline(s, zoneByDate?.[s.date] ?? null);
    if (tagline) taglines[s.session_id] = tagline;
    if (i < missing.length - 1) await new Promise(r => setTimeout(r, 500));
  }
  return taglines;
}

// ─── YAML ─────────────────────────────────────────────────────────────────────

function getExistingOverrides() {
  const path = 'src/content/gps/gps.yaml';
  if (!existsSync(path)) return { mins: {}, taglines: {}, matches: {} };
  const content = readFileSync(path, 'utf8');
  const mins = {}, taglines = {}, matches = {};
  let currentId = null;
  for (const line of content.split('\n')) {
    const idMatch = line.match(/session_id:\s*"([^"]+)"/);
    if (idMatch) currentId = idMatch[1];
    const minsMatch = line.match(/actual_mins:\s*(\d+)/);
    if (minsMatch && currentId) mins[currentId] = parseInt(minsMatch[1]);
    const taglineMatch = line.match(/ai_tagline:\s*"((?:[^"\\]|\\.)*)"/);
    if (taglineMatch && currentId) taglines[currentId] = taglineMatch[1].replace(/\\"/g, '"');
    const matchMatch = line.match(/match:\s*"([^"]+)"/);
    if (matchMatch && currentId) matches[currentId] = matchMatch[1];
  }
  return { mins, taglines, matches };
}

const EXPLICIT_FIELDS = new Set(['date', 'session_id', 'match', 'our_team', 'result', 'score', 'actual_mins', 'ai_tagline']);

function toYAML(sessions, taglines, performanceSummary) {
  let yaml = '';
  if (performanceSummary) {
    const escaped = performanceSummary
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\r?\n/g, ' ')
      .trim();
    yaml += `ai_performance_summary: "${escaped}"\n`;
  }
  yaml += 'sessions:\n';
  for (const s of sessions) {
    yaml += `  - date: "${s.date}"\n`;
    yaml += `    match: "${s.match}"\n`;
    if (s.our_team) yaml += `    our_team: "${s.our_team}"\n`;
    if (s.result)   yaml += `    result: "${s.result}"\n`;
    if (s.score)    yaml += `    score: "${s.score}"\n`;
    const tagline = taglines[s.session_id];
    if (tagline) yaml += `    ai_tagline: "${tagline.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"\n`;
    yaml += `    session_id: "${s.session_id}"\n`;
    if (s.actual_mins) yaml += `    actual_mins: ${s.actual_mins}\n`;
    for (const [k, v] of Object.entries(s)) {
      if (EXPLICIT_FIELDS.has(k)) continue;
      if (typeof v === 'boolean' || typeof v === 'number') yaml += `    ${k}: ${v}\n`;
    }
  }
  return yaml;
}

// ─── SVG Path Maps ────────────────────────────────────────────────────────────

function generatePathSVGs(pathParticipations, initials) {
  const dir = 'public/gps/heatmaps';

  function smoothPath(points) {
    if (points.length < 2) return '';
    if (points.length === 2) return `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}L${points[1][0].toFixed(1)},${points[1][1].toFixed(1)}`;
    let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      const cp1x = p1[0] + (p2[0] - p0[0]) / 2;
      const cp1y = p1[1] + (p2[1] - p0[1]) / 2;
      const cp2x = p2[0] - (p3[0] - p1[0]) / 2;
      const cp2y = p2[1] - (p3[1] - p1[1]) / 2;
      d += `C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
  }

  let pathCount = 0;
  for (const p of pathParticipations) {
    const date = p.matchSession.startTime.slice(0, 10);
    for (const pm of (p.periodMetricSets || [])) {
      const periodName = pm.matchSessionPeriod.name;
      const period = periodName.toLowerCase().replace(/\s+/g, '-');
      const isSecondHalf = periodName === 'Second Half';
      const ap = pm.averagePosition;
      const pathmaps = pm.pathmaps || [];
      if (!ap && pathmaps.length === 0) continue;

      const filepath = `${dir}/${date}-${period}-paths.svg`;
      if (existsSync(filepath)) continue;

      const maxX = ap?.maxX || pathmaps[0]?.pitchLimits?.maxX || 105;
      const maxY = ap?.maxY || pathmaps[0]?.pitchLimits?.maxY || 68;
      const flipY = y => isSecondHalf ? y : maxY - y;
      const flipX = x => isSecondHalf ? maxX - x : x;

      let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${maxX} ${maxY}" preserveAspectRatio="none">\n`;

      for (const sp of pathmaps.filter(p => p.pathType === 'sprint')) {
        for (const path of (sp.paths || [])) {
          if (path.length < 2) continue;
          const pts = path.map(pt => [flipX(pt[0]), flipY(pt[1])]);
          svg += `  <path d="${smoothPath(pts)}" fill="none" stroke="#ef4444" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>\n`;
        }
      }

      for (const hp of pathmaps.filter(p => p.pathType === 'high_intensity')) {
        for (const path of (hp.paths || [])) {
          if (path.length < 2) continue;
          const pts = path.map(pt => [flipX(pt[0]), flipY(pt[1])]);
          svg += `  <path d="${smoothPath(pts)}" fill="none" stroke="#fbbf24" stroke-width="0.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.7"/>\n`;
        }
      }

      if (ap) {
        const cx = flipX(ap.xPosition).toFixed(1);
        const cy = flipY(ap.yPosition).toFixed(1);
        const rx = 3.5;
        const stretchRatio = (1600 / maxY) / (1056 / maxX);
        const ry = (rx / stretchRatio).toFixed(1);
        svg += `  <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#0c0c0c" stroke="#ef4444" stroke-width="0.4" opacity="0.95"/>\n`;
        svg += `  <text x="${cx}" y="${(parseFloat(cy) + parseFloat(ry) * 0.35).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="${(parseFloat(ry) * 0.95).toFixed(1)}" font-weight="700" fill="#ffffff" opacity="0.95">${initials}</text>\n`;
      }

      svg += '</svg>';
      writeFileSync(filepath, svg);
      pathCount++;
    }
  }
  console.log(`📥 Generated ${pathCount} new path map(s)`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

try {
  console.log(`🔑 Logging in via ${GPS_PROVIDER_TYPE} provider...`);
  const cookies = await provider.login(GPS_PROVIDER_EMAIL, GPS_PROVIDER_PASSWORD);
  console.log('✅ Logged in');

  const playerInfo = provider.fetchPlayerInfo ? await provider.fetchPlayerInfo(cookies) : {};
  const initials = playerInfo.initials ?? '??';
  console.log(`👤 Player: ${playerInfo.name ?? 'Unknown'} (${initials})`);

  console.log('📡 Fetching GPS metrics and path data...');
  const [rawSessions, pathParticipations] = await Promise.all([
    provider.fetchSessions(cookies),
    provider.fetchPathData(cookies),
  ]);

  const { mins: existingMins, taglines: existingTaglines } = getExistingOverrides();
  const sessions = provider.normalizeSessions(rawSessions, existingMins);

  // Match names always come from the API — no cache override

  const zoneByDate = buildZoneSummaries(pathParticipations);
  console.log(`📊 Zone data for ${sessions.filter(s => s.has_data && zoneByDate[s.date]).length}/${sessions.filter(s => s.has_data).length} sessions`);

  // Only generate taglines for sessions that don't already have one (unless force flag set)
  const taglineCache = GPS_FORCE_TAGLINES === 'true' ? {} : existingTaglines;
  if (GPS_FORCE_TAGLINES === 'true') console.log('⚡ Force regenerating all taglines');
  const taglines = await generateAllTaglines(sessions, taglineCache, zoneByDate);

  console.log('✨ Generating cross-session performance summary...');
  const performanceSummary = await generatePerformanceSummary(sessions, zoneByDate);

  writeFileSync('src/content/gps/gps.yaml', toYAML(sessions, taglines, performanceSummary));
  console.log(`✅ Wrote ${sessions.filter(s => s.has_data).length}/${sessions.length} GPS sessions to gps.yaml`);

  console.log('🗺️ Fetching heatmap images...');
  await provider.fetchHeatmapImages(cookies, 'public/gps/heatmaps');

  generatePathSVGs(pathParticipations, initials);

} catch (err) {
  console.error(`❌ ${err.message}`);
  console.log('⚠️ Keeping existing gps.yaml');
  process.exit(0);
}
