'use strict';
const $=s=>document.querySelector(s);
const app=$('#app'),dialog=$('#seat-dialog');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={account:null,config:null,catalog:[],game:null,id:new URLSearchParams(location.search).get('game'),secret:new URLSearchParams(location.hash.slice(1)).get('admin'),player:null,stage:'register',tab:'guess',seats:[],results:[],mine:null,busy:false,dirty:false,activeIndex:null};
function read(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}}
function write(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
function tell(message,bad=false){$('#message').textContent=message;$('#message').className=bad?'error':'';}
async function api(path,body){const r=await fetch('/api/'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok){const e=Error(data.error||'לא ניתן להשלים את הבקשה');e.status=r.status;throw e;}return data;}
const normalize=s=>String(s).replace(/[\s"'״׳־–-]/g,'').toLowerCase();
function artwork(index){const g=state.game;return state.catalog.find(p=>p.id===g.cards?.[index])||state.catalog.find(p=>[p.name,...p.aliases].some(n=>normalize(n)===normalize(g.parties[index])));}
function artStyle(c){return c?`background-image:url('/assets/${c.image}?v=20261021');background-size:${c.size};background-position:${c.x}% ${c.y}%`:'';}
function portrait(c,name,extra=''){return `<div class="portrait ${c?'':'fallback-card'} ${extra}" role="img" aria-label="${esc('איור של '+name)}" style="${artStyle(c)}">${c?'':'✓'}</div>`;}
function steps(current){return `<div class="steps" aria-label="שלבי המשחק"><span class="step ${current===1?'current':''}" ${current===1?'aria-current="step"':''}>01 · הרשמה</span><span class="step ${current===2?'current':''}" ${current===2?'aria-current="step"':''}>02 · בחירת מנדטים</span></div>`;}
function locked(){return !!state.game.results||Date.now()>=state.game.deadline;}
function avatarMarkup(url,name,extra=''){
 const valid=typeof url==='string'&&(/^\/api\/avatars\/[a-f0-9]{48}$/.test(url)||/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(url));
 return `<span class="avatar ${extra}" role="img" aria-label="${esc('תמונת המשתתף '+name)}">${valid?`<img class="avatar-photo" src="${esc(url)}" alt="" loading="lazy">`:''}<span class="avatar-default" ${valid?'hidden':''}><svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="14" r="7"></circle><path d="M7 36c0-9 5-14 13-14s13 5 13 14"></path></svg></span></span>`;
}
function bindAvatarFallbacks(root=document){root.querySelectorAll('img.avatar-photo').forEach(img=>img.addEventListener('error',()=>{const fallback=img.nextElementSibling;if(fallback)fallback.hidden=false;img.remove();},{once:true}));}
function photoSignup(profile){return `<div class="photo-upload"><div id="photo-preview">${avatarMarkup(profile?.avatar,profile?.name||'','avatar-large')}</div><div class="photo-controls"><label for="player-photo">תמונה לטבלת הדירוג - לבחירתכם</label><input id="player-photo" type="file" accept="image/jpeg,image/png,image/webp"><button type="button" id="remove-photo" class="text-button" ${profile?.avatar?'':'hidden'}>שימוש בתמונת ברירת המחדל</button><p id="photo-status" class="muted" aria-live="polite">אפשר להמשיך עם תמונת ברירת המחדל.</p></div></div>`;}
async function preparePhoto(file){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('יש לבחור תמונת JPG, PNG או WebP');
 if(file.size>8*1024*1024)throw Error('יש לבחור תמונה קטנה מ־8 מגה');
 const url=URL.createObjectURL(file),image=new Image();
 try{
  image.src=url;await image.decode();
  if(!image.naturalWidth||!image.naturalHeight)throw Error('לא ניתן לפתוח את התמונה');
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
  const context=canvas.getContext('2d');if(!context)throw Error('לא ניתן להכין את התמונה בדפדפן הזה');
  context.fillStyle='#f5f5ed';context.fillRect(0,0,256,256);
  const side=Math.min(image.naturalWidth,image.naturalHeight);
  context.drawImage(image,(image.naturalWidth-side)/2,(image.naturalHeight-side)/2,side,side,0,0,256,256);
  const data=canvas.toDataURL('image/jpeg',.82);if(data.length>180000)throw Error('התמונה גדולה מדי. בחרו תמונה אחרת');return data;
 }finally{URL.revokeObjectURL(url);}
}
function renderRegistration(){
 state.stage='register';
 const profile=state.player||read('ballot-player');
 app.innerHTML=`<div class="welcome"><section class="welcome-copy">${steps(1)}<div class="eyebrow">משחק הבחירות של החבר׳ה</div><h1>120 מנדטים.\nמי יפגע בול?</h1><p>החבורה כבר בחליפות. עכשיו תורכם לחלק את המנדטים ולנחש איך תיראה הכנסת הבאה.</p><form id="register" class="signup"><h2>נכנסים לקלפי</h2><label for="player-name">איך קוראים לכם?</label><input id="player-name" name="name" autocomplete="name" minlength="2" maxlength="40" required placeholder="השם שלכם" value="${esc(profile?.name||'')}"><p class="muted">השם והתמונה שתבחרו יופיעו בטבלת הדירוג של התחרות.</p>${photoSignup(profile)}<button class="primary">ממשיכים לבחירת המנדטים ←</button><p class="trustline">נקודות בלבד · בלי כסף · אפשר לעדכן עד הנעילה</p></form><div class="welcome-stats"><div><strong>120</strong><span>מנדטים לחלוקה</span></div><div><strong>${state.game.parties.length}</strong><span>מפלגות על הלוח</span></div><div><strong>1</strong><span>ניחוש שינצח</span></div></div></section>${flagArt()}</div>`;
 bindAvatarFallbacks();
 let avatarChoice,photoBusy=false,photoSequence=0;
 const previewPhoto=url=>{$('#photo-preview').innerHTML=avatarMarkup(url,$('#player-name').value,'avatar-large');$('#remove-photo').hidden=!url;bindAvatarFallbacks($('#photo-preview'));};
 $('#player-photo').onchange=async()=>{
  const file=$('#player-photo').files[0];if(!file)return;
  const version=++photoSequence;photoBusy=true;$('#register .primary').disabled=true;$('#photo-status').textContent='מכינים את התמונה…';
  try{const image=await preparePhoto(file);if(version!==photoSequence)return;avatarChoice=image;previewPhoto(image);$('#photo-status').textContent='התמונה מוכנה ותישמר עם ההרשמה.';}
  catch(e){if(version===photoSequence)$('#photo-status').textContent=e.message;}
  finally{if(version===photoSequence){photoBusy=false;$('#register .primary').disabled=false;}}
 };
 $('#remove-photo').onclick=()=>{photoSequence++;photoBusy=false;avatarChoice=null;$('#player-photo').value='';previewPhoto(null);$('#photo-status').textContent='תמונת ברירת המחדל תופיע לצד השם שלכם.';$('#register .primary').disabled=false;};
 $('#register').onsubmit=async e=>{
  e.preventDefault();if(photoBusy)return;const button=e.submitter;button.disabled=true;
  try{
   state.player=await api('players',{name:$('#player-name').value,token:state.player?.token||profile?.token,gameId:state.id,avatar:avatarChoice});
   const saved=write('ballot-player',state.player);
   state.mine=null;
   const token=state.player.token;
   try{const mine=await api('games/'+state.id+'/my-guess',{token});state.mine={...mine,token};}catch(err){if(err.status!==404)throw err;}
   if(!validArray(state.seats))state.seats=validArray(state.mine?.seats)?[...state.mine.seats]:state.game.parties.map(()=>0);
   state.results=state.game.results?[...state.game.results]:state.game.parties.map(()=>0);
   if(state.mine&&state.mine.name!==state.player.name)state.dirty=true;
   if(state.mine&&!state.dirty)state.tab='summary';
   state.game=await api('games/'+state.id);
   tell(saved?'':'ההרשמה הצליחה. הדפדפן אינו מאפשר לשמור את הזיהוי לעדכון בביקור הבא.');
   state.stage='play';renderPlay();window.scrollTo(0,0);
  }catch(err){tell(err.message,true);button.disabled=false;}
 };
}
function validArray(a){return Array.isArray(a)&&a.length===state.game.parties.length&&a.every(n=>Number.isInteger(n)&&n>=0&&n<=120);}
function validAllocation(a){return validArray(a)&&a.every(n=>n===0||n>=4);}
const countedTotal=a=>a.reduce((sum,n)=>sum+n,0);
function heading(title,subtitle){return `<div class="page-heading"><div><div class="eyebrow">${esc(state.game?.title||'הטוב בהתגלמותו')}</div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>${state.player?`<div class="user-pill">${avatarMarkup(state.player.avatar,state.player.name)}<span>שלום, ${esc(state.player.name)}</span><button class="text-button edit-name" id="edit-name">עריכת פרופיל</button></div>`:''}</div>`;}
function links(){
 if(state.account?.role!=='admin')return '';
 const share=location.origin+'/?game='+state.id;
 return `<section class="links"><h2>מזמינים את הקהילה</h2><div class="copy-row"><input id="share" readonly aria-label="קישור להשתתפות" value="${esc(share)}"><button class="secondary" id="copy-share">העתקת הקישור</button></div><p class="muted">כל מצטרף יירשם עם סיסמה וימתין לאישור שלך. <a href="/members">לאישור משתתפים</a></p></section>`;
}
function renderPlay(){
 state.stage='play';
 const admin=state.tab==='admin'&&state.account?.role==='admin',closed=locked();
 const values=admin?state.results:state.seats;
 const title=state.tab==='received'?'ההימור שלך על הלוח.':state.tab==='board'?'מי יפגע הכי קרוב?':state.tab==='summary'?'הניחוש שלכם על הלוח.':admin?'התוצאות האמיתיות':'אז איך תיראה הכנסת?';
 const subtitle=state.tab==='received'?'120 מנדטים. עכשיו מחכים לקלפי.':state.tab==='summary'?'המפלגות שבחרתם, מהכי הרבה מנדטים להכי מעט.':state.tab==='board'?'כל המשתתפים בתחרות, במקום אחד.':'לוחצים על הדמויות ובוחרים מספר מנדטים לכל מפלגה.';
 app.innerHTML=steps(2)+heading(title,subtitle)+links()+`<div class="toolbar"><div class="tabs"><button data-tab="guess" class="${state.tab==='guess'?'active':''}">בחירת מנדטים</button>${state.mine?`<button data-tab="summary" class="${state.tab==='summary'?'active':''}">הניחוש ששמרתי</button>`:''}<button data-tab="board" class="${state.tab==='board'?'active':''}">טבלת דירוג</button>${state.account?.role==='admin'?`<button data-tab="admin" class="${admin?'active':''}">הזנת תוצאות</button>`:''}</div><p class="muted"><span id="count">${state.game.count}</span> משתתפים · נעילה: ${esc(new Date(state.game.deadline).toLocaleString('he-IL',{timeZone:state.config.timeZone,hour12:false})+' (שעון ישראל)')}</p></div><div id="play-content"></div>`;
 bindAvatarFallbacks();
 $('#edit-name').onclick=renderRegistration;
 document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;renderPlay();});
 if($('#copy-share'))$('#copy-share').onclick=async()=>{try{await navigator.clipboard.writeText($('#share').value);tell('הקישור הועתק');}catch{$('#share').select();tell('אפשר להעתיק את הקישור המסומן');}};
 const content=$('#play-content');
 if(state.tab==='received'&&state.mine)return renderReceipt(content);
 if(state.tab==='board')return renderBoard(content);
 if(state.tab==='summary'&&state.mine)return renderSummary(content);
 const editable=admin?Date.now()>=state.game.deadline:!closed;
 const note=admin?(editable?'הזינו תוצאות סופיות. הסכום הכולל חייב להיות 120.':'ניתן להזין תוצאות אחרי מועד נעילת הניחושים.'):closed?'הניחושים נעולים. אפשר לצפות בניחוש ובטבלת הדירוג.':state.dirty?'יש בחירות שעדיין לא נשמרו. בסיום החלוקה לחצו על שליחת ההימור.':state.mine?'הניחוש שלכם שמור. אפשר לשנות ולשמור מחדש עד הנעילה.':'נחשו את מספר המנדטים הסופי לכל מפלגה. למפלגה שלא עוברת לחצו על ״מתחת לאחוז החסימה״. למפלגה שעוברת בחרו בין 4 ל־120. יש לחלק בדיוק 120 מנדטים כדי לשלוח.';
 content.innerHTML=`<p class="notice">${esc(note)}</p><div class="party-grid">${state.game.parties.map((name,i)=>`<button class="party-card ${values[i]>0?'selected':'threshold-marked'}" data-party="${i}" ${!editable||state.busy?'disabled':''} aria-label="${esc(name)}: ${values[i]===0?'0 מנדטים, לא עוברת את אחוז החסימה':values[i]+' מנדטים'}, לחצו לבחירה" aria-haspopup="dialog">${portrait(artwork(i),name)}<span class="party-name">${esc(name)}</span><span class="party-value">${values[i]>0?`<strong>${values[i]}</strong>מנדטים`:'<span class="party-zero">0 מנדטים<br>לא עוברת את אחוז החסימה</span>'}</span></button>`).join('')}</div><section class="allocation-bar" aria-label="סיכום המנדטים"><div><div class="remaining"><strong id="remaining-count"></strong><span id="remaining-label">מנדטים נותרו לחלוקה</span></div><p>חולקו <span id="sum"></span> מנדטים</p><div class="progress"><span id="progress"></span></div></div><span class="hint" id="allocation-hint" aria-live="polite"></span><button type="button" id="submit-guesses" class="primary">${state.busy?'שולחים…':admin?'פרסום תוצאות':state.mine?'עדכון ההימור ←':'שליחת ההימור ←'}</button></section>`;
 document.querySelectorAll('[data-party]').forEach(b=>b.onclick=()=>openPicker(Number(b.dataset.party)));
 $('#submit-guesses').onclick=submit;
 updateTotal();
}
function renderBoard(content){
 const g=state.game;
 const canView=r=>g.predictionsVisible&&r.hasGuess&&/^[a-f0-9]{48}$/.test(r.predictionId);
 content.innerHTML=`<section class="panel"><h2>${g.results?'התוצאות על הלוח 🏆':'מי כבר נכנס לקלפי?'}</h2><p class="muted">${g.results?'יותר נקודות = ניחוש קרוב יותר. ניחוש מושלם מקבל 120 נקודות.':'כל הנרשמים לתחרות מופיעים כאן. הדירוג יופיע אחרי פרסום התוצאות.'}</p><p class="notice">${g.predictionsVisible?'הניחושים ננעלו. לחצו על שם משתתף כדי לראות את הניחוש ששמר. במחשב אפשר גם לרחף מעל השם.':'הניחושים של כולם נשארים פרטיים עד הנעילה. אחרי הנעילה תוכלו ללחוץ על שם משתתף ולראות את הבחירות שלו.'}</p>${g.count?g.leaderboard.map(r=>{
 const name=`<span class="board-name">${g.results&&r.score!==null?g.leaderboard.findIndex(x=>x.score===r.score)+1+'. ':''}${esc(r.name)}${canView(r)?'<small class="prediction-label">צפייה בניחוש ↓</small>':''}</span>`;
 return `<div class="board-row">${canView(r)?`<button type="button" class="board-person prediction-button" data-prediction="${esc(r.predictionId)}" aria-expanded="false" aria-controls="prediction-${esc(r.predictionId)}" aria-label="${esc('צפייה בניחוש של '+r.name)}">${avatarMarkup(r.avatar,r.name)}${name}</button>`:`<span class="board-person">${avatarMarkup(r.avatar,r.name)}${name}</span>`}<strong>${r.hasGuess===false?'טרם נשמר ניחוש':r.complete===false?(g.predictionsVisible?'ההימור לא הושלם':'נדרשת השלמת ההימור'):r.score===null?'ממתין לתוצאות':r.score+' נק׳'}</strong>${canView(r)?`<div class="board-prediction" id="prediction-${esc(r.predictionId)}" role="region" aria-label="${esc('הניחוש של '+r.name)}" hidden></div>`:''}</div>`;
 }).join(''):'<div class="empty">היו הראשונים להצטרף לתחרות</div>'}</section>`;
 bindAvatarFallbacks(content);
 content.querySelectorAll('[data-prediction]').forEach(button=>{
  const row=button.closest('.board-row'),preview=row.querySelector('.board-prediction');
  let pinned=false,loading=false,loaded=false;
  const hide=()=>{preview.hidden=true;button.setAttribute('aria-expanded','false');};
  const show=async()=>{
   if(!state.game.predictionsVisible)return;
   preview.hidden=false;button.setAttribute('aria-expanded','true');
   if(loaded||loading)return;
   loading=true;preview.innerHTML='<p class="muted" role="status">טוענים את הניחוש…</p>';
   const gameId=state.id;
   try{
    const prediction=await api('games/'+gameId+'/predictions/'+button.dataset.prediction);
    if(!preview.isConnected||state.id!==gameId||state.stage!=='play')return;
    if(!validArray(prediction.seats))throw Error('לא ניתן להציג את הניחוש');
    preview.innerHTML=`<h3>הניחוש של ${esc(prediction.name)}</h3>${allocationMarkup(prediction.seats)}`;
    loaded=true;
   }catch(e){if(preview.isConnected)preview.innerHTML=`<p class="error" role="alert">${esc(e.message)}</p>`;}
   finally{loading=false;}
  };
  button.onclick=()=>{pinned=!pinned;if(pinned)show();else hide();};
  button.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse')show();});
  row.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse'&&!pinned)hide();});
  button.addEventListener('focus',()=>show());
  row.addEventListener('focusout',e=>{if(!pinned&&!row.contains(e.relatedTarget))hide();});
  button.addEventListener('keydown',e=>{if(e.key==='Escape'){pinned=false;hide();}});
 });
}
function renderReceipt(content){
 content.innerHTML=`<section class="panel submission-receipt"><div class="receipt-luck"><img src="/assets/fingers-crossed.png?v=2" alt="מחזיקים אצבעות" decoding="async"></div><div class="eyebrow">120 מתוך 120 מנדטים</div><h2 id="receipt-title" tabindex="-1">הימורך התקבל, נתעדכן בקרוב</h2><p>ההימור שלך נשמר בהצלחה. אפשר לצפות בו ולעדכן אותו עד מועד הנעילה. <span class="receipt-wish">בשורות טובות.</span></p><div class="receipt-actions"><button type="button" class="button" id="receipt-view-summary">צפייה בהימור שלי</button><button type="button" class="secondary" id="receipt-view-board">לטבלת הדירוג</button></div></section>`;
 $('#receipt-view-summary').onclick=()=>{state.tab='summary';renderPlay();$('#summary-title')?.focus();};
 $('#receipt-view-board').onclick=()=>{state.tab='board';renderPlay();};
}
function allocationMarkup(values){
 const parties=state.game.parties.map((name,index)=>({name,index,seats:values[index]}));
 const chosen=parties.filter(p=>p.seats>0).sort((a,b)=>b.seats-a.seats||a.index-b.index);
 const excluded=parties.filter(p=>p.seats===0);
 const total=countedTotal(values);
 return `<ol class="saved-list">${chosen.map(p=>`<li class="saved-row">${portrait(artwork(p.index),p.name,'saved-party-art')}<span class="saved-party-name">${esc(p.name)}</span><span class="saved-seat-count"><strong>${p.seats}</strong> מנדטים</span></li>`).join('')}</ol>${excluded.length?`<section class="excluded-parties"><h3>מתחת לאחוז החסימה</h3><p class="muted">למפלגות הבאות ניחשתם 0 מנדטים.</p><ul class="excluded-list">${excluded.map(p=>`<li class="excluded-row">${portrait(artwork(p.index),p.name,'excluded-party-art')}<span class="excluded-party-name">${esc(p.name)}</span><span class="excluded-choice">0 מנדטים</span></li>`).join('')}</ul></section>`:''}<div class="saved-total"><strong>סך המנדטים</strong><strong>${total} מנדטים</strong></div>${!validAllocation(values)||total!==120?`<p class="notice">יש לבחור 0 או לפחות 4 לכל מפלגה, ולהגיע לסכום של 120 בדיוק. למפלגה שלא עוברת לחצו על ״מתחת לאחוז החסימה״.</p>`:''}<p class="muted">כל מספר מייצג את מספר המנדטים הסופי שניחשתם. 0 מציין שמפלגה לא עוברת את אחוז החסימה.</p>`;
}
function renderSummary(content){
 content.innerHTML=`<section class="panel saved-summary"><div class="saved-heading"><div class="saved-check" aria-hidden="true">✓</div><div><h2 id="summary-title" tabindex="-1">הניחוש נשמר בהצלחה</h2><p class="muted">${state.dirty?'הרשימה מציגה את הניחוש האחרון ששמרתם. יש שינויים נוספים במסך הבחירה שעדיין לא נשמרו.':'זו הרשימה שבחרתם, לפי מספר המנדטים.'}</p></div></div>${allocationMarkup(state.mine.seats)}<div class="summary-actions"><button class="secondary" id="edit-guess" ${locked()?'disabled':''}>${locked()?'הניחושים נעולים':'עריכת הניחוש'}</button><button class="button" id="view-board">לטבלת הדירוג ←</button></div></section>`;
 $('#edit-guess').onclick=()=>{state.tab='guess';renderPlay();};
 $('#view-board').onclick=()=>{state.tab='board';renderPlay();};
}
function updateTotal(){
 const admin=state.tab==='admin',values=admin?state.results:state.seats;
 const sum=countedTotal(values);
 $('#remaining-count').textContent=String(Math.abs(120-sum));$('#remaining-label').textContent=sum>120?'מנדטים בחריגה':'מנדטים נותרו לחלוקה';
 $('#sum').textContent=sum+' / 120';$('#progress').style.width=Math.min(100,sum/120*100)+'%';
 $('.allocation-bar').classList.toggle('over',sum>120);
 const validRange=validAllocation(values);
 $('#allocation-hint').textContent=!validRange?'יש לבחור 0 או מספר מנדטים שלם בין 4 ל־120.':sum<120?'נשארו '+(120-sum)+' מנדטים לחלוקה':sum>120?'יש להוריד '+(sum-120)+' מנדטים':'כל המנדטים חולקו ✓';
 $('#submit-guesses').disabled=state.busy||!validRange||sum!==120||(admin?Date.now()<state.game.deadline:locked());
}
function openPicker(index){
 const admin=state.tab==='admin';if(state.busy||(admin?Date.now()<state.game.deadline:locked()))return;
 state.activeIndex=index;const values=admin?state.results:state.seats,name=state.game.parties[index],c=artwork(index);
 $('#dialog-title').textContent=name;$('#dialog-portrait').setAttribute('style',artStyle(c));$('#dialog-portrait').setAttribute('aria-label','איור של '+name);$('#dialog-portrait').textContent=c?'':'✓';
 $('#seat-choice').innerHTML=Array.from({length:117},(_,index)=>{
  const seats=index+4;
  return `<option value="${seats}">${seats} מנדטים</option>`;
 }).join('');
 $('#seat-choice').value=String(values[index]>=4?values[index]:4);
 const updatePickerHint=()=>{
  const choice=Number($('#seat-choice').value),other=countedTotal(values)-values[index],left=120-other-choice;
  $('#dialog-hint').textContent=(left>=0?'אחרי הבחירה הזו יישארו עוד '+left+' מנדטים לחלוקה.':'הבחירה הזו תיצור חריגה של '+Math.abs(left)+' מנדטים. אפשר להפחית ממפלגה אחרת.');
 };
 $('#seat-choice').onchange=updatePickerHint;$('#seat-choice').oninput=updatePickerHint;updatePickerHint();
 dialog.showModal();$('#seat-choice').focus();
}
function chooseSeat(value){
 const admin=state.tab==='admin';if(state.busy||state.activeIndex===null||(admin?Date.now()<state.game.deadline:locked())){dialog.close();return;}
 if(!Number.isInteger(value)||value<0||value>120||(value>0&&value<4))return;
 const values=admin?state.results:state.seats;values[state.activeIndex]=value;if(!admin)state.dirty=true;
 dialog.close();renderPlay();document.querySelector(`[data-party="${state.activeIndex}"]`)?.focus();
}
$('#close-dialog').onclick=()=>dialog.close();
$('#below-threshold').onclick=()=>chooseSeat(0);
$('#seat-form').onsubmit=e=>{e.preventDefault();const raw=$('#seat-choice').value,n=Number(raw);if(raw!==''&&n>=0&&n<=120)chooseSeat(n);};
dialog.addEventListener('click',e=>{if(e.target===dialog){const b=dialog.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)dialog.close();}});
async function submit(){
 const admin=state.tab==='admin',values=admin?state.results:state.seats;
 if(state.busy||!validAllocation(values)||countedTotal(values)!==120||(admin?Date.now()<state.game.deadline:locked()))return;
 const snapshot=[...values];
 state.busy=true;renderPlay();
 try{
  if(admin){await api('games/'+state.id+'/results',{secret:state.secret,seats:snapshot});state.tab='board';tell('התוצאות פורסמו והדירוג עודכן');}
  else{
   const r=await api('games/'+state.id+'/guess',{name:state.player.name,seats:snapshot,token:state.mine?.token||state.player.token,playerToken:state.player.token});
   state.mine={name:state.player.name,seats:snapshot,token:r.token};
   write('guess-'+state.id,state.mine);state.dirty=false;state.tab='received';tell('');
  }
  try{state.game=await api('games/'+state.id);}catch{}
 }catch(e){tell(e.message,true);}
 finally{state.busy=false;renderPlay();if(state.tab==='received'){window.scrollTo(0,0);$('#receipt-title')?.focus();}}
}
function renderGallery(){
 app.innerHTML=`<div class="page-heading"><div><div class="eyebrow">החבורה של הקלפי</div><h1>כל מפלגה, והאופי שלה.</h1><p>הכירו את הדמויות. כדי לנחש כמה מנדטים כל מפלגה תקבל, נכנסים למשחק.</p></div><a class="button" href="/">הרשמה למשחק ←</a></div><div class="party-grid">${state.catalog.map(c=>`<figure class="gallery-card">${portrait(c,c.name)}<figcaption>${esc(c.name)}</figcaption></figure>`).join('')}</div><p class="muted" style="margin-top:25px">האיורים סאטיריים ונוצרו באמצעות בינה מלאכותית.</p>`;
}
function renderManage(){
 app.innerHTML=`<section class="manage-heading"><div class="eyebrow">מסך המנהל</div><h1>פותחים תחרות משלכם.</h1><p>מגדירים את המפלגות ואת מועד הנעילה, ומשתפים קישור שמתחיל בהרשמה ובבחירת מנדטים.</p></section><form id="create" class="panel"><label for="title">שם התחרות</label><input id="title" maxlength="100" required value="הקלפי של הטוב בהתגלמותו"><label for="deadline">מתי נועלים את הניחושים? (שעון ישראל)</label><input id="deadline" type="datetime-local" required><p class="inline-heading">המפלגות בתחרות</p><p class="muted">אפשר לשנות את שם המפלגה שמופיע על הכרטיס, או להסיר אותה מהתחרות.</p><div class="manage-grid">${state.catalog.map(c=>`<div class="manage-party"><input type="checkbox" checked data-enabled="${c.id}" aria-label="הכללת ${esc(c.name)}">${portrait(c,c.name,'manage-portrait')}<input type="text" maxlength="60" required data-label="${c.id}" aria-label="שם המפלגה עבור ${esc(c.name)}" value="${esc(c.name)}"></div>`).join('')}</div><label for="extra">מפלגות נוספות, אם צריך - אחת בכל שורה</label><textarea id="extra" placeholder="שם מפלגה נוספת"></textarea><button class="primary">יצירת התחרות וקישור ההשתתפות ←</button></form>`;
 $('#deadline').value=state.config.deadline.slice(0,16);
 document.querySelectorAll('[data-enabled]').forEach(box=>box.onchange=()=>{document.querySelector(`[data-label="${box.dataset.enabled}"]`).disabled=!box.checked;});
 $('#create').onsubmit=async e=>{
  e.preventDefault();const button=e.submitter;button.disabled=true;
  const chosen=state.catalog.filter(c=>document.querySelector(`[data-enabled="${c.id}"]`).checked);
  const extra=$('#extra').value.split('\n').map(x=>x.trim()).filter(Boolean);
  try{
   const g=await api('games',{title:$('#title').value,deadlineLocal:$('#deadline').value,parties:[...chosen.map(c=>document.querySelector(`[data-label="${c.id}"]`).value.trim()),...extra],cards:[...chosen.map(c=>c.id),...extra.map(()=>null)]});
   location.href='/?game='+g.id+'#admin='+g.secret;
  }catch(e){tell(e.message,true);button.disabled=false;}
 };
}
async function refresh(){
 if(!state.id||!state.game||state.busy||state.stage!=='play')return;
 try{const wasLocked=locked();state.game=await api('games/'+state.id);if(state.stage!=='play')return;if($('#count'))$('#count').textContent=state.game.count;if((state.tab==='board'&&!document.querySelector('.prediction-button[aria-expanded="true"]'))||(!wasLocked&&locked())){if(dialog.open)dialog.close();renderPlay();}else if($('#submit-guesses'))updateTotal();}catch{}
}
async function init(){
 try{
  const r=await fetch('/parties.json');if(!r.ok)throw Error('לא ניתן לטעון את המפלגות');state.catalog=await r.json();
  state.config=await (await fetch('/config.json')).json();
  await enterCommunity();setInterval(checkCommunity,15000);
 }catch(e){app.innerHTML=`<section class="panel"><h2>לא הצלחנו לפתוח את הקלפי</h2><p>${esc(e.message)}</p><a class="button" href="/">חזרה לעמוד הראשי</a></section>`;}
}
init();
