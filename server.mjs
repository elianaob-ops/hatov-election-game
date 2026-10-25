import http from 'node:http';
import {communityAuth} from './auth.mjs';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
const db = new DatabaseSync(process.env.DB_PATH || 'game.sqlite');
db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS games(id TEXT PRIMARY KEY, secret TEXT, title TEXT, parties TEXT, deadline INTEGER, results TEXT); CREATE TABLE IF NOT EXISTS guesses(game TEXT, token TEXT, name TEXT, seats TEXT, created INTEGER, PRIMARY KEY(game,token));`);
const key=()=>randomBytes(24).toString('hex');
db.exec('CREATE TABLE IF NOT EXISTS players(token TEXT PRIMARY KEY,name TEXT NOT NULL,created INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS game_cards(game TEXT PRIMARY KEY,cards TEXT NOT NULL); CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);');
db.exec('CREATE TABLE IF NOT EXISTS player_avatars(token TEXT PRIMARY KEY,image_id TEXT UNIQUE NOT NULL,mime TEXT NOT NULL,data BLOB NOT NULL); CREATE TABLE IF NOT EXISTS game_participants(game TEXT NOT NULL,player_token TEXT NOT NULL,joined INTEGER NOT NULL,PRIMARY KEY(game,player_token)); CREATE TABLE IF NOT EXISTS guess_profiles(game TEXT NOT NULL,token TEXT NOT NULL,player_token TEXT NOT NULL,PRIMARY KEY(game,token));');
db.exec('CREATE TABLE IF NOT EXISTS guess_views(game TEXT NOT NULL,guess_token TEXT NOT NULL,public_id TEXT UNIQUE NOT NULL,PRIMARY KEY(game,guess_token));');
const avatarUrl=row=>row?.image_id?'/api/avatars/'+row.image_id:null;
function decodeAvatar(value){
 if(value===null)return null;
 if(typeof value!=='string'||value.length>180000)throw Error('Invalid avatar');
 const match=value.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
 if(!match||match[2].length%4!==0)throw Error('Invalid avatar');
 const data=Buffer.from(match[2],'base64');
 if(data.length>128*1024)throw Error('Avatar too large');
 const valid=match[1]==='png'?data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):match[1]==='jpeg'?data.length>4&&data[0]===255&&data[1]===216&&data[2]===255&&data.at(-2)===255&&data.at(-1)===217:data.length>12&&data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP';
 if(!valid)throw Error('Invalid image');
 return {mime:'image/'+match[1],data};
}
const auth=await communityAuth(db);
const config=JSON.parse(readFileSync(new URL('./public/config.json',import.meta.url)));
const catalog=JSON.parse(readFileSync(new URL('./public/parties.json',import.meta.url)));
const normalize=s=>s.replace(/[\s"\u0027״׳־–-]/g,'').toLowerCase();
const cardFor=name=>catalog.find(p=>[p.name,...p.aliases].some(n=>normalize(n)===normalize(name)))?.id||null;
const isToken=t=>typeof t==='string'&&/^[a-f0-9]{48}$/.test(t);
let lobbyId=db.prepare('SELECT value FROM app_settings WHERE key=?').get('lobby')?.value;
if(!lobbyId){lobbyId='6b15e45d25e5f98673e8d956ee980ae293102138f5721093';db.prepare('INSERT INTO games VALUES(?,?,?,?,?,NULL)').run(lobbyId,key(),config.ballotTitle,JSON.stringify(catalog.map(p=>p.name)),Date.parse(config.deadline));db.prepare('INSERT INTO game_cards VALUES(?,?)').run(lobbyId,JSON.stringify(catalog.map(p=>p.id)));db.prepare('INSERT INTO app_settings VALUES(?,?)').run('lobby',lobbyId);}
// One-time additive migration for the existing lobby and the shared community ballot.
if(!db.prepare('SELECT value FROM app_settings WHERE key=?').get('debbie-brand-deadline-v1')){
 db.prepare('UPDATE games SET title=?,deadline=? WHERE id IN (?,?) OR title=?').run(config.ballotTitle,Date.parse(config.deadline),lobbyId,'6b15e45d25e5f98673e8d956ee980ae293102138f5721093','הקלפי של בול בקלפי');
 db.prepare('INSERT INTO app_settings VALUES(?,?)').run('debbie-brand-deadline-v1','done');
}
// Rename only this community's default ballot and default administrator label.
// Preserve the deadline, participant accounts, approvals, and saved forecasts.
if(!db.prepare('SELECT value FROM app_settings WHERE key=?').get('hatov-family-brand-v1')){
 db.exec('BEGIN IMMEDIATE');
 try{
  db.prepare('UPDATE games SET title=? WHERE id=? AND title=?').run(config.ballotTitle,lobbyId,'הקלפי של הטוב בהתגלמותו');
  db.prepare("UPDATE players SET name=? WHERE name=? AND token IN (SELECT id FROM accounts WHERE role='admin')").run(config.brand,'הטוב בהתגלמותו');
  db.prepare('INSERT INTO app_settings VALUES(?,?)').run('hatov-family-brand-v1','done');
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
export function validSeats(a,n){return Array.isArray(a)&&a.length===n&&a.every(x=>Number.isInteger(x)&&(x===0||(x>=4&&x<=120)))&&a.reduce((s,x)=>s+x,0)===120;}
export const validPrediction=validSeats;
export function score(a,b){return 120-a.reduce((sum,x,i)=>sum+Math.abs(x-b[i]),0)/2;}
function israelDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))return '';
 const [y,m,d,h,min]=value.match(/\d+/g).map(Number),wall=Date.UTC(y,m-1,d,h,min);
 const formatter=new Intl.DateTimeFormat('sv-SE',{timeZone:config.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 let stamp=wall;for(let n=0;n<3;n++){const rendered=formatter.format(new Date(stamp)).replace(' ','T');stamp+=wall-Date.parse(rendered+'Z');}
 return formatter.format(new Date(stamp)).replace(' ','T')===value?new Date(stamp).toISOString():'';
}
const page=readFileSync(new URL('./public/index.html',import.meta.url));
const server=http.createServer(async(req,res)=>{
 const reply=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
 try{
 const url=new URL(req.url,'http://localhost');
 const asset=url.pathname.match(/^\/assets\/((?:characters-[123]|character-pairs|raam-pair|haredi-pair|israel-flag|fingers-crossed|community-icon)\.png|community-icon\.jpg)$/);
 if(asset&&req.method==='GET'){res.writeHead(200,{'Content-Type':asset[1].endsWith('.jpg')?'image/jpeg':'image/png','Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'});return res.end(readFileSync(new URL('./public/assets/'+asset[1],import.meta.url)));}
 if(url.pathname==='/api/health'&&req.method==='GET')return reply(200,{ok:true});
 const staticFiles={'/app.js':'text/javascript; charset=utf-8','/community.js':'text/javascript; charset=utf-8','/style.css':'text/css; charset=utf-8','/parties.json':'application/json; charset=utf-8','/config.json':'application/json; charset=utf-8'};
 if(Object.hasOwn(staticFiles,url.pathname)&&req.method==='GET'){const data=readFileSync(new URL('./public'+url.pathname,import.meta.url));res.writeHead(200,{'Content-Type':staticFiles[url.pathname],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});return res.end(data);}
 if(!url.pathname.startsWith('/api/')){if(req.method!=='GET')return reply(405,{});res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});return res.end(page);}
 if(req.method==='POST'){
 const origin=req.headers.origin,site=req.headers['sec-fetch-site'];
 let sameOrigin=!origin;
 if(origin){try{sameOrigin=new URL(origin).host===req.headers.host;}catch{sameOrigin=false;}}
 if(!sameOrigin||site==='cross-site')return reply(403,{error:'יש לשלוח את הבקשה מתוך האתר'});
 }
 let body={};if(req.method==='POST'){let raw='';const limit=url.pathname==='/api/players'?200000:16000;for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>limit)return reply(413,{error:'הבקשה גדולה מדי'});}body=JSON.parse(raw);}
 if(await auth.route(req,res,url.pathname,body,reply))return;
 const user=auth.userFor(req);
 if(!user)return reply(401,{error:'יש להתחבר עם שם משתמש וסיסמה',code:'login_required'});
 if(user.status!=='approved')return reply(403,{error:'ההרשמה ממתינה לאישור אליענה',code:'approval_required'});
 if(auth.members(req,url.pathname,body,user,reply))return;
 if(url.pathname==='/api/lobby'&&req.method==='GET')return reply(200,{id:lobbyId});
 const avatarMatch=url.pathname.match(/^\/api\/avatars\/([a-f0-9]{48})$/);
 if(avatarMatch&&req.method==='GET'){
 const photo=db.prepare('SELECT mime,data FROM player_avatars WHERE image_id=?').get(avatarMatch[1]);
 if(!photo)return reply(404,{error:'התמונה לא נמצאה'});
 res.writeHead(200,{'Content-Type':photo.mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});return res.end(photo.data);
 }
 if(url.pathname==='/api/players'&&req.method==='POST'){
 if(body.token!==undefined&&body.token!==user.id)return reply(403,{error:'אפשר לערוך רק את הפרופיל שלכם'});
 body.token=user.id;
 const name=typeof body.name==='string'?body.name.trim():'';
 if(name.length<2||name.length>40)return reply(400,{error:'יש להזין שם באורך 2 עד 40 תווים'});
 if(body.gameId!==undefined&&(!isToken(body.gameId)||!db.prepare('SELECT id FROM games WHERE id=?').get(body.gameId)))return reply(400,{error:'התחרות לא נמצאה'});
 const photoChanged=Object.hasOwn(body,'avatar');let photo;
 try{if(photoChanged)photo=decodeAvatar(body.avatar);}catch{return reply(400,{error:'יש לבחור תמונת JPG, PNG או WebP קטנה יותר'});}
 const existing=isToken(body.token)&&db.prepare('SELECT token FROM players WHERE token=?').get(body.token);
 const token=existing?body.token:key();
 db.exec('BEGIN IMMEDIATE');
 try{
 db.prepare('INSERT INTO players VALUES(?,?,?) ON CONFLICT(token) DO UPDATE SET name=excluded.name').run(token,name,Date.now());
 if(photoChanged){if(photo===null)db.prepare('DELETE FROM player_avatars WHERE token=?').run(token);else db.prepare('INSERT INTO player_avatars VALUES(?,?,?,?) ON CONFLICT(token) DO UPDATE SET image_id=excluded.image_id,mime=excluded.mime,data=excluded.data').run(token,key(),photo.mime,photo.data);}
 if(body.gameId)db.prepare('INSERT OR IGNORE INTO game_participants VALUES(?,?,?)').run(body.gameId,token,Date.now());
 db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 const avatar=avatarUrl(db.prepare('SELECT image_id FROM player_avatars WHERE token=?').get(token));
 return reply(existing?200:201,{token,name,avatar});
 }
 if(url.pathname==='/api/games'&&req.method==='POST'){
 if(user.role!=='admin')return reply(403,{error:'רק מנהלת הקהילה יכולה ליצור תחרות'});
 const {title,parties}=body;const deadline=body.deadlineLocal?israelDate(body.deadlineLocal):body.deadline;const end=Date.parse(deadline);
 if(typeof title!=='string'||!title.trim()||title.length>100||!Array.isArray(parties)||parties.length<2||parties.length>40||parties.some(p=>typeof p!=='string'||!p.trim()||p.length>60)||new Set(parties.map(p=>p.trim())).size!==parties.length||!Number.isFinite(end)||end<=Date.now())return reply(400,{error:'יש להזין שם תחרות, לפחות שתי מפלגות שונות ומועד נעילה עתידי'});
 const cards=body.cards??parties.map(cardFor);if(!Array.isArray(cards)||cards.length!==parties.length||cards.some(c=>c!==null&&!catalog.some(p=>p.id===c)))return reply(400,{error:'איורי המפלגות אינם תקינים'});
 const id=key(),secret=key();db.prepare('INSERT INTO games VALUES(?,?,?,?,?,NULL)').run(id,secret,title.trim(),JSON.stringify(parties.map(p=>p.trim())),end);db.prepare('INSERT INTO game_cards VALUES(?,?)').run(id,JSON.stringify(cards));return reply(201,{id,secret});
 }
 const match=url.pathname.match(/^\/api\/games\/([a-f0-9]{48})(?:\/(guess|results|my-guess|predictions\/([a-f0-9]{48})))?$/);if(!match)return reply(404,{error:'לא נמצא'});
 const game=db.prepare('SELECT * FROM games WHERE id=?').get(match[1]);if(!game)return reply(404,{error:'התחרות לא נמצאה'});
 const parties=JSON.parse(game.parties),results=game.results?JSON.parse(game.results):null;
 const predictionsVisible=Date.now()>=game.deadline;
 if(req.method==='GET'&&match[3]){
 if(!predictionsVisible)return reply(403,{error:'אפשר לראות ניחושים של משתתפים אחרים רק אחרי נעילת הניחושים'});
 const prediction=db.prepare(`SELECT COALESCE(p.name,g.name) AS name,g.seats FROM guess_views v JOIN guesses g ON g.game=v.game AND g.token=v.guess_token LEFT JOIN guess_profiles gp ON gp.game=g.game AND gp.token=g.token JOIN players p ON p.token=COALESCE(gp.player_token,g.token) JOIN accounts a ON a.id=p.token WHERE v.game=? AND v.public_id=? AND a.status='approved'`).get(game.id,match[3]);
 if(!prediction)return reply(404,{error:'הניחוש לא נמצא בתחרות'});
 return reply(200,{name:prediction.name,seats:JSON.parse(prediction.seats)});
 }
 if(req.method==='GET'&&!match[2]){
 const rows=db.prepare('SELECT COALESCE(p.name,g.name) AS name,g.seats,g.token,COALESCE(gp.player_token,g.token) AS profile,a.image_id FROM guesses g LEFT JOIN guess_profiles gp ON gp.game=g.game AND gp.token=g.token LEFT JOIN players p ON p.token=COALESCE(gp.player_token,g.token) LEFT JOIN player_avatars a ON a.token=COALESCE(gp.player_token,g.token) WHERE g.game=? AND EXISTS(SELECT 1 FROM accounts ac WHERE ac.id=COALESCE(gp.player_token,g.token) AND ac.status=\'approved\') ORDER BY g.created').all(game.id);
 const savedProfiles=new Set(rows.map(r=>r.profile));
 const leaderboard=rows.map(r=>{
 const selected=JSON.parse(r.seats),complete=validPrediction(selected,parties.length);
 const entry={name:r.name,score:results&&complete?score(selected,results):null,hasGuess:true,complete,avatar:avatarUrl(r)};
 if(predictionsVisible){
 let view=db.prepare('SELECT public_id FROM guess_views WHERE game=? AND guess_token=?').get(game.id,r.token);
 if(!view){view={public_id:key()};db.prepare('INSERT INTO guess_views VALUES(?,?,?)').run(game.id,r.token,view.public_id);}
 entry.predictionId=view.public_id;
 }
 return entry;
 });
 const participants=db.prepare('SELECT p.name,p.token,a.image_id FROM game_participants m JOIN players p ON p.token=m.player_token LEFT JOIN player_avatars a ON a.token=p.token WHERE m.game=? AND EXISTS(SELECT 1 FROM accounts ac WHERE ac.id=p.token AND ac.status=\'approved\') ORDER BY m.joined').all(game.id);
 for(const person of participants)if(!savedProfiles.has(person.token))leaderboard.push({name:person.name,score:null,hasGuess:false,avatar:avatarUrl(person)});
 if(results)leaderboard.sort((a,b)=>(b.score??-1)-(a.score??-1));
 const savedCards=db.prepare('SELECT cards FROM game_cards WHERE game=?').get(game.id);
 return reply(200,{id:game.id,title:game.title,parties,cards:savedCards?JSON.parse(savedCards.cards):parties.map(cardFor),deadline:game.deadline,predictionsVisible,results,count:leaderboard.length,submittedCount:rows.length,leaderboard});
 }
 if(req.method==='POST'&&match[2]==='my-guess'){
 const owned=db.prepare('SELECT token FROM guess_profiles WHERE game=? AND token=? AND player_token=?').get(game.id,body.token,user.id);
 if(body.token!==user.id&&!owned)return reply(403,{error:'אפשר לצפות רק בניחוש שלכם'});
 const ownToken=body.token===user.id?(db.prepare('SELECT token FROM guess_profiles WHERE game=? AND player_token=?').get(game.id,user.id)?.token||user.id):body.token;
 const mine=db.prepare('SELECT name,seats FROM guesses WHERE game=? AND token=?').get(game.id,ownToken);
 return mine?reply(200,{name:mine.name,seats:JSON.parse(mine.seats)}):reply(404,{error:'עדיין לא נשמר ניחוש'});
 }
 if(req.method==='POST'&&match[2]==='guess'){
 if(Date.now()>=game.deadline||results)return reply(409,{error:'התחרות נעולה לניחושים'});
 if(typeof body.name!=='string'||!body.name.trim()||body.name.length>40||!validPrediction(body.seats,parties.length))return reply(400,{error:'יש לבחור 0 או מספר מנדטים שלם בין 4 ל־120, בסכום כולל של 120 בדיוק. למפלגה שלא עוברת את אחוז החסימה בחרו 0.'});
 if(body.playerToken!==undefined&&body.playerToken!==user.id)return reply(403,{error:'אפשר לשמור רק את הניחוש שלכם'});
 const owned=body.token===undefined||body.token===user.id||db.prepare('SELECT token FROM guess_profiles WHERE game=? AND token=? AND player_token=?').get(game.id,body.token,user.id);
 if(!owned)return reply(403,{error:'אפשר לשמור רק את הניחוש שלכם'});
 let token=user.id;
 const profileToken=user.id;
 body.name=user.name;
 const profile=isToken(profileToken)&&db.prepare('SELECT token FROM players WHERE token=?').get(profileToken);
 if(body.playerToken!==undefined&&!profile)return reply(400,{error:'יש להשלים את ההרשמה לפני שמירת הניחוש'});
 if(profile){const prior=db.prepare('SELECT token FROM guess_profiles WHERE game=? AND player_token=?').get(game.id,profileToken)||db.prepare('SELECT token FROM guesses WHERE game=? AND token=?').get(game.id,profileToken);if(prior)token=prior.token;}
 db.exec('BEGIN IMMEDIATE');
 try{
 db.prepare('INSERT INTO guesses VALUES(?,?,?,?,?) ON CONFLICT(game,token) DO UPDATE SET name=excluded.name,seats=excluded.seats').run(game.id,token,body.name.trim(),JSON.stringify(body.seats),Date.now());
 if(profile){db.prepare('INSERT INTO guess_profiles VALUES(?,?,?) ON CONFLICT(game,token) DO UPDATE SET player_token=excluded.player_token').run(game.id,token,profileToken);db.prepare('INSERT OR IGNORE INTO game_participants VALUES(?,?,?)').run(game.id,profileToken,Date.now());}
 db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 return reply(200,{token});
 }
 if(req.method==='POST'&&match[2]==='results'){
 if(user.role!=='admin')return reply(403,{error:'הפעולה מיועדת למנהלת בלבד'});
 if(Date.now()<game.deadline)return reply(409,{error:'ניתן לפרסם תוצאות רק אחרי מועד הנעילה'});
 if(!validPrediction(body.seats,parties.length))return reply(400,{error:'יש להזין 0 או מספר מנדטים שלם בין 4 ל־120, בסכום כולל של 120 בדיוק'});
 db.prepare('UPDATE games SET results=? WHERE id=?').run(JSON.stringify(body.seats),game.id);return reply(200,{ok:true});
 }return reply(405,{error:'פעולה לא נתמכת'});
 }catch(e){reply(400,{error:'לא ניתן להשלים את הבקשה'});}
});
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Election game listening'));
