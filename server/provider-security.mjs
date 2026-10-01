import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export function privateAddress(address) {
  const ip=address.toLowerCase().replace(/^::ffff:/,'');
  if(ip.includes(':')) return ip==='::1'||ip==='::'||ip.startsWith('fc')||ip.startsWith('fd')||/^fe[89ab]/.test(ip)||ip.startsWith('2001:db8:');
  const parts=ip.split('.').map(Number);
  if(parts.length!==4||parts.some(x=>x<0||x>255||!Number.isInteger(x)))return true;
  const [a,b]=parts;
  return a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===192&&b===0||a===198&&b>=18&&b<=19;
}
export async function validateProviderUrl(input,{allowPrivate=false}={}) {
  let url;
  try { url=new URL(input); } catch { throw new Error('invalid_provider_url'); }
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||!url.hostname)throw new Error('invalid_provider_url');
  if(!allowPrivate) {
    if(url.hostname==='localhost'||url.hostname.endsWith('.localhost'))throw new Error('private_provider_url');
    const addresses=isIP(url.hostname)?[{address:url.hostname}]:await lookup(url.hostname,{all:true});
    if(!addresses.length||addresses.some(x=>privateAddress(x.address)))throw new Error('private_provider_url');
  }
  return url.toString().replace(/\/$/,'');
}
export async function providerFetch(url,options={},settings={}) {
  await validateProviderUrl(url,settings);
  if(active>=4)throw new Error('provider_busy');
  active++;const started=Date.now();
  try {
    for(let attempt=0;attempt<2;attempt++){
      const response=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(12000)});
      if(![429,502,503,504].includes(response.status)||attempt===1){
        console.log(JSON.stringify({event:'provider_request',status:response.status,durationMs:Date.now()-started}));
        return response;
      }
      await response.body?.cancel();await new Promise(resolve=>setTimeout(resolve,200));
    }
  } catch(error){console.warn(JSON.stringify({event:'provider_error',code:error.name||'provider_error',durationMs:Date.now()-started}));throw error}
  finally {active--}
}
let active=0;
