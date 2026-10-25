import {randomBytes,createHash,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback);
const key=()=>randomBytes(24).toString('hex');
const digest=value=>createHash('sha256').update(value).digest('hex');
const normalize=value=>typeof value==='string'?value.trim().toLowerCase():'';
const validUsername=value=>/^[a-z0-9][a-z0-9._-]{2,39}$/.test(value);
const validPassword=value=>typeof value==='string'&&value.length>=10&&value.length<=128;
async function passwordHash(password){const salt=key();return salt+':'+(await scrypt(password,salt,64)).toString('hex');}
async function passwordMatches(password,stored){const [salt,hash]=stored.split(':');const actual=await scrypt(password,salt,64);return timingSafeEqual(actual,Buffer.from(hash,'hex'));}

export async function communityAuth(db){
 db.exec(`CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,status TEXT NOT NULL,role TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,account TEXT NOT NULL,expires INTEGER NOT NULL);`);
 const adminName=normalize(process.env.COMMUNITY_ADMIN_USER),adminPassword=process.env.COMMUNITY_ADMIN_PASSWORD;
 const configured=validUsername(adminName)&&validPassword(adminPassword)&&adminPassword.length>=12;
 if(configured){
  const existing=db.prepare('SELECT * FROM accounts WHERE username=?').get(adminName);
  if(existing&&existing.role!=='admin')throw Error('Admin username is already a member account; choose a different admin username');
  const id=existing?.id||key();
  const unchanged=existing&&await passwordMatches(adminPassword,existing.password_hash);
  const hash=unchanged?existing.password_hash:await passwordHash(adminPassword);
  if(existing&&!unchanged)db.prepare('DELETE FROM sessions WHERE account=?').run(id);
  db.prepare("INSERT INTO accounts VALUES(?,?,?,'approved','admin',?) ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash").run(id,adminName,hash,Date.now());
  db.prepare('INSERT OR IGNORE INTO players VALUES(?,?,?)').run(id,'הטוב בהתגלמותו וב"ב',Date.now());
  db.prepare("DELETE FROM sessions WHERE account IN(SELECT id FROM accounts WHERE role='admin' AND username<>?)").run(adminName);
  db.prepare("UPDATE accounts SET status='rejected' WHERE role='admin' AND username<>?").run(adminName);
  db.prepare("UPDATE accounts SET status='approved' WHERE id=?").run(id);
 }
 // A fixed dummy hash gives unknown usernames the same expensive password check.
 const dummy=await passwordHash(key());
 let passwordWork=0;
 const attempts=new Map();
 const limited=(bucket,max)=>{const now=Date.now();if(attempts.size>2000)for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);const item=attempts.get(bucket);if(!item||item.until<now){if(attempts.size>4000)return true;attempts.set(bucket,{count:1,until:now+15*60000});return false;}return ++item.count>max;};
 const userFor=req=>{
  if(!configured)return null;
  const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('community_session='))?.slice(18);
  if(!cookie||!/^[a-f0-9]{48}$/.test(cookie))return null;
  return db.prepare('SELECT a.*,p.name FROM sessions s JOIN accounts a ON a.id=s.account JOIN players p ON p.token=a.id WHERE s.hash=? AND s.expires>?').get(digest(cookie),Date.now())||null;
 };
 const publicUser=user=>user?{username:user.username,name:user.name,status:user.status,role:user.role}:null;
 function cookie(req,res,value,age){res.setHeader('Set-Cookie',`community_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${process.env.NODE_ENV==='production'||req.headers['x-forwarded-proto']==='https'?'; Secure':''}`);}
 function startSession(req,res,id){const token=key();db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),id,Date.now()+14*86400000);cookie(req,res,token,14*86400);}
 async function route(req,res,path,body,reply){
  if(path==='/api/auth/session'&&req.method==='GET'){const user=userFor(req);const avatar=user?db.prepare('SELECT image_id FROM player_avatars WHERE token=?').get(user.id):null;return reply(200,{configured,user:publicUser(user),profile:user?.status==='approved'?{token:user.id,name:user.name,avatar:avatar?'/api/avatars/'+avatar.image_id:null}:null}),true;}
  if(!path.startsWith('/api/auth/'))return false;
  if(req.method!=='POST')return reply(405,{}),true;
  if(path==='/api/auth/logout'){
   const token=(req.headers.cookie||'').match(/(?:^|;\s*)community_session=([a-f0-9]{48})(?:;|$)/)?.[1];if(token)db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(token));cookie(req,res,'',0);return reply(200,{ok:true}),true;
  }
  if(!configured)return reply(503,{error:'האתר בהכנה. מנהלת הקהילה עדיין לא השלימה את הגדרת הכניסה.'}),true;
  const username=normalize(body.username),password=body.password;
  if(!validUsername(username)||!validPassword(password))return reply(400,{error:'שם משתמש: 3–40 תווים באנגלית, ספרות, נקודה, קו או קו תחתון. סיסמה: 10–128 תווים.'}),true;
  const ip=req.socket.remoteAddress||'unknown';
  if(limited('ip:'+ip,200)||limited('name:'+username,20))return reply(429,{error:'בוצעו יותר מדי ניסיונות. נסו שוב בעוד רבע שעה.'}),true;
  if(passwordWork>=4)return reply(429,{error:'השרת מטפל בכמה בקשות כרגע. נסו שוב בעוד רגע.'}),true;
  passwordWork++;try{
  if(path==='/api/auth/register'){
   const name=body.name===undefined?username:typeof body.name==='string'?body.name.trim():'';
   if(name.length<2||name.length>40)return reply(400,{error:'יש להזין שם לתצוגה באורך 2–40 תווים.'}),true;
   if(db.prepare('SELECT id FROM accounts WHERE username=?').get(username))return reply(409,{error:'שם המשתמש תפוס. נסו להתחבר או בחרו שם אחר.'}),true;
   const hash=await passwordHash(password);
   const legacy=typeof body.legacyToken==='string'&&/^[a-f0-9]{48}$/.test(body.legacyToken)&&db.prepare('SELECT token FROM players WHERE token=?').get(body.legacyToken)&&!db.prepare('SELECT id FROM accounts WHERE id=?').get(body.legacyToken);
   const id=legacy?body.legacyToken:key();
   // Recheck after hashing because another concurrent registration may have completed.
   if(db.prepare('SELECT id FROM accounts WHERE username=?').get(username))return reply(409,{error:'שם המשתמש תפוס.'}),true;
   db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT INTO players VALUES(?,?,?) ON CONFLICT(token) DO UPDATE SET name=excluded.name').run(id,name,Date.now());db.prepare("INSERT INTO accounts VALUES(?,?,?,'pending','member',?)").run(id,username,hash,Date.now());db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
   startSession(req,res,id);return reply(201,{user:publicUser({...db.prepare('SELECT * FROM accounts WHERE id=?').get(id),name})}),true;
  }
  if(path==='/api/auth/login'){
   const account=db.prepare('SELECT a.*,p.name FROM accounts a JOIN players p ON p.token=a.id WHERE username=?').get(username);
   const matches=await passwordMatches(password,account?.password_hash||dummy);
   if(!account||!matches)return reply(401,{error:'שם המשתמש או הסיסמה אינם נכונים.'}),true;
   if(account.status==='rejected')return reply(403,{error:'בקשת ההצטרפות לא אושרה. פנו לאליענה כדי לברר לגבי אישור ההצטרפות.'}),true;
   startSession(req,res,account.id);return reply(200,{user:publicUser(account)}),true;
  }
  return reply(404,{}),true;
  }finally{passwordWork--;}
 }
 function members(req,path,body,user,reply){
  if(!path.startsWith('/api/admin/members'))return false;
  if(user.role!=='admin')return reply(403,{error:'הפעולה מיועדת למנהלת הקהילה בלבד'}),true;
  if(path==='/api/admin/members'&&req.method==='GET')return reply(200,{members:db.prepare("SELECT a.id,a.username,p.name,a.status,a.created FROM accounts a JOIN players p ON p.token=a.id WHERE a.role='member' ORDER BY CASE a.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,a.created").all()}),true;
  const match=path.match(/^\/api\/admin\/members\/([a-f0-9]{48})$/);
  if(match&&req.method==='POST'&&['approved','rejected'].includes(body.status)){
   const changed=db.prepare("UPDATE accounts SET status=? WHERE id=? AND role='member'").run(body.status,match[1]);
   if(!changed.changes)return reply(404,{error:'המשתתף לא נמצא'}),true;
   if(body.status==='rejected')db.prepare('DELETE FROM sessions WHERE account=?').run(match[1]);
   return reply(200,{ok:true}),true;
  }
  return reply(400,{error:'בקשה לא תקינה'}),true;
 }
 return {userFor,route,members};
}
