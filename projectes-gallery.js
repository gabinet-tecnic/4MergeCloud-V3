import * as api from './projectes.js';
import {el,button,modal,field} from './projectes-ui.js';
export async function showGallery(project,{container}={}) {
  const urls=[];let closed=false;
  const m=container?{body:container,heading:el('h2'),dialog:container}:modal(project.name,{full:true,onClose:()=>{closed=true;urls.forEach(u=>URL.revokeObjectURL(u));}});
  m.body.replaceChildren();const title=el('h2',project.name),status=el('p','Carregant captures…',{role:'status'}),grid=el('div',null,{class:'projects-grid'});m.body.append(title,status,grid);
  try{const captures=await api.listCaptures(project.id);if(closed)return;
    status.textContent=captures.length?`${captures.length} captures`:'Encara no hi ha captures en aquest projecte';
    // Four concurrent downloads at most; revoke every blob on modal close.
    let next=0;async function worker(){while(next<captures.length&&!closed){const c=captures[next++],card=button('',async()=>{const {openAnnotations}=await import('./projectes-annotations.js');await openAnnotations(project,c);}),img=el('img',null,{alt:c.fileName,loading:'lazy'});card.append(img,el('span',c.fileName),el('small',c.uploadedAt?.toDate?.().toLocaleDateString('ca')||''));grid.append(card);
      try{const blob=await api.imageBlob(project.id,c.thumbPath);if(closed)return;const url=URL.createObjectURL(blob);urls.push(url);img.src=url;}catch{img.alt='Miniatura no disponible';}
    }}await Promise.all(Array.from({length:Math.min(4,captures.length)},worker));
  }catch(e){status.textContent=e.message;}
}
export async function startClientGallery() {
  const u=new URL(location.href),slug=u.searchParams.get('project');
  let password=new URLSearchParams(u.hash.slice(1)).get('pwd')||u.searchParams.get('pwd')||'';
  // Remove secrets from the visible URL/history before any Firebase/CDN requests.
  u.searchParams.delete('pwd');u.hash='';history.replaceState(null,'',u);
  const root=el('main',null,{class:'projects-client'});document.body.replaceChildren(root);
  root.append(el('h1','Projecte compartit'));
  if(!api.isConfigured()){root.append(el('p','Aquest espai encara no està configurat. Contacta amb el propietari del projecte.'));return;}
  async function enter(pwd){root.replaceChildren(el('h1','Obrint el projecte…'));try{const p=await api.getProjectBySlug(slug,pwd);password='';await showGallery(p,{container:root});}catch{password='';form('No s’ha pogut obrir el projecte. Comprova la contrasenya o contacta amb el propietari.');}}
  function form(message){root.replaceChildren(el('h1','Projecte compartit'),el('p',message));const f=el('form'),pwd=field(f,'Contrasenya','password'),b=el('button','Obrir projecte',{type:'submit'});f.append(b);root.append(f);f.onsubmit=async e=>{e.preventDefault();const value=pwd.value;pwd.value='';await enter(value);};}
  if(password)await enter(password);else form('Introdueix la contrasenya que t’ha facilitat el propietari.');
}
