// PlayerData GPS provider
// Handles auth, data fetching, and normalization to the common GPS session schema.
// All PlayerData-specific URLs, field names, and API logic lives here.

const BASE = 'https://app.playerdata.co.uk';

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function login(email, password) {
  const loginPage = await fetch(`${BASE}/api/auth/identities/sign_in`);
  const html = await loginPage.text();
  const csrf = html.match(/csrf-token.*?content="([^"]+)"/)?.[1];
  if (!csrf) throw new Error('Failed to get CSRF token');

  const initCookies = loginPage.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');

  const body = new URLSearchParams({
    'authenticity_token': csrf,
    'identity[email]': email,
    'identity[password]': password,
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

// ─── GPS Metrics ──────────────────────────────────────────────────────────────

export async function fetchSessions(cookies) {
  const query = `{
    currentPerson {
      matchSessionParticipations(limit: 50) {
        id
        matchSession { id startTime endTime ourTeam opponent score opponentScore result }
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

// ─── Path Data ────────────────────────────────────────────────────────────────

export async function fetchPathData(cookies) {
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

// ─── Heatmap Images ───────────────────────────────────────────────────────────

export async function fetchHeatmapImages(cookies, dir) {
  const { writeFileSync, existsSync, mkdirSync, statSync } = await import('fs');
  mkdirSync(dir, { recursive: true });

  if (!existsSync(`${dir}/pitch.png`)) {
    const pitchRes = await fetch(
      `${BASE}/api/assets/pitches/association_football_pitch-09b304bcba2fb55b78d668a325443484769ad9dabda105ff51e5c2169b251955.png`,
      { headers: { Cookie: cookies } }
    );
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

// ─── Normalize to common GPS session schema ───────────────────────────────────

function round1(v) { return Math.round((v || 0) * 10) / 10; }
function round0(v) { return Math.round(v || 0); }

export function normalizeSessions(participations, existingMins, defaultMatch = 'Match') {
  return participations.map(p => {
    const ms = p.metricSet;
    const hasData = !!(ms && ms.totalDistanceM > 0);
    const sess = p.matchSession;
    return {
      date: sess.startTime.slice(0, 10),
      session_id: sess.id,
      match: sess.opponent || sess.ourTeam || defaultMatch,
      our_team: sess.ourTeam || null,
      result: sess.result || null,
      score: (sess.score != null && sess.opponentScore != null) ? `${sess.score}-${sess.opponentScore}` : null,
      duration_mins: Math.round((new Date(sess.endTime) - new Date(sess.startTime)) / 60000),
      actual_mins: existingMins[sess.id],
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
