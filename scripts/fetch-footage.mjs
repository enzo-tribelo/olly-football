#!/usr/bin/env node
// fetch-footage.mjs — sync footage.yaml with latest YouTube videos from @or9uk
// Keeps the top MAX_VIDEOS most recent, newest first.
// Run: node scripts/fetch-footage.mjs

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

const CHANNEL_URL = 'https://www.youtube.com/@or9uk';
const FOOTAGE_PATH = 'src/content/footage/footage.yaml';
const MAX_VIDEOS = 15;

// Fetch video list via yt-dlp
console.log('Fetching YouTube channel videos...');
let raw;
try {
  raw = execSync(
    `yt-dlp --flat-playlist --print "%(id)s|%(title)s|%(upload_date)s" "${CHANNEL_URL}"`,
    { encoding: 'utf8', timeout: 60000 }
  );
} catch (e) {
  console.error('yt-dlp failed:', e.message);
  process.exit(1);
}

const lines = raw.trim().split('\n').filter(Boolean);
console.log(`Found ${lines.length} videos`);

// Parse existing footage.yaml to get known IDs and metadata
const existing = readFileSync(FOOTAGE_PATH, 'utf8');
const existingIds = new Map();
const idRegex = /- id: "([^"]+)"/g;
const titleRegex = /title: "([^"]+)"/g;
const descRegex = /description: "([^"]+)"/g;
const typeRegex = /type: "([^"]+)"/g;
const dateRegex = /date: "([^"]+)"/g;

// Parse existing entries into a map
const entries = [];
const blocks = existing.split('\n- id:').filter(Boolean);
for (const block of blocks) {
  const idMatch = block.match(/^["\s]*"?([^"\n]+)"?/);
  const titleMatch = block.match(/title: "([^"]+)"/);
  const descMatch = block.match(/description: "([^"]+)"/);
  const typeMatch = block.match(/type: "([^"]+)"/);
  const dateMatch = block.match(/date: "([^"]+)"/);
  if (idMatch && titleMatch) {
    const id = idMatch[1].trim().replace(/^"/, '').replace(/"$/, '');
    entries.push({
      id,
      title: titleMatch[1],
      description: descMatch ? descMatch[1] : '',
      type: typeMatch ? typeMatch[1] : 'match',
      date: dateMatch ? dateMatch[1] : '2024-01-01',
    });
    existingIds.set(id, true);
  }
}

// Build new entries for videos not yet in the file
const newEntries = [];
for (const line of lines) {
  const [id, title] = line.split('|');
  if (!id || !title) continue;
  if (existingIds.has(id)) continue;

  // Skip irrelevant videos
  const skip = ['tree swing', 'bella', 'funny', 'charlie'];
  if (skip.some(s => title.toLowerCase().includes(s))) continue;

  newEntries.push({
    id,
    title: title.replace(/WhatsApp Video \d+ \d+ \d+ at [\d ]+ \d+/, 'Clip').trim(),
    description: 'Bath City U18 · 2025-26',
    type: 'match',
    date: new Date().toISOString().slice(0, 10),
  });
}

console.log(`${newEntries.length} new videos to add`);

// Merge: new first, then existing, cap at MAX_VIDEOS
const merged = [...newEntries, ...entries].slice(0, MAX_VIDEOS);

// Write YAML
const yaml = merged.map(e => `- id: "${e.id}"
  title: "${e.title}"
  description: "${e.description}"
  type: "${e.type}"
  date: "${e.date}"`).join('\n\n') + '\n';

writeFileSync(FOOTAGE_PATH, yaml);
console.log(`Wrote ${merged.length} videos to ${FOOTAGE_PATH}`);
