export const testEnv={COMMUNITY_ADMIN_USER:'test-owner',COMMUNITY_ADMIN_PASSWORD:'test-only-owner-password-42'};
export function client(base,initialCookie=''){
 let cookie=initialCookie;
 const request=async(path,body,extra={})=>{
  const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)});
  const setCookie=r.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];
  return r;
 };
 const call=async(path,body,extra)=>{const r=await request('/api/'+path,body,extra);return {status:r.status,data:await r.json(),headers:r.headers};};
 return {request,call,get cookie(){return cookie;}};
}
export async function ownerClient(base){const owner=client(base);const r=await owner.call('auth/login',{username:testEnv.COMMUNITY_ADMIN_USER,password:testEnv.COMMUNITY_ADMIN_PASSWORD});if(r.status!==200)throw Error('Owner login failed');return owner;}
export async function approvedClient(base,owner,username,name){const person=client(base);await person.call('auth/register',{username,password:'test-member-password-42',name});const {data}=await owner.call('admin/members');const row=data.members.find(m=>m.username===username);await owner.call('admin/members/'+row.id,{status:'approved'});return person;}
