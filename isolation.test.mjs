import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {testEnv,client,ownerClient,approvedClient} from './test-support.mjs';

test('separate deployments do not share accounts, approval, sessions, or guesses',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'community-isolation-')),children=[];
 const start=async(port,database)=>{
  const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,...testEnv,PORT:String(port),DB_PATH:join(dir,database)},stdio:['ignore','pipe','pipe']});
  children.push(child);
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',()=>reject(Error('Test server exited')));});
  return 'http://localhost:'+port;
 };
 try{
  const first=await start(3210,'first.sqlite'),second=await start(3211,'second.sqlite');
  const ownerA=await ownerClient(first),ownerB=await ownerClient(second);
  const memberA=await approvedClient(first,ownerA,'same-member','חברה בקהילה');
  const lobbyA=(await memberA.call('lobby')).data,lobbyB=(await ownerB.call('lobby')).data;
  const gameA=(await memberA.call('games/'+lobbyA.id)).data;
  const seats=gameA.parties.map((_,i)=>i===0?120:0);
  assert.equal((await memberA.call('games/'+lobbyA.id+'/guess',{name:'חברה בקהילה',seats})).status,200);
  assert.equal((await memberA.call('games/'+lobbyA.id)).data.count,1);
  assert.equal((await ownerB.call('games/'+lobbyB.id)).data.count,0);
  assert.equal((await ownerB.call('admin/members')).data.members.length,0);
  assert.equal((await client(second,memberA.cookie).call('lobby')).status,401);
  assert.equal((await client(second,ownerA.cookie).call('admin/members')).status,401);
  const memberB=client(second);
  assert.equal((await memberB.call('auth/login',{username:'same-member',password:'test-member-password-42'})).status,401);
  assert.equal((await memberB.call('auth/register',{username:'same-member',password:'test-member-password-42'})).status,201);
  assert.equal((await memberB.call('auth/session')).data.user.status,'pending');
  assert.equal((await memberB.call('lobby')).status,403);
  const request=(await ownerB.call('admin/members')).data.members.find(m=>m.username==='same-member');
  assert.equal((await ownerB.call('admin/members/'+request.id,{status:'approved'})).status,200);
  assert.equal((await memberB.call('games/'+lobbyB.id)).data.count,0);
  const profileB=(await memberB.call('auth/session')).data.profile;
  assert.equal((await memberB.call('games/'+lobbyB.id+'/my-guess',{token:profileB.token})).status,404);
  assert.equal((await ownerA.call('admin/members')).data.members.find(m=>m.username==='same-member').status,'approved');
  assert.equal((await ownerB.call('admin/members/'+request.id,{status:'rejected'})).status,200);
  assert.equal((await memberA.call('games/'+lobbyA.id)).status,200);
  assert.equal((await memberB.call('games/'+lobbyB.id)).status,401);
 }finally{
  for(const child of children)if(child.exitCode===null){const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill();await stopped;}
  rmSync(dir,{recursive:true,force:true});
 }
});
