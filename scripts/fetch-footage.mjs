#!/usr/bin/env node
// fetch-footage.mjs — sync footage.yaml with latest YouTube videos from @or9uk
// Takes the top MAX_VIDEOS from the channel (YouTube returns newest first).
// Preserves existing metadata (title, description, type, date) for known IDs.
// Run: node scripts/fetch-footage.mjs

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

const CHANNEL_URL = 'https://www.youtube.com/@or9uk/videos';
const FOOTAGE_PATH = 'src/content/footage/footage.yaml';
const MAX_VIDEOS = 5;

// Skip irrelevant videos
const SKIP_KEYWORDS = ['tree swing', 'bella', 'funny', 'charlie'];

// Fetch video list via yt-dlp (channel returns newest first)
console.log('Fetching YouTube channel videos...');
let raw;
try {
  raw = execSync(
    `yt-dlp --flat-playlist --print "%(id)s|%(title)s" "${CHANNEL_URL}"`,
    { encoding: 'utf8', timeout: 60000 }
  );
} catch (e) {
  console.error('yt-dlp failed:', e.message);
  process.exit(1);
}

const channelVideos = raw.trim().split('\n')
  .filter(Boolean)
  .map(line => {
    const [id, ...titleParts] = line.split('|');
    return { id: id.trim(), title: titleParts.join('|').trim() };
  })
  .filter(v => v.id && v.title)
  .filter(v => !SKIP_KEYWORDS.some(k => v.title.toLowerCase().includes(k)));

console.log(`Found ${channelVideos.length} eligible videos`);

// Parse existing footage.yaml to preserve metadata for known IDs
const existing = readFileSync(FOOTAGE_PATH, 'utf8');
const existingMap = new Map();
let current = null;
for (const line of existing.split('\n')) {
  const idMatch = line.match(/^- id:\s+"([^"]+)"/);
  const titleMatch = line.match(/^\s+title:\s+"([^"]+)"/);
  const descMatch = line.match(/^\s+description:\s+"([^"]+)"/);
  const typeMatch = line.match(/^\s+type:\s+"([^"]+)"/);
  const dateMatch = line.match(/^\s+date:\s+"([^"]+)"/);
  if (idMatch) {
    current = { id: idMatch[1], title: '', description: 'Bath City U18 · 2025-26', type: 'match', date: new Date().toISOString().slice(0, 10) };
    existingMap.set(idMatch[1], current);
  } else if (current) {
    if (titleMatch) current.title = titleMatch[1];
    if (descMatch) current.description = descMatch[1];
    if (typeMatch) current.type = typeMatch[1];
    if (dateMatch) current.date = dateMatch[1];
  }
}

// Take top MAX_VIDEOS from channel, preserving existing metadata where available
const result = channelVideos.slice(0, MAX_VIDEOS).map(v => {
  const existing = existingMap.get(v.id);
  return existing || {
    id: v.id,
    title: v.title,
    description: 'Bath City U18 · 2025-26',
    type: 'match',
    date: new Date().toISOString().slice(0, 10),
  };
});

// Write YAML
const yaml = result.map(e => `- id: "${e.id}"
  title: "${e.title}"
  description: "${e.description}"
  type: "${e.type}"
  date: "${e.date}"`).join('\n\n') + '\n';

writeFileSync(FOOTAGE_PATH, yaml);
console.log(`Wrote ${result.length} videos to ${FOOTAGE_PATH} (newest first)`);
