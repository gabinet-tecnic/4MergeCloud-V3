import * as api from './projectes.js';
export function el(tag,text,attrs={}) {const n=document.createElement(tag);if(text)n.textContent=text;for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);return n;}
export function button(text,action) {const b=el('button',text,{type:'button'});b.onclick=async()=>{b.disabled=true;try{await action();}catch(e){alert(e.message||'No s’ha pogut completar l’operació.');}finally{b.disabled=false;}};return b;}
export function modal(title,{full=false,onClose}={}) {
  const d=el('dialog',null,{class:'projects-dialog'+(full?' projects-full':''),'aria-label':title});
  const h=el('header'),heading=el('h2',title),body=el('section',null,{class:'projects-body'});
  const close=()=>{if(onClose&&onClose()===false)return;d.close();d.remove();};
  h.append(heading,button('Tancar',close));d.append(h,body);document.body.append(d);d.addEventListener('cancel',e=>{e.preventDefault();close();});d.showModal();return {dialog:d,body,heading,close};
}
export function field(form,label,type='text',value='') {const l=el('label',label),i=el('input',null,{type,required:'',maxlength:type==='password'?'200':'120'});i.value=value;l.append(i);form.append(l);return i;}
export const slugify = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80);
export function shareURL(slug,password) {const u=new URL('./',location.href);u.searchParams.set('project',slug);u.hash=new URLSearchParams({pwd:password}).toString();return u.href;}
let projects=[],currentUser=null;
const listeners=new Set();
export function subscribeProjects(cb){listeners.add(cb);cb(projects,currentUser);return()=>listeners.delete(cb);}
async function refresh(){projects=currentUser?await api.getOwnerProjects():[];for(const cb of listeners)cb(projects,currentUser);}
export async function openGallery(project){const {showGallery}=await import('./projectes-gallery.js');return showGallery(project);}
export async function openProjects() {
  const m=modal('Projectes');
  if(!api.isConfigured()){m.body.append(el('p','Primer cal configurar Firebase per desar i compartir projectes. El visor 3D continua disponible.'),el('a','Com configurar Firebase',{href:'./README.md',target:'_blank',rel:'noopener'}));return;}
  async function render(){
    m.body.replaceChildren();
    if(!currentUser){const f=el('form'),email=field(f,'Correu electrònic','email'),pwd=field(f,'Contrasenya','password');email.autocomplete='username';pwd.autocomplete='current-password';
      const submit=el('button','Entrar',{type:'submit'}),status=el('p',null,{role:'status'});f.append(submit,status);m.body.append(f);
      f.onsubmit=async e=>{e.preventDefault();submit.disabled=true;status.textContent='Entrant…';try{await api.signInOwner(email.value,pwd.value);pwd.value='';}catch(err){status.textContent='No s’ha pogut entrar. Comprova les credencials i la configuració.';}finally{submit.disabled=false;}};return;}
    m.body.append(el('p',currentUser.email),button('Sortir',()=>api.signOutOwner()),button('Nou projecte',()=>newProject(render)));
    const status=el('p','Carregant projectes…',{role:'status'});m.body.append(status);
    try {await refresh();if(!m.dialog.isConnected)return;status.textContent=projects.length?'':'Encara no tens projectes.';
      for(const p of projects){const row=el('article',null,{class:'project-row'});row.append(el('h3',p.name),el('p',`${p.slug} · ${p.captureCount} captures · ${p.createdAt?.toDate?.().toLocaleDateString('ca')||''}`));
        row.append(button('Veure captures',()=>openGallery(p)),button('Compartir',()=>shareProject(p)),button(p.deleting?'Reintentar esborrat':'Esborrar',async()=>{if(confirm(`Esborrar «${p.name}» i totes les captures? Aquesta acció és permanent.`)){await api.deleteProject(p.id);await render();}}));m.body.append(row);}
    }catch(e){status.textContent=e.message;}
  }
  let unsubscribe=()=>{};m.dialog.addEventListener('close',()=>unsubscribe(),{once:true});
  unsubscribe=await api.onAuthChange(u=>{currentUser=u;render().catch(e=>{m.body.textContent=e.message;});});
}
async function newProject(done){const m=modal('Nou projecte'),f=el('form'),name=field(f,'Nom'),slug=field(f,'Adreça curta (slug)'),pwd=field(f,'Contrasenya del client (mínim 12 caràcters)','password');pwd.minLength=12;pwd.autocomplete='new-password';let edited=false;slug.oninput=()=>edited=true;name.oninput=()=>{if(!edited)slug.value=slugify(name.value);};const b=el('button','Crear projecte',{type:'submit'}),status=el('p',null,{role:'status'});f.append(b,status);m.body.append(f);f.onsubmit=async e=>{e.preventDefault();b.disabled=true;try{await api.createProject({name:name.value.trim(),slug:slug.value,clientPassword:pwd.value});pwd.value='';m.close();await done();}catch(err){status.textContent=err.message;}finally{b.disabled=false;}};}
function shareProject(p){const m=modal('Compartir '+p.name),f=el('form'),pwd=field(f,'Contrasenya del client','password');const b=el('button','Preparar enllaç',{type:'submit'}),status=el('p',null,{role:'status'});f.append(b,status);m.body.append(f);f.onsubmit=async e=>{e.preventDefault();b.disabled=true;try{await api.verifySharePassword(p.id,pwd.value);const url=shareURL(p.slug,pwd.value);pwd.value='';m.body.replaceChildren(el('p','Qualsevol persona amb aquest enllaç podrà veure i anotar les captures.'));const input=el('textarea',null,{'aria-label':'Enllaç per compartir',readonly:''});input.value=url;m.body.append(input,button('Copiar enllaç',async()=>{await navigator.clipboard.writeText(url);input.select();}),el('a','Enviar per correu',{href:'mailto:?subject='+encodeURIComponent('Projecte '+p.name)+'&body='+encodeURIComponent(url)}));}catch(err){status.textContent=err.message;}finally{b.disabled=false;}};}
export async function mountProjects({capture}={}) {
  document.getElementById('tbProjects')?.addEventListener('click',()=>openProjects().catch(e=>alert(e.message)));
  const launch=document.getElementById('tbProjects');if(launch)launch.disabled=false;
  const select=document.getElementById('orthoProject'),upload=document.getElementById('orthoProjectUpload'),status=document.getElementById('orthoProjectStatus');
  subscribeProjects((rows,user)=>{if(!select)return;const old=select.value;select.replaceChildren(el('option',user?'Tria un projecte':'Inicia sessió a Projectes',{value:''}));for(const p of rows)if(!p.deleting)select.append(el('option',p.name,{value:p.id}));select.value=old;upload.disabled=!user;});
  if(upload)upload.onclick=async()=>{upload.disabled=true;try{const p=projects.find(p=>p.id===select.value);if(!p)throw new Error('Tria un projecte.');status.textContent='Capturant i pujant…';const result=await capture();if(!result){status.textContent='Captura cancel·lada.';return;}await api.uploadCapture(p.id,result.blob,result.name,result.metadata);status.replaceChildren(el('span','✓ Pujada a projecte «'+p.name+'». '),button('Veure galeria',()=>openGallery(p)));await refresh();}catch(e){status.textContent=e.message;}finally{upload.disabled=!currentUser;}};
  if(api.isConfigured())try{await api.onAuthChange(async u=>{currentUser=u;try{await refresh();}catch(e){if(status)status.textContent=e.message;}});}catch(e){if(status)status.textContent='Firebase no disponible. Pots continuar treballant al visor.';}
}
