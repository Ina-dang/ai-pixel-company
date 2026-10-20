import { randomUUID } from 'node:crypto';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readdir, lstat, unlink, rmdir, rm, link, symlink, realpath, access } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, afterAll, afterEach, expect, test } from 'vitest';
import { VoiceRecoveryHost, nativeSpeechArguments, type VoiceOwner } from '../apps/api/src/voice-recovery.js';

let root='',exe='',host:VoiceRecoveryHost,owner:VoiceOwner;
const children:ChildProcess[]=[];
const quote=(value:string)=>`'${value.replaceAll("'","''")}'`;
beforeAll(async()=>{
  root=await mkdtemp(path.resolve('.local/voice-native-test-'));expect(root.startsWith(path.resolve('.local')+path.sep)).toBe(true);
  exe=path.join(root,'.local/voice-runtime/bin/Release/whisper-cli.exe');await mkdir(path.dirname(exe),{recursive:true});
  // Non-billable native stub tests the Windows termination boundary, not speech accuracy.
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; Add-Type -OutputAssembly ${quote(exe)} -OutputType ConsoleApplication -TypeDefinition 'public class PixelVoiceFixture { public static void Main(string[] args) { System.Threading.Thread.Sleep(600000); } }'`],{windowsHide:true,timeout:15000,stdio:'pipe'});
  host=new VoiceRecoveryHost(root,exe);owner=await host.identity();
},30000);
async function stop(child:ChildProcess){if(child.exitCode!==null||child.signalCode!==null)return;const closed=once(child,'close');child.kill();await closed;}
afterEach(async()=>{for(const child of children.splice(0))await stop(child);const base=path.join(root,'.local/voice-temp');for(const entry of await readdir(base,{withFileTypes:true}).catch(()=>[])){const target=path.join(base,entry.name);if(entry.isSymbolicLink()){await unlink(target);continue;}for(const file of await readdir(target))await unlink(path.join(target,file));await rmdir(target);}});
afterAll(async()=>{if(root){expect(path.resolve(await realpath(root)).toLowerCase()).toBe(path.resolve(root).toLowerCase());expect(root.startsWith(path.resolve('.local')+path.sep)).toBe(true);await rm(root,{recursive:true,force:true});}});
async function input(write=true){const id=randomUUID(),directory=path.join(root,'.local/voice-temp',id);await mkdir(directory,{recursive:true});if(write)await writeFile(path.join(directory,'audio.wav'),'public fixture bytes');return{id,directory,file:path.join(directory,'audio.wav')};}
async function native(id:string,change=false){const args=nativeSpeechArguments(root,id);if(change)args[7]='1';const child=spawn(exe,args,{windowsHide:true,stdio:'ignore'});children.push(child);await once(child,'spawn');return child;}
const stale=()=>({...owner,created:(BigInt(owner.created)+1n).toString()});
test('live owner protects both native process and audio file',async()=>{const v=await input(),child=await native(v.id);const result=await host.recover(v.id,owner);expect(result.state).toBe('OWNER_ALIVE');expect(child.exitCode).toBeNull();await access(v.file);},20000);
test('reused owner PID cannot kill the new owner and exact orphan native closes before deletion',async()=>{const v=await input();await native(v.id);const result=await host.recover(v.id,stale());expect(result).toMatchObject({state:'RECOVERED',stopped:1,filesDeleted:1,automaticReplay:false});expect(()=>process.kill(process.pid,0)).not.toThrow();await expect(lstat(v.directory)).rejects.toMatchObject({code:'ENOENT'});},20000);
test('dead owner with already exited native has its exact UUID file removed',async()=>{const v=await input();const result=await host.recover(v.id,stale());expect(result).toMatchObject({state:'RECOVERED',stopped:0,filesDeleted:1});},20000);
test('a command argument mismatch preserves a running process and its file',async()=>{const v=await input(),child=await native(v.id,true);const result=await host.recover(v.id,stale());expect(result.state).toBe('BLOCKED');expect(child.exitCode).toBeNull();await access(v.file);},20000);
test('wrong host receipt cannot remove a file',async()=>{const v=await input();const result=await host.recover(v.id,{...stale(),hostId:randomUUID()});expect(result.state).toBe('BLOCKED');await access(v.file);});
test('unexpected files preserve the entire directory',async()=>{const v=await input();await writeFile(path.join(v.directory,'unrelated.txt'),'must survive');const result=await host.recover(v.id,stale());expect(result.state).toBe('BLOCKED');await access(path.join(v.directory,'unrelated.txt'));await access(v.file);});
test('hard linked audio is never deleted by recovery',async()=>{const v=await input(false),witness=path.join(root,'hardlink-witness');await writeFile(witness,'must survive');await link(witness,v.file);try{expect((await host.recover(v.id,stale())).state).toBe('BLOCKED');await access(witness);await access(v.file);}finally{await unlink(witness);}});
test('junctions are rejected without touching their target',async()=>{const witness=path.join(root,'junction-witness');await mkdir(witness);await writeFile(path.join(witness,'sentinel'),'must survive');const id=randomUUID(),target=path.join(root,'.local/voice-temp',id);await mkdir(path.dirname(target),{recursive:true});await symlink(witness,target,'junction');expect((await host.recover(id,stale())).state).toBe('BLOCKED');await expect(host.temporaryIds()).rejects.toThrow();await access(path.join(witness,'sentinel'));});
