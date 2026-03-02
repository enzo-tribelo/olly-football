#!/usr/bin/env node
// Fetch GPS data from PlayerData API and write to src/content/gps/gps.yaml

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs';

const { PLAYERDATA_EMAIL, PLAYERDATA_PASSWORD } = process.env;

if (!PLAYERDATA_EMAIL || !PLAYERDATA_PASSWORD) {
  console.log('⚠️ PlayerData credentials not set, skipping GPS fetch');
  process.exit(0);
}

const BASE = 'https://app.playerdata.co.uk';

async function login() {
  const loginPage = await fetch(`${BASE}/api/auth/identities/sign_in`);
  const html = await loginPage.text();
  const csrf = html.match(/csrf-token.*?content="([^"]+)"/)?.[1];
  if (!csrf) throw new Error('Failed to get CSRF token');

  const initCookies = loginPage.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');

  const body = new URLSearchParams({
    'authenticity_token': csrf,
    'identity[email]': PLAYERDATA_EMAIL,
    'identity[password]': PLAYERDATA_PASSWORD,
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

async function fetchGPS(cookies) {
  const query = `{
    currentPerson {
      name
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

function round1(v) { return Math.round((v || 0) * 10) / 10; }
function round0(v) { return Math.round(v || 0); }

// Read existing actual_mins values to preserve manual overrides
function getExistingActualMins() {
  const path = 'src/content/gps/gps.yaml';
  if (!existsSync(path)) return {};
  const content = readFileSync(path, 'utf8');
  const map = {};
  let currentId = null;
  for (const line of content.split('\n')) {
    const idMatch = line.match(/session_id:\s*"([^"]+)"/);
    if (idMatch) currentId = idMatch[1];
    const minsMatch = line.match(/actual_mins:\s*(\d+)/);
    if (minsMatch && currentId) map[currentId] = parseInt(minsMatch[1]);
  }
  return map;
}

function toYAML(participations, existingMins) {
  const all = participations.map(p => {
    const ms = p.metricSet;
    const hasData = !!(ms && ms.totalDistanceM > 0);
    return {
      date: p.matchSession.startTime.slice(0, 10),
      session_id: p.matchSession.id,
      duration_mins: Math.round((new Date(p.matchSession.endTime) - new Date(p.matchSession.startTime)) / 60000),
      has_data: hasData,
      // Core
      distance_m: round0(ms?.totalDistanceM),
      max_speed_kph: round1(ms?.maxSpeedKph),
      avg_speed_kph: round1(ms?.avgSpeedKph),
      metres_per_min: round1(ms?.metresPerMinute),
      // Sprints & runs
      sprints: ms?.sprintEvents ?? 0,
      sprint_distance_m: round0(ms?.totalSprintDistanceM),
      high_intensity: ms?.highIntensityEvents ?? 0,
      high_intensity_distance_m: round0(ms?.totalHighIntensityDistanceM),
      high_speed_run_events: ms?.highSpeedRunEvents ?? 0,
      high_speed_distance_m: round0(ms?.highSpeedRunDistanceM),
      // Acceleration
      accelerations: ms?.accelerationEvents ?? 0,
      decelerations: ms?.decelerationEvents ?? 0,
      max_acceleration: round1(ms?.maxAcceleration),
      max_deceleration: round1(ms?.maxDeceleration),
      // Speed zones
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
      // Workload
      workload: round0(ms?.workload),
      workload_intensity: round0(ms?.workloadIntensity),
    };
  }).sort((a, b) => b.date.localeCompare(a.date));

  // Write as YAML
  let yaml = 'sessions:\n';
  for (const s of all) {
    yaml += `  - date: "${s.date}"\n`;
    yaml += `    match: "Bath City U18"\n`;
    yaml += `    session_id: "${s.session_id}"\n`;
    const actualMins = existingMins[s.session_id];
    if (actualMins) yaml += `    actual_mins: ${actualMins}\n`;
    for (const [k, v] of Object.entries(s)) {
      if (['date', 'session_id'].includes(k)) continue;
      if (typeof v === 'boolean') yaml += `    ${k}: ${v}\n`;
      else if (typeof v === 'number') yaml += `    ${k}: ${v}\n`;
    }
  }

  return { yaml, count: all.filter(s => s.has_data).length, total: all.length };
}

async function fetchHeatmaps(cookies) {
  const dir = 'public/gps/heatmaps';
  mkdirSync(dir, { recursive: true });

  // Download pitch background if missing
  if (!existsSync(`${dir}/pitch.png`)) {
    const pitchRes = await fetch(`${BASE}/api/assets/pitches/association_football_pitch-09b304bcba2fb55b78d668a325443484769ad9dabda105ff51e5c2169b251955.png`, { headers: { Cookie: cookies } });
    if (pitchRes.ok) {
      writeFileSync(`${dir}/pitch.png`, Buffer.from(await pitchRes.arrayBuffer()));
      console.log('📥 Downloaded pitch background');
    }
  }

  // Query period heatmaps
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

  const parts = data.data.currentPerson.matchSessionParticipations;
  let downloaded = 0;

  for (const p of parts) {
    const date = p.matchSession.startTime.slice(0, 10);
    for (const pm of (p.periodMetricSets || [])) {
      if (!pm.heatmap) continue;
      const period = pm.matchSessionPeriod.name.toLowerCase().replace(/\s+/g, '-');
      const filename = `${date}-${period}.png`;
      const filepath = `${dir}/${filename}`;

      // Skip if already downloaded and > 2KB (valid)
      if (existsSync(filepath) && statSync(filepath).size > 2000) continue;

      const imgRes = await fetch(pm.heatmap, { headers: { Cookie: cookies }, redirect: 'follow' });
      if (!imgRes.ok) continue;
      const buf = Buffer.from(await imgRes.arrayBuffer());
      writeFileSync(filepath, buf);
      downloaded++;
    }
  }
  console.log(`📥 Downloaded ${downloaded} new heatmap(s)`);

  // Fetch sprint/intensity paths and average positions
  const pathQuery = `{
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

  const pathRes = await fetch(`${BASE}/api/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookies },
    body: JSON.stringify({ query: pathQuery }),
  });
  const pathData = await pathRes.json();
  if (pathData.errors) { console.log('⚠️ Path query errors:', JSON.stringify(pathData.errors)); return; }

  let pathCount = 0;
  for (const p of pathData.data.currentPerson.matchSessionParticipations) {
    const date = p.matchSession.startTime.slice(0, 10);
    for (const pm of (p.periodMetricSets || [])) {
      const period = pm.matchSessionPeriod.name.toLowerCase().replace(/\s+/g, '-');
      const ap = pm.averagePosition;
      const pathmaps = pm.pathmaps || [];
      if (!ap && pathmaps.length === 0) continue;

      const filepath = `${dir}/${date}-${period}-paths.svg`;
      if (existsSync(filepath)) continue; // Skip existing

      const maxX = ap?.maxX || pathmaps[0]?.pitchLimits?.maxX || 105;
      const maxY = ap?.maxY || pathmaps[0]?.pitchLimits?.maxY || 68;

      let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${maxX} ${maxY}" preserveAspectRatio="none">\n`;

      for (const sp of pathmaps.filter(p => p.pathType === 'sprint')) {
        for (const path of (sp.paths || [])) {
          if (path.length < 2) continue;
          const d = 'M' + path.map(pt => pt[0].toFixed(1) + ',' + pt[1].toFixed(1)).join('L');
          svg += `  <path d="${d}" fill="none" stroke="#ef4444" stroke-width="0.8" stroke-linecap="round" opacity="0.9"/>\n`;
        }
      }

      for (const hp of pathmaps.filter(p => p.pathType === 'high_intensity')) {
        for (const path of (hp.paths || [])) {
          if (path.length < 2) continue;
          const d = 'M' + path.map(pt => pt[0].toFixed(1) + ',' + pt[1].toFixed(1)).join('L');
          svg += `  <path d="${d}" fill="none" stroke="#fbbf24" stroke-width="0.6" stroke-linecap="round" opacity="0.7"/>\n`;
        }
      }

      if (ap) {
        svg += `  <circle cx="${ap.xPosition.toFixed(1)}" cy="${ap.yPosition.toFixed(1)}" r="2" fill="#ffffff" stroke="#ef4444" stroke-width="0.5" opacity="0.9"/>\n`;
      }

      svg += '</svg>';
      writeFileSync(filepath, svg);
      pathCount++;
    }
  }
  console.log(`📥 Generated ${pathCount} new path map(s)`);
}

try {
  console.log('🔑 Logging in to PlayerData...');
  const cookies = await login();
  console.log('✅ Logged in, fetching GPS data...');
  const participations = await fetchGPS(cookies);
  const existingMins = getExistingActualMins();
  const { yaml, count, total } = toYAML(participations, existingMins);
  writeFileSync('src/content/gps/gps.yaml', yaml);
  console.log(`✅ Wrote ${count}/${total} GPS sessions to gps.yaml`);

  console.log('🗺️ Fetching heatmaps...');
  await fetchHeatmaps(cookies);
} catch (err) {
  console.error(`❌ ${err.message}`);
  console.log('⚠️ Keeping existing gps.yaml');
  process.exit(0);
}
