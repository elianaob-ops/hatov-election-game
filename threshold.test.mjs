import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {testEnv,ownerClient,approvedClient} from './test-support.mjs';

test('only zero or at least four seats are allowed, and totals must equal 120',async()=>{
 const dir=mkdtempSync('/tmp/ballot-threshold-'),dbPath=join(dir,'test.sqlite'),base='http://localhost:3202';
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,...testEnv,PORT:'3202',DB_PATH:dbPath},stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',()=>reject(Error('Server exited')));});
  const owner=await ownerClient(base),member=await approvedClient(base,owner,'threshold-member','חברת הקהילה');
  const {data:game,status}=await owner.call('games',{title:'תוצאות סופיות',parties:['מפלגה א','מפלגה ב','מפלגה ג'],deadline:new Date(Date.now()+60000)});assert.equal(status,201);
  const path='games/'+game.id,profile=(await member.call('auth/session')).data.profile;
  for(const seats of [[0,59,60],[0,61,60],[1,60,60],[2,60,60],[3,57,60],[1,59,60],[2,58,60],[3,57,60],[3.5,56.5,60],[-1,61,60]])assert.equal((await member.call(path+'/guess',{name:'חברת הקהילה',seats})).status,400);
  for(const seats of [[0,60,60],[4,56,60]]){
   assert.equal((await member.call(path+'/guess',{name:'חברת הקהילה',seats})).status,200);
   assert.deepEqual((await member.call(path+'/my-guess',{token:profile.token})).data.seats,seats);
  }
  // Existing forecasts are preserved, including allocations saved under the previous rule.
  let db=new DatabaseSync(dbPath);db.prepare('UPDATE guesses SET seats=? WHERE game=? AND token=?').run('[3,57,60]',game.id,profile.token);db.close();
  assert.deepEqual((await member.call(path+'/my-guess',{token:profile.token})).data.seats,[3,57,60]);
  assert.equal((await member.call(path)).data.leaderboard[0].complete,false);
  assert.equal((await member.call(path+'/guess',{name:'חברת הקהילה',seats:[4,56,60]})).status,200);
  assert.equal((await owner.call(path+'/guess',{name:'אליענה',seats:[0,70,50]})).status,200);
  const before=(await member.call(path)).data;assert.equal(before.count,2);assert.ok(before.leaderboard.every(row=>row.complete));assert.ok(before.leaderboard.every(row=>row.predictionId===undefined));
  db=new DatabaseSync(dbPath);db.prepare('UPDATE games SET deadline=? WHERE id=?').run(Date.now()-1000,game.id);db.close();
  for(const seats of [[0,69,50],[0,71,50],[2,70,50],[1,69,50],[2,68,50],[3,67,50]])assert.equal((await owner.call(path+'/results',{seats})).status,400);
  assert.equal((await owner.call(path+'/results',{seats:[0,70,50]})).status,200);
  let after=(await member.call(path)).data;assert.deepEqual(after.results,[0,70,50]);assert.deepEqual(after.leaderboard.map(row=>row.score),[120,106]);
  const memberRow=after.leaderboard.find(row=>row.name==='חברת הקהילה');
  assert.deepEqual((await owner.call(path+'/predictions/'+memberRow.predictionId)).data.seats,[4,56,60]);
  assert.equal((await owner.call(path+'/results',{seats:[4,56,60]})).status,200);
  after=(await member.call(path)).data;assert.deepEqual(after.results,[4,56,60]);assert.equal(after.leaderboard.find(row=>row.name==='חברת הקהילה').score,120);
  assert.equal(after.leaderboard.find(row=>row.name!=='חברת הקהילה').score,106);
  assert.equal((await member.call(path+'/guess',{name:'חברת הקהילה',seats:[0,60,60]})).status,409);
 }finally{
  if(child.exitCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill();await done;}
  rmSync(dir,{recursive:true,force:true});
 }
});
