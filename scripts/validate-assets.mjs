import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const release = process.argv.includes('--release');
const manifestPath = path.join(root, 'public', 'audio', 'music_manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
let failed = false;

for (const [state, entry] of Object.entries(manifest)) {
  if (!state || !entry || typeof entry.file !== 'string' || !/^audio\/[a-z0-9_/-]+\.mp3$/i.test(entry.file)) {
    console.error(`Invalid audio manifest entry: ${state}`); failed = true; continue;
  }
  const filePath = path.join(root, 'public', entry.file);
  if (release && (!fs.existsSync(filePath) || fs.statSync(filePath).size < 1024)) {
    console.error(`Missing audio for state ${state}: ${entry.file}`);
    failed = true;
  }
}

const requiredAssets = [
  ...(release ? ['public/assets/menu_world.jpg',
  'public/assets/lobby_tavern.jpg',
  'public/assets/character_creator.jpg',
  'public/assets/game_harbor.jpg',
  'public/assets/gm_tavern.jpg'] : []),
  'data/scenarios.json',
  'data/config.example.json'
];

for (const rel of requiredAssets) {
  if (!fs.existsSync(path.join(root, rel)) || release && /\.(jpg|mp3)$/i.test(rel) && fs.statSync(path.join(root, rel)).size < 1024) {
    console.error(`Missing required asset: ${rel}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`Validated ${Object.keys(manifest).length} adaptive music states (${release?'release media':'source schema'}) and ${requiredAssets.length} required files.`);
