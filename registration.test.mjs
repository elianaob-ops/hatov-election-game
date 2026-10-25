import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {testEnv,client,ownerClient,approvedClient} from './test-support.mjs';
test('profiles, private images, all approved participants, persistence and fail-closed setup',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ballot-registration-')),base='http://localhost:3200',dbPath=join(dir,'test.sqlite');let child;
 const start=async(env=testEnv)=>{child=spawn(process.execPath,['server.mjs'],{env:{...process.env,COMMUNITY_ADMIN_USER:'',COMMUNITY_ADMIN_PASSWORD:'',...env,PORT:'3200',DB_PATH:dbPath},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',()=>reject(Error('Server exited before readiness')));});};
 const stop=async()=>{if(child&&child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}};
 try{
 await start();const owner=await ownerClient(base);
 const usernameOnly=client(base);const signup=await usernameOnly.call('auth/register',{username:'username-only',password:'username-only-password'});assert.equal(signup.status,201);assert.equal(signup.data.user.name,'username-only');assert.equal(signup.data.user.status,'pending');assert.equal((await usernameOnly.call('lobby')).status,403);
 const noa=await approvedClient(base,owner,'noa','נועה'),friend=await approvedClient(base,owner,'uri','אורי');
 const lobby=(await owner.call('lobby')).data,g=(await noa.call('games/'+lobby.id)).data,path='games/'+lobby.id;
 assert.equal(g.parties.length,14);assert.ok(g.parties.includes('הציבור החרדי'));assert.ok(g.parties.includes('ביחד'));assert.equal(g.cards.filter(x=>x==='raam').length,1);
 const registered=(await noa.call('players',{name:'  נועה  ',gameId:lobby.id})).data;assert.equal(registered.name,'נועה');assert.match(registered.token,/^[a-f0-9]{48}$/);
 const seats=g.parties.map(()=>0);seats[0]=120;
 assert.equal((await noa.call(path+'/guess',{name:'נועה',token:registered.token,seats})).status,200);
 assert.deepEqual((await noa.call(path+'/my-guess',{token:registered.token})).data.seats,seats);
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKVEAAAAASUVORK5CYII=';
 const peer=(await friend.call('players',{name:'אורי',gameId:lobby.id,avatar:png})).data;
 assert.match(peer.avatar,/^\/api\/avatars\/[a-f0-9]{48}$/);assert.equal(peer.avatar.includes(peer.token),false);
 let image=await friend.request(peer.avatar);assert.equal(image.status,200);assert.equal(image.headers.get('cache-control'),'private, no-store');assert.deepEqual(Buffer.from(await image.arrayBuffer()),Buffer.from(png.split(',')[1],'base64'));
 assert.equal((await client(base).request(peer.avatar)).status,401);
 const withFriend=(await noa.call(path)).data;assert.equal(withFriend.count,2);assert.equal(withFriend.submittedCount,1);assert.equal(withFriend.leaderboard.find(r=>r.name==='אורי').hasGuess,false);
 for(const avatar of ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=','https://example.com/tracker.png'])assert.equal((await friend.call('players',{name:'אורי',avatar})).status,400);
 assert.equal((await friend.call('players',{name:'אורי'})).data.avatar,peer.avatar);
 assert.equal((await friend.call('players',{name:'אורי',avatar:null})).data.avatar,null);assert.equal((await friend.request(peer.avatar)).status,404);
 const photo=(await friend.call('players',{name:'אורי',avatar:png})).data.avatar;
 const custom=(await owner.call('games',{title:'תחרות פרטית',parties:['חדש','נוסף'],cards:['raam',null],deadline:new Date(Date.now()+60000)})).data;
 assert.equal((await friend.call('games/'+custom.id)).data.count,0);
 await stop();
 // Simulate an existing database needing the branding migration; guesses must survive.
 const db=new DatabaseSync(dbPath);db.prepare("DELETE FROM app_settings WHERE key='debbie-brand-deadline-v1'").run();db.prepare('UPDATE games SET title=?,deadline=? WHERE id=?').run('הקלפי של בול בקלפי',Date.now()+500000,lobby.id);const hash=db.prepare("SELECT password_hash FROM accounts WHERE username='noa'").get().password_hash;assert.equal(hash.includes('test-member-password-42'),false);const oldPlayer='a'.repeat(48),oldGuess='b'.repeat(48);db.prepare('INSERT INTO players VALUES(?,?,?)').run(oldPlayer,'שם ישן',Date.now());db.prepare('INSERT INTO guesses VALUES(?,?,?,?,?)').run(lobby.id,oldGuess,'שם ישן',JSON.stringify(seats),Date.now());db.prepare('INSERT INTO guess_profiles VALUES(?,?,?)').run(lobby.id,oldGuess,oldPlayer);db.close();
 await start();assert.equal((await noa.call('lobby')).data.id,lobby.id);assert.equal((await noa.call(path)).data.title,'הקלפי של הטוב בהתגלמותו');assert.deepEqual((await noa.call(path+'/my-guess',{token:registered.token})).data.seats,seats);assert.equal((await friend.request(photo)).status,200);assert.equal((await noa.call(path)).data.count,2);
 const returning=client(base);assert.equal((await returning.call('auth/register',{username:'returning',name:'חבר ותיק',password:'returning-password-42',legacyToken:oldPlayer})).status,201);assert.equal((await returning.call(path)).status,403);const oldMember=(await owner.call('admin/members')).data.members.find(m=>m.username==='returning');await owner.call('admin/members/'+oldMember.id,{status:'approved'});assert.equal((await returning.call('auth/session')).data.profile.token,oldPlayer);assert.deepEqual((await returning.call(path+'/my-guess',{token:oldPlayer})).data.seats,seats);assert.equal((await returning.call(path+'/guess',{name:'חבר ותיק',token:oldPlayer,seats})).data.token,oldGuess);assert.equal((await returning.call(path)).data.count,3);
 const freshLogin=client(base);assert.equal((await freshLogin.call('auth/login',{username:'noa',password:'test-member-password-42'})).status,200);assert.equal((await freshLogin.call('auth/session')).data.profile.token,registered.token);
 await stop();await start({});assert.equal((await client(base).call('auth/session')).data.configured,false);assert.equal((await noa.call(path)).status,401);assert.equal((await noa.call('auth/login',{username:'noa',password:'test-member-password-42'})).status,503);
 }finally{await stop();rmSync(dir,{recursive:true,force:true});}
});
