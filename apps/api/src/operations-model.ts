import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {join,relative} from 'node:path';

export type WorkerHealth={running:boolean;busy:boolean;lastTickAt:string|null;lastErrorAt:string|null};
export type Probe={ready:boolean;code:string|null;checkedAt:string;activeContainers?:number;orphanedContainers?:number};
export type HealthProbes={provider:Probe;sandbox:Probe;workers:Record<string,WorkerHealth>};
export type AlertCondition={key:string;severity:'WARNING'|'CRITICAL';messageKo:string;evidence:Record<string,unknown>};
export const safeCode=(value:unknown,fallback='UNVERIFIABLE')=>typeof value==='string'&&/^[A-Z0-9_]{1,80}$/.test(value)?value:fallback;
export const sha256=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');

// Route labels never include a user supplied path, query string, body or header.
export function routeLabel(path:string){
  if(/^\/health(?:\/(?:live|ready))?$/.test(path))return path;
  const normalized=path.replace(/[a-f0-9]{8}-[a-f0-9-]{27}/gi,':id');
  return /^\/api\/v1\/(?:auth\/session|me|subscription|projects(?:\/:id)?(?:\/(?:snapshot|tasks|operations|reviews|integrations|staffing|execution-policy|lifecycle|dependencies\/(?:add|remove)))?|tasks\/:id(?:\/runs)?|runs\/:id(?:\/(?:control|acceptance))?|events\/stream|operations(?:\/(?:alerts|backups|jobs|control|notifications|drill|release))?)$/.test(normalized)?normalized:'OTHER';
}
export class RequestMetrics{
  private rows:{at:number;ms:number;status:number;route:string}[]=[];
  private streams=0;private rejectedStreams=0;private slowStreams=0;
  record(path:string,status:number,ms:number){this.rows.push({at:Date.now(),ms:Math.max(0,ms),status,route:routeLabel(path)});if(this.rows.length>1000)this.rows.shift();}
  openStream(){if(this.streams>=10){this.rejectedStreams++;return false;}this.streams++;return true;}
  closeStream(){this.streams=Math.max(0,this.streams-1);}
  slowStream(){this.slowStreams++;}
  snapshot(now=Date.now()){
    const rows=this.rows.filter(r=>r.at>=now-60000),latencies=rows.map(r=>r.ms).sort((a,b)=>a-b);
    return{windowMs:60000,sampleLimit:1000,samples:rows.length,errors5xx:rows.filter(r=>r.status>=500).length,
      p95Ms:latencies.length?Math.round(latencies[Math.ceil(latencies.length*.95)-1]):null,
      activeStreams:this.streams,maxStreams:10,rejectedStreams:this.rejectedStreams,slowStreams:this.slowStreams};
  }
}
export async function sourceDigest(root:string){
  const files:string[]=[];
  async function walk(path:string){for(const e of await readdir(path,{withFileTypes:true})){if(e.isSymbolicLink())throw new Error('SOURCE_LINK_DENIED');if(['node_modules','dist','.next','.turbo','__pycache__'].includes(e.name))continue;const p=join(path,e.name);if(e.isDirectory())await walk(p);else if(/\.(?:ts|tsx|sql|json|mjs|css|py|ps1)$/.test(e.name))files.push(p);}}
  for(const name of ['apps','packages','scripts','tests'])await walk(join(root,name));
  const rows=[];for(const file of files.sort())rows.push([relative(root,file).replaceAll('\\','/'),sha256((await readFile(file,'utf8')).replaceAll('\r\n','\n'))]);
  return sha256(JSON.stringify(rows));
}
