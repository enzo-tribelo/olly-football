import { getCollection, getEntry } from 'astro:content';

/** Stats for both homepages. Numbers always come from the content collections. */
export async function loadHome(base: string) {
  const profile = await getEntry('profile', 'profile');
  const matchesEntry = await getEntry('matches', 'matches');
  const honoursEntry = await getEntry('honours', 'honours');
  const attributesEntry = await getEntry('attributes', 'attributes');
  const gpsEntry = await getEntry('gps', 'gps');
  if (!profile || !matchesEntry || !honoursEntry || !attributesEntry || !gpsEntry) {
    throw new Error('Missing content entries for the homepage');
  }

  const profileData = profile.data;

  const seasonsEntries = await getCollection('seasons');
  const seasons = seasonsEntries
    .map(entry => entry.data)
    .sort((a, b) => b.season.localeCompare(a.season));

  const keyMatches = matchesEntry.data.matches
    .filter(m => m.goals >= 2 || (m.goals >= 1 && m.assists >= 1))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 4);

  const honours = honoursEntry.data.honours;
  const attributes = attributesEntry.data.attributes;

  const gpsPerformanceSummary = gpsEntry.data.ai_performance_summary ?? null;
  const gpsSummaryFirstSentence = gpsPerformanceSummary
    ? (gpsPerformanceSummary.split(/(?<=[.!?])\s/)[0] ?? gpsPerformanceSummary)
    : null;
  const gpsSessions = gpsEntry.data.sessions.filter(s => s.has_data);
  const maxDist = Math.max(...gpsSessions.map(s => s.distance_m));
  const fullMatchSessions = gpsSessions.filter(s => s.distance_m > maxDist * 0.5);
  const avgPlayingMPM = fullMatchSessions.reduce((sum, s) => {
    return sum + s.metres_per_min * (s.duration_mins / (s.duration_mins - 15));
  }, 0) / fullMatchSessions.length;
  const gpsSessionsWithEst = gpsSessions.map(s => {
    const est = Math.min(90, Math.round(s.distance_m / avgPlayingMPM));
    return { ...s, playing_mins: s.actual_mins ?? est, is_estimate: !s.actual_mins };
  });
  const gpsStats = {
    matches: gpsSessions.length,
    avgDistance: Math.round(gpsSessions.reduce((sum, s) => sum + s.distance_m, 0) / gpsSessions.length),
    topSpeed: Math.max(...gpsSessions.map(s => s.max_speed_kph)),
    avgSprints: Math.round(gpsSessions.reduce((sum, s) => sum + s.sprints, 0) / gpsSessions.length),
    avgHighIntensity: Math.round(gpsSessions.reduce((sum, s) => sum + s.high_intensity, 0) / gpsSessions.length),
  };

  const [dobYear, dobMonth] = profileData.dob.split('-').map(Number);
  const now = new Date();
  let age = now.getFullYear() - dobYear;
  if (now.getMonth() + 1 < dobMonth) age--;

  const allClubs = seasons.flatMap(s => s.clubs);

  const HEADLINE_SEASONS = 2;
  const allMatches = matchesEntry.data.matches;

  function matchSeason(dateStr: string): string {
    const d = new Date(dateStr);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const start = m >= 8 ? y : y - 1;
    return `${start}–${String(start + 1).slice(-2)}`;
  }

  const allMatchSeasons = [...new Set(allMatches.map(m => matchSeason(m.date)))].sort();
  const recentMatchSeasons = allMatchSeasons.slice(-HEADLINE_SEASONS);
  const oldestSeason = recentMatchSeasons[0];
  const newestSeason = recentMatchSeasons[recentMatchSeasons.length - 1];
  const seasonRangeLabel = recentMatchSeasons.length === 1
    ? newestSeason
    : `${oldestSeason} – ${newestSeason}`;

  const headlineMatches = allMatches.filter(m => recentMatchSeasons.includes(matchSeason(m.date)));

  const careerStats = {
    apps: headlineMatches.length,
    goals: headlineMatches.reduce((sum, m) => sum + m.goals, 0),
    assists: headlineMatches.reduce((sum, m) => sum + m.assists, 0),
    gaPerGame: 0,
    clubs: new Set(allClubs.map(c => c.name)).size,
  };
  careerStats.gaPerGame = parseFloat(
    ((careerStats.goals + careerStats.assists) / careerStats.apps).toFixed(2)
  );

  const clubLogos: Record<string, string> = {
    'Bath City U18': `${base}clubs/bath-city.png`,
    'Melksham Town U18': `${base}clubs/melksham-town.png`,
    'Melksham Town Reserves': `${base}clubs/melksham-town.png`,
    'Calne Town Youth U16': `${base}clubs/calne-town.png`,
    'AFC Corsham U15': `${base}clubs/afc-corsham.png`,
    'FC Wilts JPL U15': `${base}clubs/fc-wilts.png`,
    'FC Wilts JPL U16': `${base}clubs/fc-wilts.png`,
    'Wiltshire FA U16': `${base}clubs/wiltshire-fa.png`,
  };

  interface ClubStats {
    name: string;
    league: string;
    apps: number;
    goals: number;
    assists: number;
    mins: number;
    color: string;
    gp90: number;
    ap90: number;
  }
  interface SeasonStats {
    season: string;
    clubs: ClubStats[];
    highlights: string[];
  }

  const seasonsMeta: Record<string, { clubs: Record<string, { league: string; color: string }>; highlights: string[] }> = {};
  for (const s of seasons) {
    seasonsMeta[s.season] = {
      clubs: Object.fromEntries(s.clubs.map(c => [c.name, { league: c.league, color: c.color }])),
      highlights: s.highlights,
    };
  }

  const matchesBySeason: Record<string, Record<string, { apps: number; goals: number; assists: number; mins: number }>> = {};
  for (const m of allMatches) {
    const season = matchSeason(m.date);
    if (!matchesBySeason[season]) matchesBySeason[season] = {};
    if (!matchesBySeason[season][m.team]) matchesBySeason[season][m.team] = { apps: 0, goals: 0, assists: 0, mins: 0 };
    const bucket = matchesBySeason[season][m.team];
    bucket.apps++;
    bucket.goals += m.goals;
    bucket.assists += m.assists;
    bucket.mins += m.mins ?? 0;
  }

  const seasonsWithXG: SeasonStats[] = Object.entries(matchesBySeason)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([season, teams]) => ({
      season,
      highlights: seasonsMeta[season]?.highlights ?? [],
      clubs: Object.entries(teams).map(([name, stats]) => {
        const meta = seasonsMeta[season]?.clubs[name];
        return {
          name,
          league: meta?.league ?? '',
          color: meta?.color ?? '#888',
          ...stats,
          gp90: stats.mins > 0 ? parseFloat(((stats.goals / stats.mins) * 90).toFixed(2)) : 0,
          ap90: stats.mins > 0 ? parseFloat(((stats.assists / stats.mins) * 90).toFixed(2)) : 0,
        };
      }),
    }));

  return {
    profileData,
    keyMatches,
    honours,
    attributes,
    gpsPerformanceSummary,
    gpsSummaryFirstSentence,
    gpsSessionsWithEst,
    gpsStats,
    dobYear,
    dobMonth,
    age,
    careerStats,
    seasonRangeLabel,
    seasonCount: recentMatchSeasons.length,
    clubLogos,
    seasonsWithXG,
  };
}
