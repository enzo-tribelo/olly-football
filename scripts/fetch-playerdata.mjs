#!/usr/bin/env node
// Fetch GPS data from PlayerData API and write to src/content/gps/gps.yaml

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs';

const { GPS_EMAIL, GPS_PASSWORD, XAI_API_KEY } = process.env;

if (!GPS_EMAIL || !GPS_PASSWORD) {
  console.log('⚠️ PlayerData credentials not set, skipping GPS fetch');
  process.exit(0);
}

const BASE = 'https://app.playerdata.co.uk';

// ─── Auth ────────────────────────────────────────────────────────────────────

async function login() {
  const loginPage = await fetch(`${BASE}/api/auth/identities/sign_in`);
  const html = await loginPage.text();
  const csrf = html.match(/csrf-token.*?content="([^"]+)"/)?.[1];
  if (!csrf) throw new Error('Failed to get CSRF token');

  const initCookies = loginPage.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');

  const body = new URLSearchParams({
    'authenticity_token': csrf,
    'identity[email]': GPS_EMAIL,
    'identity[password]': GPS_PASSWORD,
  });

  const loginRes = await fetch(`${BASE}/api/auth/identities/sign_in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: initCookies },
    body,
    redirect: 'manual',
  });

  if (loginRes.status !== 302) throw new Error(`Login failed (HTTP ${loginRes.status})`);
  return loginRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
}

// ─── GPS Metrics ─────────────────────────────────────────────────────────────

async function fetchGPS(cookies) {
  const query = `{
    currentPerson {
      matchSessionParticipations(limit: 50) {
        id
        matchSession { id startTime endTime }
        metricSet {
          totalDistanceM maxSpeedKph avgSpeedKph metresPerMinute
          sprintEvents totalSprintDistanceM
          highIntensityEvents totalHighIntensityDistanceM
          highSpeedRunDistanceM highSpeedRunEvents
          accelerationEvents decelerationEvents maxAcceleration maxDeceleration
          clubZoneSprintDistanceM clubZoneSprintDurationS clubZoneSprintEvents
          clubZoneHighSpeedRunningDistanceM clubZoneHighSpeedRunningDurationS clubZoneHighSpeedRunningEvents
          clubZoneHighIntensityDistanceM clubZoneHighIntensityDurationS clubZoneHighIntensityEvents
          clubZoneMediumIntensityDistanceM clubZoneMediumIntensityDurationS
          clubZoneLowIntensityDistanceM clubZoneLowIntensityDurationS
          clubZoneJoggingDistanceM clubZoneJoggingDurationS
          workload workloadIntensity
        }
      }
    }
  }`;

  const res = await fetch(`${BASE}/api/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookies },
    body: JSON.stringify({ query }),
  });

  const data = await res.json();
  if (data.errors) throw new Error(`API error: ${JSON.stringify(data.errors)}`);
  return data.data.currentPerson.matchSessionParticipations;
}

// ─── Path Data (fetched once, used for both zone analysis + SVG generation) ──

async function fetchPathData(cookies) {
  const query = `{
    currentPerson {
      matchSessionParticipations(limit: 50) {
        matchSession { startTime }
        periodMetricSets {
          matchSessionPeriod { name }
          averagePosition { xPosition yPosition maxX maxY }
          pathmaps { pathType paths pitchLimits { maxX maxY } }
        }
      }
    }
  }`;

  const res = await fetch(`${BASE}/api/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookies },
    body: JSON.stringify({ query }),
  });
  const data = await res.json();
  if (data.errors) throw new Error(`Path query error: ${JSON.stringify(data.errors)}`);
  return data.data.currentPerson.matchSessionParticipations;
}

// ─── Zone Analysis ───────────────────────────────────────────────────────────
//
// Normalises coordinates so "attacking" = high X regardless of which half,
// then buckets path points into thirds (defensive / middle / attacking) and
// channels (left / central / right).

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

    // Normalise X: second half attacks in low-X direction so flip it
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

    // Average position from API field
    if (pm.averagePosition) {
      const ap = pm.averagePosition;
      const nx = isSecondHalf ? ap.maxX - ap.xPosition : ap.xPosition;
      // Running average across both halves
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
    return {
      attPct: Math.round(att * 100),
      midPct: Math.round(mid * 100),
      defPct: Math.round(def * 100),
      dominantThird,
      dominantCh,
    };
  };

  return {
    sprint: zoneBreakdown(sprintPts),
    hi: zoneBreakdown(hiPts),
    avgPosPct: avgXNorm !== null ? Math.round(avgXNorm * 100) : null,
  };
}

// Build a map of session date → zone summary
function buildZoneSummaries(pathParticipations) {
  const map = {};
  for (const p of (pathParticipations || [])) {
    const date = p.matchSession.startTime.slice(0, 10);
    map[date] = analyzeZones(p.periodMetricSets);
  }
  return map;
}

// Format zone data into a readable string for the AI prompt
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

// ─── AI Tagline Generation ───────────────────────────────────────────────────

async function generateTagline(s, zoneInfo) {
  if (!XAI_API_KEY) return null;

  const playingMins = s.actual_mins ?? Math.min(90, Math.max(30, s.duration_mins - 15));
  const dateFormatted = new Date(s.date + 'T12:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  const zoneContext = zoneInfo ? `\nPitch movement:\n${formatZoneInfo(zoneInfo)}` : '';

  const prompt = `Write ONE punchy tagline (max 12 words) for a young striker's GPS match report on a football profile website. Use the pitch movement data to make it specific — mention zones, channels, or positioning when they're interesting. Sound like a match report excerpt, not a data dump. No quotes. No emoji.

Match: ${s.match}, ${dateFormatted}
Playing time: ~${playingMins} mins
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
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'grok-3-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 60,
        temperature: 0.7,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.warn(`⚠️ xAI error ${res.status} for ${s.date}: ${errText.slice(0, 100)}`);
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

async function generateAllTaglines(sessions, existingTaglines, zoneByDate) {
  const taglines = { ...existingTaglines };
  const missing = sessions.filter(s => s.has_data && !taglines[s.session_id]);

  if (missing.length === 0) {
    console.log('✅ All sessions already have AI taglines');
    return taglines;
  }

  if (!XAI_API_KEY) {
    console.log('⚠️ XAI_API_KEY not set, skipping tagline generation');
    return taglines;
  }

  console.log(`✨ Generating ${missing.length} AI tagline(s) via Grok with zone context...`);
  for (let i = 0; i < missing.length; i++) {
    const s = missing[i];
    const zoneInfo = zoneByDate?.[s.date] ?? null;
    const tagline = await generateTagline(s, zoneInfo);
    if (tagline) taglines[s.session_id] = tagline;
    if (i < missing.length - 1) await new Promise(r => setTimeout(r, 500));
  }

  return taglines;
}

// ─── YAML ────────────────────────────────────────────────────────────────────

function getExistingOverrides() {
  const path = 'src/content/gps/gps.yaml';
  if (!existsSync(path)) return { mins: {}, taglines: {} };
  const content = readFileSync(path, 'utf8');
  const mins = {};
  const taglines = {};
  let currentId = null;
  for (const line of content.split('\n')) {
    const idMatch = line.match(/session_id:\s*"([^"]+)"/);
    if (idMatch) currentId = idMatch[1];
    const minsMatch = line.match(/actual_mins:\s*(\d+)/);
    if (minsMatch && currentId) mins[currentId] = parseInt(minsMatch[1]);
    const taglineMatch = line.match(/ai_tagline:\s*"((?:[^"\\]|\\.)*)"/);
    if (taglineMatch && currentId) taglines[currentId] = taglineMatch[1].replace(/\\"/g, '"');
  }
  return { mins, taglines };
}

function round1(v) { return Math.round((v || 0) * 10) / 10; }
function round0(v) { return Math.round(v || 0); }

function buildSessions(participations, existingMins) {
  return participations.map(p => {
    const ms = p.metricSet;
    const hasData = !!(ms && ms.totalDistanceM > 0);
    return {
      date: p.matchSession.startTime.slice(0, 10),
      session_id: p.matchSession.id,
      match: 'Bath City U18',
      duration_mins: Math.round((new Date(p.matchSession.endTime) - new Date(p.matchSession.startTime)) / 60000),
      actual_mins: existingMins[p.matchSession.id],
      has_data: hasData,
      distance_m: round0(ms?.totalDistanceM),
      max_speed_kph: round1(ms?.maxSpeedKph),
      avg_speed_kph: round1(ms?.avgSpeedKph),
      metres_per_min: round1(ms?.metresPerMinute),
      sprints: ms?.sprintEvents ?? 0,
      sprint_distance_m: round0(ms?.totalSprintDistanceM),
      high_intensity: ms?.highIntensityEvents ?? 0,
      high_intensity_distance_m: round0(ms?.totalHighIntensityDistanceM),
      high_speed_run_events: ms?.highSpeedRunEvents ?? 0,
      high_speed_distance_m: round0(ms?.highSpeedRunDistanceM),
      accelerations: ms?.accelerationEvents ?? 0,
      decelerations: ms?.decelerationEvents ?? 0,
      max_acceleration: round1(ms?.maxAcceleration),
      max_deceleration: round1(ms?.maxDeceleration),
      zone_sprint_distance_m: round0(ms?.clubZoneSprintDistanceM),
      zone_sprint_duration_s: round0(ms?.clubZoneSprintDurationS),
      zone_sprint_events: ms?.clubZoneSprintEvents ?? 0,
      zone_hs_running_distance_m: round0(ms?.clubZoneHighSpeedRunningDistanceM),
      zone_hs_running_duration_s: round0(ms?.clubZoneHighSpeedRunningDurationS),
      zone_hs_running_events: ms?.clubZoneHighSpeedRunningEvents ?? 0,
      zone_high_intensity_distance_m: round0(ms?.clubZoneHighIntensityDistanceM),
      zone_high_intensity_duration_s: round0(ms?.clubZoneHighIntensityDurationS),
      zone_high_intensity_events: ms?.clubZoneHighIntensityEvents ?? 0,
      zone_medium_distance_m: round0(ms?.clubZoneMediumIntensityDistanceM),
      zone_medium_duration_s: round0(ms?.clubZoneMediumIntensityDurationS),
      zone_low_distance_m: round0(ms?.clubZoneLowIntensityDistanceM),
      zone_low_duration_s: round0(ms?.clubZoneLowIntensityDurationS),
      zone_jogging_distance_m: round0(ms?.clubZoneJoggingDistanceM),
      zone_jogging_duration_s: round0(ms?.clubZoneJoggingDurationS),
      workload: round0(ms?.workload),
      workload_intensity: round0(ms?.workloadIntensity),
    };
  }).sort((a, b) => b.date.localeCompare(a.date));
}

const EXPLICIT_FIELDS = new Set(['date', 'session_id', 'match', 'actual_mins', 'ai_tagline']);

function toYAML(sessions, taglines) {
  let yaml = 'sessions:\n';
  for (const s of sessions) {
    yaml += `  - date: "${s.date}"\n`;
    yaml += `    match: "${s.match}"\n`;
    const tagline = taglines[s.session_id];
    if (tagline) yaml += `    ai_tagline: "${tagline.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"\n`;
    yaml += `    session_id: "${s.session_id}"\n`;
    if (s.actual_mins) yaml += `    actual_mins: ${s.actual_mins}\n`;
    for (const [k, v] of Object.entries(s)) {
      if (EXPLICIT_FIELDS.has(k)) continue;
      if (typeof v === 'boolean') yaml += `    ${k}: ${v}\n`;
      else if (typeof v === 'number') yaml += `    ${k}: ${v}\n`;
    }
  }
  return yaml;
}

// ─── Heatmap Images ──────────────────────────────────────────────────────────

async function fetchHeatmapImages(cookies) {
  const dir = 'public/gps/heatmaps';
  mkdirSync(dir, { recursive: true });

  if (!existsSync(`${dir}/pitch.png`)) {
    const pitchRes = await fetch(`${BASE}/api/assets/pitches/association_football_pitch-09b304bcba2fb55b78d668a325443484769ad9dabda105ff51e5c2169b251955.png`, { headers: { Cookie: cookies } });
    if (pitchRes.ok) {
      writeFileSync(`${dir}/pitch.png`, Buffer.from(await pitchRes.arrayBuffer()));
      console.log('📥 Downloaded pitch background');
    }
  }

  const query = `{
    currentPerson {
      matchSessionParticipations(limit: 50) {
        matchSession { startTime }
        periodMetricSets {
          heatmap
          matchSessionPeriod { name }
        }
      }
    }
  }`;

  const res = await fetch(`${BASE}/api/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookies },
    body: JSON.stringify({ query }),
  });
  const data = await res.json();
  if (data.errors) { console.log('⚠️ Heatmap query errors:', JSON.stringify(data.errors)); return; }

  let downloaded = 0;
  for (const p of data.data.currentPerson.matchSessionParticipations) {
    const date = p.matchSession.startTime.slice(0, 10);
    for (const pm of (p.periodMetricSets || [])) {
      if (!pm.heatmap) continue;
      const period = pm.matchSessionPeriod.name.toLowerCase().replace(/\s+/g, '-');
      const filepath = `${dir}/${date}-${period}.png`;
      if (existsSync(filepath) && statSync(filepath).size > 2000) continue;
      const imgRes = await fetch(pm.heatmap, { headers: { Cookie: cookies }, redirect: 'follow' });
      if (!imgRes.ok) continue;
      writeFileSync(filepath, Buffer.from(await imgRes.arrayBuffer()));
      downloaded++;
    }
  }
  console.log(`📥 Downloaded ${downloaded} new heatmap image(s)`);
}

// ─── SVG Path Maps (uses pre-fetched path data) ──────────────────────────────

function generatePathSVGs(pathParticipations) {
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
      // SVG display flip (opposite to zone analysis normalisation)
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
        svg += `  <text x="${cx}" y="${(parseFloat(cy) + parseFloat(ry) * 0.35).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="${(parseFloat(ry) * 0.95).toFixed(1)}" font-weight="700" fill="#ffffff" opacity="0.95">OR</text>\n`;
      }

      svg += '</svg>';
      writeFileSync(filepath, svg);
      pathCount++;
    }
  }
  console.log(`📥 Generated ${pathCount} new path map(s)`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

try {
  console.log('🔑 Logging in to PlayerData...');
  const cookies = await login();
  console.log('✅ Logged in');

  // Fetch metrics and path data in parallel
  console.log('📡 Fetching GPS metrics and path data...');
  const [participations, pathParticipations] = await Promise.all([
    fetchGPS(cookies),
    fetchPathData(cookies),
  ]);

  const { mins: existingMins, taglines: existingTaglines } = getExistingOverrides();
  const sessions = buildSessions(participations, existingMins);

  // Build zone summaries from path coordinates
  const zoneByDate = buildZoneSummaries(pathParticipations);
  const sessionsWithZones = sessions.filter(s => s.has_data && zoneByDate[s.date]);
  console.log(`📊 Zone data available for ${sessionsWithZones.length}/${sessions.filter(s => s.has_data).length} sessions`);

  // Generate taglines (with zone context for spatial specificity)
  const taglines = await generateAllTaglines(sessions, existingTaglines, zoneByDate);

  // Write YAML
  const yaml = toYAML(sessions, taglines);
  writeFileSync('src/content/gps/gps.yaml', yaml);
  console.log(`✅ Wrote ${sessions.filter(s => s.has_data).length}/${sessions.length} GPS sessions to gps.yaml`);

  // Fetch heatmap PNGs
  console.log('🗺️ Fetching heatmap images...');
  await fetchHeatmapImages(cookies);

  // Generate SVG path maps from already-fetched path data (no second API call)
  generatePathSVGs(pathParticipations);

} catch (err) {
  console.error(`❌ ${err.message}`);
  console.log('⚠️ Keeping existing gps.yaml');
  process.exit(0);
}
