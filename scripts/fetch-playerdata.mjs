#!/usr/bin/env node
// Fetch GPS data from PlayerData API and write to src/content/gps/gps.yaml

import { writeFileSync } from 'fs';

const { PLAYERDATA_EMAIL, PLAYERDATA_PASSWORD } = process.env;

if (!PLAYERDATA_EMAIL || !PLAYERDATA_PASSWORD) {
  console.log('⚠️ PlayerData credentials not set, skipping GPS fetch');
  process.exit(0);
}

const BASE = 'https://app.playerdata.co.uk';

async function login() {
  // 1. Get CSRF token from login page
  const loginPage = await fetch(`${BASE}/api/auth/identities/sign_in`);
  const html = await loginPage.text();
  const csrf = html.match(/csrf-token.*?content="([^"]+)"/)?.[1];
  if (!csrf) throw new Error('Failed to get CSRF token');

  // Carry cookies
  const cookies = loginPage.headers.getSetCookie?.() || [];
  const cookieHeader = cookies.map(c => c.split(';')[0]).join('; ');

  // 2. POST login form
  const body = new URLSearchParams({
    'authenticity_token': csrf,
    'identity[email]': PLAYERDATA_EMAIL,
    'identity[password]': PLAYERDATA_PASSWORD,
  });

  const loginRes = await fetch(`${BASE}/api/auth/identities/sign_in`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookieHeader,
    },
    body,
    redirect: 'manual',
  });

  if (loginRes.status !== 302) {
    throw new Error(`Login failed (HTTP ${loginRes.status})`);
  }

  // Use the new session cookie from the 302 (authenticated session)
  const setCookies = loginRes.headers.getSetCookie?.() || [];
  return setCookies.map(c => c.split(';')[0]).join('; ');
}

async function fetchGPS(cookies) {
  const query = `{
    currentPerson {
      name
      matchSessionParticipations(limit: 50) {
        id
        matchSession { id startTime endTime }
        metricSet {
          totalDistanceM
          maxSpeedKph
          avgSpeedKph
          sprintEvents
          highIntensityEvents
          highSpeedRunDistanceM
        }
      }
    }
  }`;

  const res = await fetch(`${BASE}/api/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookies,
    },
    body: JSON.stringify({ query }),
  });

  const data = await res.json();
  if (data.errors) throw new Error(`API error: ${JSON.stringify(data.errors)}`);
  return data.data.currentPerson.matchSessionParticipations;
}

function toYAML(sessions) {
  const all = sessions
    .map(p => ({
      date: p.matchSession.startTime.slice(0, 10),
      duration_mins: Math.round((new Date(p.matchSession.endTime) - new Date(p.matchSession.startTime)) / 60000),
      has_data: !!(p.metricSet && p.metricSet.totalDistanceM > 0),
      distance_m: p.metricSet ? Math.round(p.metricSet.totalDistanceM) : 0,
      max_speed_kph: p.metricSet ? Math.round(p.metricSet.maxSpeedKph * 10) / 10 : 0,
      avg_speed_kph: p.metricSet ? Math.round(p.metricSet.avgSpeedKph * 10) / 10 : 0,
      sprints: p.metricSet?.sprintEvents ?? 0,
      high_intensity: p.metricSet?.highIntensityEvents ?? 0,
      high_speed_distance_m: p.metricSet ? Math.round(p.metricSet.highSpeedRunDistanceM) : 0,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  let yaml = 'sessions:\n';
  for (const s of all) {
    yaml += `  - date: "${s.date}"\n`;
    yaml += `    match: "Bath City U18"\n`;
    yaml += `    duration_mins: ${s.duration_mins}\n`;
    yaml += `    has_data: ${s.has_data}\n`;
    yaml += `    distance_m: ${s.distance_m}\n`;
    yaml += `    max_speed_kph: ${s.max_speed_kph}\n`;
    yaml += `    avg_speed_kph: ${s.avg_speed_kph}\n`;
    yaml += `    sprints: ${s.sprints}\n`;
    yaml += `    high_intensity: ${s.high_intensity}\n`;
    yaml += `    high_speed_distance_m: ${s.high_speed_distance_m}\n`;
  }
  return { yaml, count: all.filter(s => s.has_data).length, total: all.length };
}

try {
  console.log('🔑 Logging in to PlayerData...');
  const cookies = await login();
  console.log('✅ Logged in, fetching GPS data...');
  const participations = await fetchGPS(cookies);
  const { yaml, count, total } = toYAML(participations);
  writeFileSync('src/content/gps/gps.yaml', yaml);
  console.log(`✅ Wrote ${count}/${total} GPS sessions to gps.yaml`);
} catch (err) {
  console.error(`❌ ${err.message}`);
  console.log('⚠️ Keeping existing gps.yaml');
  process.exit(0);
}
