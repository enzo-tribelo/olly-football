import { defineCollection, z } from 'astro:content';

const profileCollection = defineCollection({
  type: 'data',
  schema: z.object({
    name: z.string(),
    dob: z.string(), // YYYY-MM format (e.g. "2009-07")
    height: z.string(),
    weight: z.string(),
    foot: z.string(),
    position: z.string(),
    location: z.string(),
    nationality: z.string(),
    current_clubs: z.array(z.string()),
    socials: z.object({
      instagram: z.string(),
      x: z.string(),
    }),
  }),
});

const seasonsCollection = defineCollection({
  type: 'data',
  schema: z.object({
    season: z.string(),
    clubs: z.array(
      z.object({
        name: z.string(),
        league: z.string(),
        apps: z.number(),
        goals: z.number(),
        assists: z.number(),
        mins: z.number(),
        color: z.string(),
      })
    ),
    highlights: z.array(z.string()),
  }),
});

const matchesCollection = defineCollection({
  type: 'data',
  schema: z.object({
    matches: z.array(
      z.object({
        date: z.string(),
        match: z.string(),
        result: z.string(),
        goals: z.number(),
        assists: z.number(),
        standout: z.boolean().default(true),
      })
    ),
  }),
});

const honoursCollection = defineCollection({
  type: 'data',
  schema: z.object({
    honours: z.array(
      z.object({
        year: z.string(),
        title: z.string(),
        org: z.string(),
      })
    ),
  }),
});

const attributesCollection = defineCollection({
  type: 'data',
  schema: z.object({
    attributes: z.array(
      z.object({
        name: z.string(),
        rating: z.number().min(1).max(10),
        note: z.string(),
      })
    ),
  }),
});

const gpsCollection = defineCollection({
  type: 'data',
  schema: z.object({
    sessions: z.array(
      z.object({
        date: z.string(),
        match: z.string(),
        session_id: z.string(),
        duration_mins: z.number(),
        has_data: z.boolean(),
        // Core
        distance_m: z.number(),
        max_speed_kph: z.number(),
        avg_speed_kph: z.number(),
        metres_per_min: z.number(),
        // Sprints & runs
        sprints: z.number(),
        sprint_distance_m: z.number(),
        high_intensity: z.number(),
        high_intensity_distance_m: z.number(),
        high_speed_run_events: z.number(),
        high_speed_distance_m: z.number(),
        // Acceleration
        accelerations: z.number(),
        decelerations: z.number(),
        max_acceleration: z.number(),
        max_deceleration: z.number(),
        // Speed zones
        zone_sprint_distance_m: z.number(),
        zone_sprint_duration_s: z.number(),
        zone_sprint_events: z.number(),
        zone_hs_running_distance_m: z.number(),
        zone_hs_running_duration_s: z.number(),
        zone_hs_running_events: z.number(),
        zone_high_intensity_distance_m: z.number(),
        zone_high_intensity_duration_s: z.number(),
        zone_high_intensity_events: z.number(),
        zone_medium_distance_m: z.number(),
        zone_medium_duration_s: z.number(),
        zone_low_distance_m: z.number(),
        zone_low_duration_s: z.number(),
        zone_jogging_distance_m: z.number(),
        zone_jogging_duration_s: z.number(),
        // Workload
        workload: z.number(),
        workload_intensity: z.number(),
      })
    ),
  }),
});

export const collections = {
  profile: profileCollection,
  seasons: seasonsCollection,
  matches: matchesCollection,
  honours: honoursCollection,
  attributes: attributesCollection,
  gps: gpsCollection,
};
