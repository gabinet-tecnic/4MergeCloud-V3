import * as api from './projectes.js';
import {el,button,modal} from './projectes-ui.js';
import {AnnotationHistory,drawOperations} from './annotation-model.js';
export async function openAnnotations(project,capture) {
  let dirty=false,closed=false,image,resize;const urls=[];
  const m=modal(capture.fileName,{full:true,onClose:()=>{if(dirty&&!confirm('Hi ha anotacions sense desar. Vols tancar igualment?'))return false;closed=true;resize?.disconnect();image?.close();urls.forEach(u=>URL.revokeObjectURL(u));window.removeEventListener('beforeunload',warn);}});
  m.dialog.classList.add('annotation-dialog');
  const warn=e=>{if(dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);
  m.body.append(el('p','Carregant imatge…',{role:'status'}));
  try{
    // Fetch fresh metadata each opening; prevents stale annotations after a previous save.
    const fresh=(await api.listCaptures(project.id)).find(c=>c.id===capture.id);if(!fresh)throw new Error('La captura ja no existeix.');
    const blob=await api.imageBlob(project.id,fresh.imagePath);image=await createImageBitmap(blob);if(closed){image.close();return;}
    const history=new AnnotationHistory(fresh.annotations||[]);let saved=JSON.stringify(history.ops),revision=fresh.revision||0;
    let tool='pencil',color='#ef4444',width=4,stroke=null,active=null,zoom=1,pan=[0,0],gesture=null;
    const pointers=new Map();
    const layout=el('div',null,{class:'annotation-layout'}),tools=el('nav',null,{class:'annotation-tools','aria-label':'Eines d’anotació'}),viewport=el('div',null,{class:'annotation-viewport'}),canvas=el('canvas',null,{'aria-label':'Imatge amb anotacions'}),status=el('p',null,{class:'annotation-status',role:'status'});
    canvas.width=image.width;canvas.height=image.height;viewport.append(canvas);layout.append(tools,viewport);m.body.replaceChildren(layout,status);
    const ctx=canvas.getContext('2d');const toolButtons=[];
    function redraw(){ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0);drawOperations(ctx,[...history.ops,...(stroke?[stroke]:[])],canvas.width,canvas.height);dirty=JSON.stringify(history.ops)!==saved;undo.disabled=!history.past.length;redo.disabled=!history.future.length;canvas.style.transform=`translate(${pan[0]}px,${pan[1]}px) scale(${zoom})`;status.textContent=dirty?'Canvis sense desar':'Un dit dibuixa · Dos dits mouen i amplien';}
    function fit(){zoom=Math.min(viewport.clientWidth/image.width,viewport.clientHeight/image.height);pan=[(viewport.clientWidth-image.width*zoom)/2,(viewport.clientHeight-image.height*zoom)/2];redraw();}
    for(const [value,label] of [['pencil','Llapis'],['line','Línia'],['arrow','Fletxa'],['rect','Rectangle'],['text','Text'],['pan','Moure vista']]){const b=button(label,()=>{tool=value;stroke=null;toolButtons.forEach(x=>x.setAttribute('aria-pressed',String(x===b)));redraw();});b.setAttribute('aria-pressed',String(value===tool));tools.append(b);toolButtons.push(b);}
    const colorLabel=el('label','Color'),colorInput=el('input',null,{type:'color',value:color,'aria-label':'Color'});colorInput.oninput=()=>color=colorInput.value;colorLabel.append(colorInput);tools.append(colorLabel);
    const palette=el('div');for(const c of ['#ef4444','#f59e0b','#10b981','#3b82f6','#ffffff','#111827']){const b=button('●',()=>{color=colorInput.value=c;});b.style.color=c;b.setAttribute('aria-label','Color '+c);palette.append(b);}tools.append(palette);
    const widthLabel=el('label','Gruix'),widthInput=el('input',null,{type:'number',min:'1',max:'100',value:'4','aria-label':'Gruix'});widthInput.oninput=()=>width=Math.max(1,Math.min(100,Number(widthInput.value)||1));widthLabel.append(widthInput);tools.append(widthLabel);
    const undo=button('Desfer',()=>{history.undo();redraw();}),redo=button('Refer',()=>{history.redo();redraw();});tools.append(undo,redo,button('Netejar tot',()=>{if(confirm('Esborrar totes les anotacions? Pots desfer aquesta acció.')){history.set([]);redraw();}}),button('Enquadrar',fit));
    const authorLabel=el('label','El teu nom'),author=el('input',null,{maxlength:'100','aria-label':'El teu nom'});author.value=fresh.authorName||'';authorLabel.append(author);tools.append(authorLabel);
    async function save(){if(!author.value.trim())throw new Error('Escriu el teu nom abans de desar.');const snapshot=JSON.parse(JSON.stringify(history.ops));const next=await api.saveAnnotations(project.id,capture.id,snapshot,author.value.trim(),revision);revision=next;saved=JSON.stringify(snapshot);capture.annotations=snapshot;capture.revision=revision;redraw();status.textContent=dirty?'Desat. Hi ha canvis nous pendents.':'✓ Anotacions desades';}
    const saveButton=button('Desar',save);tools.append(saveButton,button('Enviar per correu',async()=>{await save();const url=new URL('./',location.href);url.searchParams.set('project',project.slug);const mail=el('a','Obrir el correu',{href:'mailto:'+encodeURIComponent(project.ownerEmail||'')+'?subject='+encodeURIComponent('Anotacions sobre '+project.name)+'&body='+encodeURIComponent('He desat anotacions a «'+capture.fileName+'».\n'+url.href)});status.replaceChildren(el('span','Anotacions desades. '),mail);}),button('Descarregar PNG',async()=>{stroke=null;redraw();const b=await new Promise(r=>canvas.toBlob(r,'image/png'));if(!b)throw new Error('No s’ha pogut generar el PNG.');const u=URL.createObjectURL(b);urls.push(u);const a=el('a',null,{href:u,download:capture.fileName.replace(/\.png$/i,'')+'-anotacions.png'});a.click();}));
    function point(e){const r=viewport.getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-r.left-pan[0])/zoom/image.width)),Math.max(0,Math.min(1,(e.clientY-r.top-pan[1])/zoom/image.height))];}
    function pose(){const p=[...pointers.values()];return {mid:[(p[0][0]+p[1][0])/2,(p[0][1]+p[1][1])/2],distance:Math.hypot(p[0][0]-p[1][0],p[0][1]-p[1][1])||1};}
    viewport.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();viewport.setPointerCapture(e.pointerId);pointers.set(e.pointerId,[e.clientX,e.clientY]);
      if(pointers.size>=2){stroke=null;active=null;gesture={...pose(),pan:[...pan],zoom};redraw();return;}
      if(gesture)return;active=e.pointerId;
      if(tool==='pan'){gesture={one:true,start:[e.clientX,e.clientY],pan:[...pan]};return;}
      if(tool==='text'){const text=prompt('Text de l’anotació');if(text){history.set([...history.ops,{type:'text',text:text.slice(0,500),color,width,points:[point(e)]}]);redraw();}active=null;return;}
      stroke={type:tool,color,width,points:[point(e)]};if(tool!=='pencil')stroke.points.push(point(e));redraw();
    };
    viewport.onpointermove=e=>{if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,[e.clientX,e.clientY]);
      if(gesture){if(gesture.one){pan=[gesture.pan[0]+e.clientX-gesture.start[0],gesture.pan[1]+e.clientY-gesture.start[1]];}else if(pointers.size>=2){const p=pose(),r=viewport.getBoundingClientRect();zoom=Math.max(.01,Math.min(20,gesture.zoom*p.distance/gesture.distance));pan=[p.mid[0]-r.left-(gesture.mid[0]-r.left-gesture.pan[0])*zoom/gesture.zoom,p.mid[1]-r.top-(gesture.mid[1]-r.top-gesture.pan[1])*zoom/gesture.zoom];}redraw();return;}
      if(e.pointerId!==active||!stroke)return;if(tool==='pencil'){if(stroke.points.length<10000)stroke.points.push(point(e));}else stroke.points[1]=point(e);redraw();
    };
    function end(e,cancel=false){if(e.pointerId===active&&stroke&&!cancel&&!gesture){try{history.set([...history.ops,stroke]);}catch(err){alert(err.message);}}if(e.pointerId===active||gesture){stroke=null;active=null;}pointers.delete(e.pointerId);if(!pointers.size)gesture=null;redraw();}
    viewport.onpointerup=e=>end(e);viewport.onpointercancel=e=>end(e,true);viewport.onlostpointercapture=e=>{if(pointers.has(e.pointerId))end(e,true);};
    viewport.onwheel=e=>{e.preventDefault();const r=viewport.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,next=Math.max(.01,Math.min(20,zoom*Math.exp(-e.deltaY*.001)));pan=[x-(x-pan[0])*next/zoom,y-(y-pan[1])*next/zoom];zoom=next;redraw();};
    resize=new ResizeObserver(()=>fit());resize.observe(viewport);fit();
  }catch(e){if(!closed)m.body.replaceChildren(el('p',e.message));}
}
