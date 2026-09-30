import fs from 'node:fs';

const html=fs.readFileSync('public/index.html','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const idList=[...html.matchAll(/\bid=["']([^"']+)["']/g)].map(m=>m[1]);
const duplicateIds=[...new Set(idList.filter((id,i)=>idList.indexOf(id)!==i))];
if(duplicateIds.length){console.error('Duplicate DOM ids:',duplicateIds.join(', '));process.exit(1);}
const ids=new Set(idList);
const dynamic=new Set(['sellPrice','sellItem','equipItem','genItemVisual']);
const refs=[...app.matchAll(/\$\(\s*['"]#([A-Za-z0-9_-]+)['"]\s*\)/g)].map(m=>m[1]);
const missing=[...new Set(refs.filter(id=>!ids.has(id)&&!dynamic.has(id)))];
if(missing.length){
  console.error('Client references missing DOM ids:',missing.join(', '));
  process.exit(1);
}
const badForEach=app.split('\n').filter(line=>/(^|[^$])\$\([^\n]+\)\.forEach\s*\(/.test(line));
if(badForEach.length){
  console.error('querySelector(...).forEach detected; use $$ for collections:');
  for(const line of badForEach)console.error(line.trim());
  process.exit(1);
}
for(const required of ['server.mjs','public/app.js','public/style.css','public/index.html']){
  if(!fs.existsSync(required)){console.error('Missing source:',required);process.exit(1);}
}
console.log('UI contract PASS:',refs.length,'selector references checked');
