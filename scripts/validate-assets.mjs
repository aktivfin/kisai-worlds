import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifestPath = path.join(root, 'public', 'audio', 'music_manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
let failed = false;

for (const [state, entry] of Object.entries(manifest)) {
  const filePath = path.join(root, 'public', entry.file);
  if (!fs.existsSync(filePath)) {
    console.error(`Missing audio for state ${state}: ${entry.file}`);
    failed = true;
  }
}

const requiredAssets = [
  'public/assets/menu_world.jpg',
  'public/assets/lobby_tavern.jpg',
  'public/assets/character_creator.jpg',
  'public/assets/game_harbor.jpg',
  'public/assets/gm_tavern.jpg',
  'data/scenarios.json',
  'data/config.example.json'
];

for (const rel of requiredAssets) {
  if (!fs.existsSync(path.join(root, rel))) {
    console.error(`Missing required asset: ${rel}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`Validated ${Object.keys(manifest).length} adaptive music states and ${requiredAssets.length} required assets.`);
