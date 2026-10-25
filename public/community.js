'use strict';
// No credentials are stored in browser storage. The server owns approval and sessions.
function updateAccountNav(){
 const nav=document.querySelector('header nav');
 nav.querySelectorAll('.account-nav').forEach(e=>e.remove());
 if(!state.account)return;
 if(state.account.role==='admin')nav.insertAdjacentHTML('beforeend','<a href="/members" class="account-nav">אישור משתתפים</a>');
 nav.insertAdjacentHTML('beforeend','<button type="button" class="text-button account-nav" id="logout">יציאה</button>');
 $('#logout').onclick=async()=>{await api('auth/logout',{});state.account=null;state.player=null;state.mine=null;state.seats=[];state.dirty=false;localStorage.removeItem('ballot-player');location.href='/';};
}
function flagArt(){
 return `<div class="hero-art flag-art" role="img" aria-label="דגל ישראל מתנופף ברוח"><div class="flag-scene" aria-hidden="true"><span class="flag-sunlight"></span><span class="flag-cloud flag-cloud-far"></span><span class="flag-cloud flag-cloud-near"></span><img class="flag-render" src="/assets/israel-flag.png" alt="" decoding="async" fetchpriority="high"></div></div>`;
}
function renderAccess(mode='login'){
 state.stage='access';state.player=null;state.game=null;
 const signup=mode==='signup';
 app.innerHTML=`<div class="welcome"><section class="welcome-copy"><div class="eyebrow">הקלפי הפרטית של</div><h1>הטוב בהתגלמותו וב"ב.</h1><p>120 מנדטים, החבורה המוכרת והניחוש שלכם. הכניסה לחברי הטוב בהתגלמותו וב"ב בלבד, לאחר אישור אליענה (ככה זה בדיקטטורה, מותק).</p><section class="signup"><div class="tabs auth-tabs"><button type="button" id="login-tab" class="${signup?'':'active'}">כבר רשומים</button><button type="button" id="signup-tab" class="${signup?'active':''}">הרשמה</button></div><form id="account-form"><label for="account-username">שם משתמש</label><input id="account-username" dir="ltr" autocomplete="username" pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,39}" minlength="3" maxlength="40" autocapitalize="none" spellcheck="false" required><p class="muted">3–40 תווים באנגלית, ספרות, נקודה, קו או קו תחתון.</p><label for="account-password">סיסמה</label><input id="account-password" type="password" autocomplete="${signup?'new-password':'current-password'}" minlength="10" maxlength="128" required>${signup?'<p class="muted">לפחות 10 תווים. בחרו סיסמה אישית ושמרו אותה אצלכם. אחרי ההרשמה, שלחו לאליענה את שם המשתמש שבחרתם כדי שתוכל לאשר.</p>':''}<button class="primary">${signup?'שליחת בקשת הצטרפות':'כניסה לקלפי ←'}</button><p class="muted" id="account-error" role="alert"></p></form></section></section>${flagArt()}</div>`;
 $('#login-tab').onclick=()=>renderAccess('login');$('#signup-tab').onclick=()=>renderAccess('signup');
 $('#account-form').onsubmit=async e=>{
  e.preventDefault();const button=e.submitter||$('#account-form .primary');button.disabled=true;$('#account-error').textContent='';
  try{await api('auth/'+(signup?'register':'login'),{username:$('#account-username').value,password:$('#account-password').value,...(signup?{legacyToken:read('ballot-player')?.token}:{})});await enterCommunity();}
  catch(err){$('#account-error').textContent=err.message;button.disabled=false;}
 };
}
function renderPending(){
 state.stage='pending';state.game=null;state.player=null;
 app.innerHTML=`<section class="panel access-panel"><img src="/assets/community-icon.png?v=3" class="access-icon" alt=""><h1>הבקשה אצל אליענה.</h1><p>שלום ${esc(state.account.name)}, ההרשמה נקלטה. שלחו לאליענה את שם המשתמש <bdi>${esc(state.account.username)}</bdi> כדי שתוכל לאשר. אחרי האישור תוכלו לבחור מנדטים ולראות את טבלת הדירוג.</p><button id="check-approval" class="button">בדיקת אישור</button><p class="muted">אפשר לסגור ולחזור אחר כך עם שם המשתמש והסיסמה. אין צורך להירשם שוב.</p></section>`;
 $('#check-approval').onclick=async()=>{try{await enterCommunity();}catch(e){tell(e.message,true);}};
}
async function renderMembers(){
 state.stage='members';
 if(state.account.role!=='admin'){app.innerHTML='<section class="panel"><p>המסך מיועד לאליענה בלבד.</p><a href="/">חזרה למשחק</a></section>';return;}
 const {members}=await api('admin/members');
 const labels={pending:'ממתין לאישור',approved:'מאושר',rejected:'נדחה'};
 app.innerHTML=`<div class="page-heading"><div><div class="eyebrow">ניהול הטוב בהתגלמותו וב"ב</div><h1>מי נכנס לקלפי?</h1><p>אשרי רק חברי הטוב בהתגלמותו וב"ב שמסרו לך את שם המשתמש שמופיע כאן.</p></div><a class="button" href="/">למשחק ←</a></div><section class="panel"><div class="toolbar"><strong>${members.filter(m=>m.status==='pending').length} בקשות ממתינות</strong><button class="secondary" id="refresh-members">רענון רשימה</button></div>${members.length?members.map(m=>`<div class="member-row"><div><strong>${esc(m.name)}</strong><p class="muted"><bdi>${esc(m.username)}</bdi> · ${labels[m.status]}</p></div><div class="member-actions">${m.status!=='approved'?`<button class="button" data-member="${m.id}" data-status="approved">אישור</button>`:''}${m.status!=='rejected'?`<button class="secondary" data-member="${m.id}" data-status="rejected">${m.status==='approved'?'ביטול גישה':'דחייה'}</button>`:''}</div></div>`).join(''):'<p class="empty">עדיין אין בקשות. שתפי בקבוצה את קישור המשחק.</p>'}</section>`;
 $('#refresh-members').onclick=()=>renderMembers().catch(e=>tell(e.message,true));
 document.querySelectorAll('[data-member]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api('admin/members/'+b.dataset.member,{status:b.dataset.status});await renderMembers();}catch(e){tell(e.message,true);b.disabled=false;}});
}
async function enterCommunity(){
 const session=await api('auth/session');state.account=session.user;updateAccountNav();
 if(!session.configured){state.stage='access';app.innerHTML='<section class="panel access-panel"><h1>מכינים את הקלפי.</h1><p>המשחק ייפתח אחרי שאליענה תשלים את הגדרת חשבון הניהול.</p></section>';return;}
 if(!session.user)return renderAccess();
 if(session.user.status!=='approved')return renderPending();
 state.player=session.profile;write('ballot-player',state.player);
 if(location.pathname==='/members')return renderMembers();
 if(location.pathname==='/characters')return renderGallery();
 if(location.pathname==='/manage'){
  if(state.account.role==='admin')return renderManage();
  app.innerHTML='<section class="panel"><p>רק אליענה יכולה לפתוח תחרות.</p><a href="/">חזרה למשחק</a></section>';return;
 }
 if(!state.id){const lobby=await api('lobby');state.id=lobby.id;history.replaceState(null,'','/?game='+state.id+location.hash);}
 state.game=await api('games/'+state.id);renderRegistration();
}
async function checkCommunity(){
 if(state.stage==='access')return;
 try{
  const session=await api('auth/session');
  if(!session.user||session.user.status!=='approved'){
   if(dialog.open)dialog.close();state.mine=null;state.seats=[];state.account=session.user;updateAccountNav();return session.user?renderPending():renderAccess();
  }
  if(state.stage==='pending')await enterCommunity();else await refresh();
 }catch{}
}
