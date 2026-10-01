import fs from 'node:fs';

const html=fs.readFileSync('public/index.html','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const idList=[...html.matchAll(/\bid=["']([^"']+)["']/g)].map(m=>m[1]);
const duplicateIds=[...new Set(idList.filter((id,i)=>idList.indexOf(id)!==i))];
if(duplicateIds.length){console.error('Duplicate DOM ids:',duplicateIds.join(', '));process.exit(1);}
const econTabs=[...html.matchAll(/class=["'][^"']*\beconTab\b[^"']*["'][^>]*data-tab=["']([^"']+)["']/g)].map(m=>m[1]);
const duplicateEconTabs=[...new Set(econTabs.filter((tab,i)=>econTabs.indexOf(tab)!==i))];
if(duplicateEconTabs.length){console.error('Duplicate economy tabs:',duplicateEconTabs.join(', '));process.exit(1);}
if(/друзья слышат тебя|Живой голос игрока слышат остальные/.test(html)){console.error('UI claims continuous party voice that runtime does not implement');process.exit(1);}

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
const staticButtonIds=[...html.matchAll(/<button[^>]*\bid=["']([^"']+)["'][^>]*>/g)].map(m=>m[1]);
const unhandledButtons=staticButtonIds.filter(id=>!app.includes("'#"+id+"'")&&!app.includes('"#'+id+'"')&&!app.includes("getElementById('"+id+"')")&&!app.includes('getElementById("'+id+'")'));
if(unhandledButtons.length){console.error('Static button ids without client wiring:',unhandledButtons.join(', '));process.exit(1);}

for(const required of ['server.mjs','public/app.js','public/style.css','public/index.html']){
  if(!fs.existsSync(required)){console.error('Missing source:',required);process.exit(1);}
}
console.log('UI contract PASS:',refs.length,'selector references checked');
