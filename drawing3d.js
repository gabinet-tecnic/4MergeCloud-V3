import { cutPath, distanceToSegment } from './drawing-geometry.js';

const clone = value => JSON.parse(JSON.stringify(value));
const uid = () => crypto.randomUUID();
const plane = (name='Terra', origin=[0,0,0], u=[1,0,0], v=[0,0,-1]) => ({id:uid(),name,origin,u,v});
const layer = name => ({id:uid(),name,visible:true,locked:false});

export function createEditor2D(ctx) {
  const {THREE, scene, renderer} = ctx, canvas=renderer.domElement;
  const group=new THREE.Group(); group.name='Dibuix 3D'; scene.add(group);
  // The work plane is a fine line grid, never a field of point markers.
  const workGrid=new THREE.GridHelper(40,80,0xd8dde3,0xd8dde3);
  workGrid.name='Quadrícula de dibuix';workGrid.visible=false;
  workGrid.material.transparent=true;workGrid.material.opacity=0.18;
  workGrid.material.depthWrite=false;scene.add(workGrid);
  let gridEnabled=true;
  const initialPlane=plane(), initialLayer=layer('Dibuix 1');
  let state={version:2,planes:[initialPlane],layers:[initialLayer],strokes:[],activePlane:initialPlane.id,activeLayer:initialLayer.id};
  let active=false, mode='draw', selected=null, gesture=null, picking=[], through=false, sideWasCollapsed=false;
  let undoStack=[], redoStack=[], color='#ffb84d', width=0.01;
  const touches=new Set(), V=a=>new THREE.Vector3(...a);
  const getPlane = id => state.planes.find(p=>p.id===id);
  const getLayer = id => state.layers.find(l=>l.id===id);
  const editable = s => { const l=getLayer(s.layerId); return l?.visible && !l.locked && s.layerId===state.activeLayer; };
  const world = (p,q) => V(p.origin).addScaledVector(V(p.u),q[0]).addScaledVector(V(p.v),q[1]);
  const local = (p,w) => { const d=w.clone().sub(V(p.origin)); return [d.dot(V(p.u)),d.dot(V(p.v))]; };
  const project = (p,q) => {
    const camera=ctx.getActiveCamera();camera.updateMatrixWorld();
    const v=world(p,q).project(camera), r=canvas.getBoundingClientRect();
    return [r.left+(v.x+1)*r.width/2,r.top+(1-v.y)*r.height/2,v.z];
  };
  function onPlane(e,p=getPlane(state.activePlane)) {
    const r=canvas.getBoundingClientRect(), ray=new THREE.Raycaster();
    const camera=ctx.getActiveCamera();camera.updateMatrixWorld();
    ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2),camera);
    const normal=V(p.u).cross(V(p.v)).normalize();
    if(Math.abs(ray.ray.direction.dot(normal))<0.025) return null;
    const hit=ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal,V(p.origin)),new THREE.Vector3());
    return hit ? local(p,hit) : null;
  }
  function hitStroke(e) {
    let best=null, distance=12;
    for(const s of state.strokes.filter(editable)) {
      const p=getPlane(s.planeId);
      for(let i=1;i<s.points.length;i++) {
        const a=project(p,s.points[i-1]), b=project(p,s.points[i]);
        if(a[2]<-1||a[2]>1||b[2]<-1||b[2]>1) continue;
        const hit=distanceToSegment([e.clientX,e.clientY],a,b);
        if(hit.distance<distance) {distance=hit.distance;best=s;}
      }
    } return best;
  }
  function disposeChildren() {
    while(group.children.length) { const o=group.children[0]; group.remove(o); o.geometry?.dispose(); o.material?.dispose(); }
  }
  function drawStroke(s,highlight=false) {
    const p=getPlane(s.planeId); if(!p||s.points.length<2) return;
    const pos=[], half=s.width/2, N=V(p.u).cross(V(p.v)).normalize();
    const triangle=(a,b,c)=>pos.push(...a.toArray(),...b.toArray(),...c.toArray());
    for(let i=1;i<s.points.length;i++) {
      const a=world(p,s.points[i-1]), b=world(p,s.points[i]);
      const side=b.clone().sub(a).cross(N).normalize().multiplyScalar(half);
      triangle(a.clone().add(side),a.clone().sub(side),b.clone().add(side));
      triangle(b.clone().add(side),a.clone().sub(side),b.clone().sub(side));
    }
    // Round joins and caps, with physical width consistent in perspective and PNG.
    for(const q of s.points) {
      const c=world(p,q);
      for(let j=0;j<8;j++) {
        const at=t=>c.clone().addScaledVector(V(p.u),Math.cos(t)*half).addScaledVector(V(p.v),Math.sin(t)*half);
        triangle(c,at(j*Math.PI/4),at((j+1)*Math.PI/4));
      }
    }
    const geometry=new THREE.BufferGeometry(); geometry.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:highlight?'#ffffff':s.color,side:THREE.DoubleSide,depthTest:!through,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
    mesh.renderOrder=10;group.add(mesh);
    if(highlight && mode==='edit') {
      const camera=ctx.getActiveCamera(), center=world(p,s.points[0]);
      const h=camera.isOrthographicCamera ? (camera.top-camera.bottom)/camera.zoom : 2*camera.position.distanceTo(center)*Math.tan(camera.fov*Math.PI/360);
      const half=h/canvas.getBoundingClientRect().height*4, vertices=[];
      for(const q of s.points) {
        const corners=[[-half,-half],[half,-half],[half,half],[-half,half]];
        for(let i=0;i<4;i++)for(const c of [corners[i],corners[(i+1)%4]])vertices.push(world(p,[q[0]+c[0],q[1]+c[1]]));
      }
      const g=new THREE.BufferGeometry().setFromPoints(vertices);
      const handles=new THREE.LineSegments(g,new THREE.LineBasicMaterial({color:0xe8edf2,depthTest:false}));
      handles.renderOrder=11;group.add(handles);
    }
  }
  function updateGrid() {
    const p=getPlane(state.activePlane);if(!p)return;
    workGrid.position.copy(V(p.origin));
    workGrid.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(p.u),V(p.v).cross(V(p.u)),V(p.v)));
    workGrid.visible=active&&gridEnabled;
  }

  function render() {
    updateGrid();
    disposeChildren();
    for(const s of state.strokes) if(getLayer(s.layerId)?.visible) drawStroke(s,s.id===selected);
    if(gesture?.stroke) drawStroke(gesture.stroke);
    if(gesture?.rect) {
      const [a,b]=gesture.rect;
      drawStroke({planeId:state.activePlane,points:[a,[b[0],a[1]],b,[a[0],b[1]],a],width,color:'#ff6666'});
    }
  }
  function status(text) { panel.querySelector('[data-status]').textContent=text; }
  function commit(before) {
    if(JSON.stringify(before)===JSON.stringify(state)) {render();refresh();return;}
    state.updatedAt=Date.now();
    undoStack.push(before);if(undoStack.length>50) undoStack.shift();redoStack=[];
    render();refresh();api.onChange?.();
  }
  function change(fn) { cancel(); const before=clone(state);fn();commit(before); }
  function cancel() {
    if(gesture) { state=gesture.before; const id=gesture.id;gesture=null; if(canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id); }
    render();
  }
  function history(from,to) {
    cancel(); if(!from.length)return;
    to.push(clone(state));state=from.pop();state.updatedAt=Date.now();selected=null;picking=[];render();refresh();api.onChange?.();
  }
  function applyCut(region) {
    const next=[];
    for(const s of state.strokes) {
      if(!editable(s)||s.planeId!==state.activePlane) {next.push(s);continue;}
      const paths=cutPath(s.points,region);
      if(paths.length===1&&JSON.stringify(paths[0])===JSON.stringify(s.points)) {next.push(s);continue;}
      for(const points of paths) next.push({...s,id:uid(),points});
    } state.strokes=next;selected=null;
  }
  function brush(e) {
    const q=onPlane(e); if(!q) return;
    const edge=onPlane({clientX:e.clientX+12,clientY:e.clientY});
    const radius=edge?Math.hypot(edge[0]-q[0],edge[1]-q[1]):width*3;
    applyCut({kind:'circle',center:q,radius});
  }
  function down(e) {
    if(!active)return;
    if(e.pointerType==='touch') {touches.add(e.pointerId);cancel();return;}
    if(!['mouse','pen'].includes(e.pointerType)||e.button!==0||touches.size||mode==='navigate')return;
    e.preventDefault();e.stopImmediatePropagation();
    if(gesture)return;
    if(mode==='plane-pick') {
      const w=ctx.pickSurfacePoint(e.clientX,e.clientY);
      if(!w){status('Tria un punt del model o del núvol.');return;}
      picking.push(w);
      if(picking.length<3){status(`Pla: punt ${picking.length}/3. Tria el següent.`);return;}
      const [a,b,c]=picking, u=b.clone().sub(a).normalize(), n=b.clone().sub(a).cross(c.clone().sub(a));
      if(n.length()<1e-8){picking=[];status('Els punts estan alineats. Torna a triar-ne tres.');return;}
      const v=n.normalize().cross(u).normalize();
      change(()=>{const p=plane('Pla '+(state.planes.length+1),a.toArray(),u.toArray(),v.toArray());state.planes.push(p);state.activePlane=p.id;});
      picking=[];api.setMode('draw');status('Pla fixat amb tres punts. Ja hi pots dibuixar.');return;
    }
    const l=getLayer(state.activeLayer);
    if(!l?.visible||l.locked){status('Mostra i desbloqueja la capa activa per editar-la.');return;}
    const before=clone(state);
    let s=null, q;
    if(['select','edit','delete'].includes(mode)) {
      s=hitStroke(e);selected=s?.id||null;
      if(!s){render();refresh();return;}
      state.activePlane=s.planeId;q=onPlane(e,getPlane(s.planeId));
      if(mode==='delete'){state.strokes=state.strokes.filter(x=>x.id!==s.id);selected=null;commit(before);return;}
    } else q=onPlane(e);
    if(!q){status('El pla es veu de cantell. Gira la vista per poder dibuixar.');return;}
    gesture={id:e.pointerId,before,start:q,last:[e.clientX,e.clientY]};
    if(s) {
      gesture.selected=s.id;gesture.original=clone(s.points);
      if(mode==='edit') {
        let index=-1, distance=14;
        s.points.forEach((pt,i)=>{const xy=project(getPlane(s.planeId),pt), d=Math.hypot(xy[0]-e.clientX,xy[1]-e.clientY);if(d<distance){distance=d;index=i;}});
        gesture.node=index;
        if(index<0){gesture=null;status('Arrossega un dels petits quadrats del traç.');render();refresh();return;}
      }
    } else if(mode==='erase') brush(e);
    else if(mode==='trim') gesture.rect=[q,q];
    else gesture.stroke={id:uid(),layerId:state.activeLayer,planeId:state.activePlane,color,width,points:[q,q]};
    canvas.setPointerCapture(e.pointerId);render();refresh();
  }
  function move(e) {
    if(!active||!gesture||e.pointerId!==gesture.id||e.pointerType==='touch')return;
    e.preventDefault();e.stopImmediatePropagation();
    const q=onPlane(e);if(!q)return;
    if(gesture.selected) {
      const s=state.strokes.find(x=>x.id===gesture.selected);
      if(mode==='edit') {
        s.points[gesture.node]=q;
        const original=gesture.original, last=original.length-1;
        if((gesture.node===0||gesture.node===last)&&original[0][0]===original[last][0]&&original[0][1]===original[last][1]) {
          s.points[0]=q;s.points[last]=q.slice();
        }
      }
      else s.points=gesture.original.map(p=>[p[0]+q[0]-gesture.start[0],p[1]+q[1]-gesture.start[1]]);
    } else if(mode==='erase') {
      const last=gesture.last, d=Math.hypot(e.clientX-last[0],e.clientY-last[1]), steps=Math.max(1,Math.ceil(d/5));
      for(let i=1;i<=steps;i++)brush({clientX:last[0]+(e.clientX-last[0])*i/steps,clientY:last[1]+(e.clientY-last[1])*i/steps});
    } else if(mode==='trim')gesture.rect[1]=q;
    else if(mode==='line')gesture.stroke.points=[gesture.start,q];
    else if(mode==='rect')gesture.stroke.points=[gesture.start,[q[0],gesture.start[1]],q,[gesture.start[0],q[1]],gesture.start];
    else {
      const samples=e.getCoalescedEvents?.()||[];
      for(const ev of samples.length?samples:[e]) {
        const pt=onPlane(ev); if(!pt)continue;
        const prev=gesture.stroke.points.at(-1);
        if(Math.hypot(pt[0]-prev[0],pt[1]-prev[1])>1e-6)gesture.stroke.points.push(pt);
      }
    }
    gesture.last=[e.clientX,e.clientY];render();
  }
  function up(e) {
    if(e.pointerType==='touch'){touches.delete(e.pointerId);return;}
    if(!gesture||gesture.id!==e.pointerId)return;
    e.preventDefault();e.stopImmediatePropagation();move(e);
    const g=gesture;
    if(g.stroke && g.stroke.points.some(p=>Math.hypot(p[0]-g.start[0],p[1]-g.start[1])>1e-6))state.strokes.push(g.stroke);
    if(g.rect) { const [a,b]=g.rect;applyCut({kind:'rect',min:[Math.min(a[0],b[0]),Math.min(a[1],b[1])],max:[Math.max(a[0],b[0]),Math.max(a[1],b[1])]}); }
    gesture=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);commit(g.before);
  }
  function pointerCancel(e) { touches.delete(e.pointerId);if(gesture?.id===e.pointerId)cancel(); }
  canvas.addEventListener('pointerdown',down,true);canvas.addEventListener('pointermove',move,true);canvas.addEventListener('pointerup',up,true);
  canvas.addEventListener('pointercancel',pointerCancel,true);canvas.addEventListener('lostpointercapture',pointerCancel,true);
  const releaseTouch=e=>{if(e.pointerType==='touch')touches.delete(e.pointerId);};
  window.addEventListener('pointerup',releaseTouch,true);window.addEventListener('pointercancel',releaseTouch,true);
  const blur=()=>{cancel();touches.clear();};window.addEventListener('blur',blur);

  const style=document.createElement('style');style.textContent=`
    #drawingPalette{position:fixed;top:88px;left:24px;width:252px;max-width:calc(100vw - 16px);max-height:calc(100dvh - 104px);overflow:auto;z-index:90;background:#1b2028;color:#e8ebef;border:1px solid #424953;border-radius:12px;box-shadow:0 10px 32px #0005;font:13px system-ui}
    #drawingPalette header{display:flex;align-items:center;gap:6px;padding:10px 12px;cursor:move;touch-action:none;border-bottom:1px solid #343b44}
    #drawingPalette header strong{flex:1;font-size:14px;font-weight:600}#drawingPalette header button{min-height:26px;padding:2px 8px;background:transparent;border:0;color:#aeb8c4}
    #drawingPalette .body{padding:12px}#drawingPalette .row{display:flex;gap:6px;align-items:center;margin:9px 0;flex-wrap:wrap}
    #drawingPalette button,#drawingPalette select,#drawingPalette input{font:inherit;color:inherit;background:#262d37;border:1px solid #414a57;border-radius:6px;padding:7px;min-width:0}
    #drawingPalette button{cursor:pointer;min-height:34px}#drawingPalette button:hover{background:#343e4c}#drawingPalette button[aria-pressed=true]{background:#dce3eb;color:#17202c;border-color:#dce3eb}#drawingPalette button:disabled{opacity:.35;cursor:default}
    #drawingPalette select{max-width:100%;flex:1}#drawingPalette input[type=number]{width:57px}#drawingPalette input[type=color]{width:34px;height:30px;padding:3px}
    #drawingPalette .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}#drawingPalette small{color:#a7b2bf;line-height:1.45;display:block;font-size:11px}
    #drawingPalette .layers{max-height:155px;overflow:auto}.drawing-layer{display:flex;gap:4px;margin:5px 0}.drawing-layer input{flex:1;width:60px}.drawing-layer.active{border-left:2px solid #dce3eb;padding-left:4px}
    #drawingPalette details{border-top:1px solid #343b44;margin-top:10px;padding-top:2px}#drawingPalette summary{cursor:pointer;padding:9px 0;color:#cbd3dc;font-size:12px}
    #drawingPalette .equal>*{flex:1}#drawingPalette .muted button{background:transparent;color:#bdc7d3}#drawingPalette [data-status]{margin-top:8px;color:#aebdcc;font-size:11px}#drawingPalette [data-status]:empty{display:none}
    #palDraw .pal-scroll{display:none!important}#palDraw .drawing-intro{padding:14px;line-height:1.6}
  `;document.head.append(style);
  const panel=document.createElement('section');panel.id='drawingPalette';panel.hidden=true;panel.setAttribute('aria-label','Eines de dibuix 3D');
  panel.innerHTML=`<header><strong>Dibuix</strong><button data-action="collapse" title="Plegar eines" aria-label="Plegar eines">−</button><button data-action="close" title="Sortir del dibuix" aria-label="Sortir del dibuix">×</button></header><div class="body">
    <div class="grid">${[['draw','Dibuixar'],['select','Moure'],['erase','Goma'],['trim','Retallar']].map(([m,t])=>`<button data-mode="${m}">${t}</button>`).join('')}</div>
    <div class="row"><input data-color type="color" value="#ffb84d" aria-label="Color del traç"><label>Gruix <input data-width type="number" min="1" max="1000" value="10" step="1" aria-label="Gruix del traç en mil·límetres"> mm</label></div>
    <div class="row equal muted"><button data-action="undo">Desfer</button><button data-action="redo">Refer</button></div>
    <div class="row equal"><button data-action="face">Vista plana</button><button data-action="perspective">Vista 3D</button></div>
    <details data-section="layers"><summary data-layer-summary>Capes</summary>
      <div class="layers" data-layers></div><div class="row"><button data-action="layer">+ Capa</button><button data-action="delete-layer">Eliminar capa</button></div>
      <div class="row"><select data-destination aria-label="Capa de destí"></select><button data-action="move-layer">Moure a capa</button></div>
    </details>
    <details data-section="plane"><summary data-plane-summary>Pla de dibuix</summary>
      <div class="row"><select data-plane aria-label="Pla de treball"></select></div>
      <div class="row"><select data-axis aria-label="Orientació del nou pla"><option value="top">Terra</option><option value="front">Façana</option><option value="side">Lateral</option></select><input data-offset aria-label="Posició del pla en metres" type="number" value="0" step="0.1"><span>m</span></div>
      <div class="row"><button data-action="plane">Crear pla</button><button data-mode="plane-pick">Triar 3 punts</button></div>
      <label><input data-grid type="checkbox" checked> Quadrícula</label>
    </details>
    <details data-section="tools"><summary>Més eines</summary>
      <div class="grid">${[['line','Línia'],['rect','Rectangle'],['edit','Ajustar traç'],['navigate','Navegar'],['delete','Esborrar traç']].map(([m,t])=>`<button data-mode="${m}">${t}</button>`).join('')}</div>
      <div class="row"><button data-action="style">Aplicar estil</button><button data-action="duplicate">Duplicar</button></div>
      <label><input data-through type="checkbox"> Veure a través del model</label>
    </details>
    <div class="row equal"><button data-action="save">Desar</button><button data-action="png">Imatge PNG</button></div>
    <details data-section="files"><summary>Obrir i opcions d’imatge</summary>
      <div class="row"><button data-action="load">Obrir dibuix</button><input data-file type="file" accept=".json,.4draw" hidden></div>
      <div class="row"><select data-export aria-label="Contingut del PNG"><option value="view">Vista amb model</option><option value="drawing">Dibuix transparent</option><option value="layer">Només la capa activa</option></select></div>
    </details>
    <small>Llapis o ratolí: dibuixar.<br>Dits: moure la vista i fer zoom.</small><small data-status role="status"></small>
  </div>`;document.body.append(panel);
  const intro=document.createElement('div');intro.className='drawing-intro';intro.textContent='Dibuix 3D amb capes. Les eines són a la caixa flotant; arrossega’n la capçalera per moure-la.';
  const show=document.createElement('button');show.textContent='Mostrar eines';show.onclick=()=>{panel.hidden=false;panel.querySelector('.body').hidden=false;clampPanel();};intro.append(document.createElement('br'),show);document.getElementById('palDraw')?.append(intro);
  let drag=null;
  const header=panel.querySelector('header');
  function clampPanel(){const r=panel.getBoundingClientRect();panel.style.left=Math.max(8,Math.min(r.left,innerWidth-r.width-8))+'px';panel.style.top=Math.max(8,Math.min(r.top,innerHeight-Math.min(r.height,innerHeight-16)-8))+'px';panel.style.right='auto';}
  header.onpointerdown=e=>{if(e.target.closest('button'))return;const r=panel.getBoundingClientRect();drag=[e.clientX-r.left,e.clientY-r.top];header.setPointerCapture(e.pointerId);};
  header.onpointermove=e=>{if(!drag)return;panel.style.left=e.clientX-drag[0]+'px';panel.style.top=e.clientY-drag[1]+'px';panel.style.right='auto';clampPanel();};
  header.onpointerup=header.onpointercancel=()=>{drag=null;};window.addEventListener('resize',clampPanel);
  function options(select,items,value){select.replaceChildren(...items.map(item=>{const o=document.createElement('option');o.value=item.id;o.textContent=item.name;return o;}));select.value=value;}
  function refresh() {
    options(panel.querySelector('[data-plane]'),state.planes,state.activePlane);
    panel.querySelector('[data-plane-summary]').textContent='Pla · '+getPlane(state.activePlane).name;
    panel.querySelector('[data-layer-summary]').textContent='Capes · '+getLayer(state.activeLayer).name;
    const dest=panel.querySelector('[data-destination]'), previous=dest.value;
    options(dest,state.layers.filter(l=>!l.locked),previous||state.activeLayer);
    const list=panel.querySelector('[data-layers]');list.replaceChildren();
    for(const l of state.layers) {
      const row=document.createElement('div');row.className='drawing-layer'+(l.id===state.activeLayer?' active':'');
      const choose=document.createElement('button');choose.textContent=l.id===state.activeLayer?'✓':'—';choose.title='Activar capa';choose.onclick=()=>{cancel();state.activeLayer=l.id;selected=null;render();refresh();};
      const name=document.createElement('input');name.value=l.name;name.setAttribute('aria-label','Nom de capa');name.onchange=()=>change(()=>{l.name=name.value.trim()||'Capa';});
      const visible=document.createElement('button');visible.textContent=l.visible?'Veure':'Oculta';visible.title=l.visible?'Ocultar capa':'Mostrar capa';visible.setAttribute('aria-label',visible.title);visible.onclick=()=>change(()=>{l.visible=!l.visible;selected=null;});
      const lock=document.createElement('button');lock.textContent=l.locked?'Fix':'Lliure';lock.title=l.locked?'Desbloquejar capa':'Bloquejar capa';lock.setAttribute('aria-label',lock.title);lock.onclick=()=>change(()=>{l.locked=!l.locked;selected=null;});
      row.append(choose,name,visible,lock);list.append(row);
    }
    panel.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));
    panel.querySelector('[data-action=undo]').disabled=!undoStack.length;panel.querySelector('[data-action=redo]').disabled=!redoStack.length;
    const canEdit=state.strokes.some(s=>s.id===selected&&editable(s));
    for(const action of ['style','duplicate','move-layer'])panel.querySelector(`[data-action=${action}]`).disabled=!canEdit;
  }
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}
  function exportPNG(kind) {
    cancel(); const selection=selected;selected=null;render();
    const background=scene.background, alpha=renderer.getClearAlpha(), saved=[];
    const oldLayers=state.layers.map(l=>l.visible), gridVisible=workGrid.visible;
    workGrid.visible=false;
    try {
      if(kind!=='view') {
        for(const child of scene.children)if(child!==group){saved.push([child,child.visible]);child.visible=false;}
        scene.background=null;renderer.setClearAlpha(0);
        if(kind==='layer'){state.layers.forEach(l=>l.visible=l.id===state.activeLayer);render();}
      }
      workGrid.visible=false;
      ctx.setExportHelpersVisible?.(false);
      renderer.render(scene,ctx.getActiveCamera());
      const out=document.createElement('canvas');out.width=canvas.width;out.height=canvas.height;out.getContext('2d').drawImage(canvas,0,0);
      out.toBlob(blob=>{if(blob){download(blob,'dibuix-'+kind+'.png');status('PNG exportat a la resolució del visor.');}else status('No s’ha pogut generar el PNG.');},'image/png');
    } catch(e){status('Error exportant PNG: '+e.message);}
    finally {
      saved.forEach(([o,v])=>o.visible=v);scene.background=background;renderer.setClearAlpha(alpha);state.layers.forEach((l,i)=>l.visible=oldLayers[i]);
      ctx.setExportHelpersVisible?.(true);selected=selection;render();workGrid.visible=gridVisible;renderer.render(scene,ctx.getActiveCamera());
    }
  }
  panel.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.dataset.mode){api.setMode(b.dataset.mode);return;}
    const s=state.strokes.find(s=>s.id===selected&&editable(s));
    switch(b.dataset.action){
      case 'collapse': {const body=panel.querySelector('.body');body.hidden=!body.hidden;b.textContent=body.hidden?'+':'−';break;}
      case 'close':ctx.closeDrawing();break;
      case 'undo':api.undo();break;case 'redo':api.redo();break;
      case 'face':cancel();ctx.alignToPlane(getPlane(state.activePlane));break;
      case 'perspective':cancel();ctx.perspective();break;
      case 'plane': {const axis=panel.querySelector('[data-axis]').value,d=Number(panel.querySelector('[data-offset]').value);if(!Number.isFinite(d))return;
        change(()=>{const p=axis==='top'?plane('Terra · '+d+' m',[0,d,0]):axis==='front'?plane('Façana · '+d+' m',[0,0,d],[1,0,0],[0,1,0]):plane('Lateral · '+d+' m',[d,0,0],[0,0,-1],[0,1,0]);state.planes.push(p);state.activePlane=p.id;});break;}
      case 'layer':change(()=>{const l=layer('Dibuix '+(state.layers.length+1));state.layers.push(l);state.activeLayer=l.id;selected=null;});break;
      case 'delete-layer':{const l=getLayer(state.activeLayer);if(l.locked){status('Desbloqueja la capa per eliminar-la.');break;}if(!confirm('Eliminar la capa «'+l.name+'» i els seus traços?'))break;
        change(()=>{state.strokes=state.strokes.filter(s=>s.layerId!==l.id);state.layers=state.layers.filter(x=>x.id!==l.id);if(!state.layers.length)state.layers.push(layer('Dibuix 1'));state.activeLayer=state.layers[0].id;selected=null;});break;}
      case 'style':if(s)change(()=>{s.color=color;s.width=width;});break;
      case 'duplicate':if(s)change(()=>{const copy={...clone(s),id:uid(),points:s.points.map(p=>[p[0]+0.1,p[1]+0.1])};state.strokes.push(copy);selected=copy.id;});break;
      case 'move-layer':{const l=getLayer(panel.querySelector('[data-destination]').value);if(s&&l&&!l.locked)change(()=>{s.layerId=l.id;state.activeLayer=l.id;});break;}
      case 'png':exportPNG(panel.querySelector('[data-export]').value);break;
      case 'save':cancel();download(new Blob([JSON.stringify({format:'4mc-drawing',drawing:state})],{type:'application/json'}),'dibuix.4draw');status('Dibuix editable desat.');break;
      case 'load':panel.querySelector('[data-file]').click();break;
    }
  });
  panel.querySelector('[data-plane]').onchange=e=>{cancel();state.activePlane=e.target.value;selected=null;render();refresh();};
  panel.querySelector('[data-color]').oninput=e=>{color=e.target.value;};
  panel.querySelector('[data-width]').onchange=e=>{width=Math.max(0.001,Math.min(1,Number(e.target.value)/1000||0.01));e.target.value=Math.round(width*1000);};
  panel.querySelector('[data-grid]').onchange=e=>{gridEnabled=e.target.checked;updateGrid();};
  panel.querySelector('[data-through]').onchange=e=>{through=e.target.checked;render();};
  panel.querySelector('[data-file]').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const json=JSON.parse(await file.text());if(json.format!=='4mc-drawing')throw Error('Format de dibuix desconegut');const next=validated(json.drawing);change(()=>{state=next;selected=null;});status('Dibuix carregat. Pots desfer per recuperar l’anterior.');}catch(err){status(err.message);}e.target.value='';};
  function key(e){
    if(!active||e.target.closest('input,textarea,select,[contenteditable=true]'))return;
    if(e.key==='Escape'){cancel();picking=[];selected=null;render();refresh();}
    if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();e.stopImmediatePropagation();(e.shiftKey||e.key.toLowerCase()==='y'?api.redo:api.undo)();}
    if(e.key==='Delete'&&selected){e.preventDefault();change(()=>{state.strokes=state.strokes.filter(s=>s.id!==selected||!editable(s));selected=null;});}
  }document.addEventListener('keydown',key,true);

  function validated(input){
    const s=clone(input);
    if(s?.version!==2||!Array.isArray(s.planes)||!s.planes.length||!Array.isArray(s.layers)||!s.layers.length||!Array.isArray(s.strokes))throw Error('Dibuix no vàlid');
    const finite=(a,n)=>Array.isArray(a)&&a.length===n&&a.every(Number.isFinite);
    const ids=items=>items.every(x=>typeof x.id==='string')&&new Set(items.map(x=>x.id)).size===items.length;
    if(!ids(s.planes)||!ids(s.layers)||!ids(s.strokes))throw Error('Identificadors de dibuix no vàlids');
    for(const p of s.planes)if(!finite(p.origin,3)||!finite(p.u,3)||!finite(p.v,3)||Math.abs(V(p.u).length()-1)>1e-5||Math.abs(V(p.v).length()-1)>1e-5||Math.abs(V(p.u).dot(V(p.v)))>1e-5)throw Error('Pla de dibuix no vàlid');
    for(const x of s.strokes)if(!s.planes.some(p=>p.id===x.planeId)||!s.layers.some(l=>l.id===x.layerId)||!Array.isArray(x.points)||x.points.length<2||!x.points.every(p=>finite(p,2))||!Number.isFinite(x.width)||x.width<=0||!/^#[0-9a-f]{6}$/i.test(x.color))throw Error('Traç no vàlid');
    if(!s.planes.some(p=>p.id===s.activePlane))s.activePlane=s.planes[0].id;
    if(!s.layers.some(l=>l.id===s.activeLayer))s.activeLayer=s.layers[0].id;
    return s;
  }
  function migrate(old){
    const l=layer('Dibuix anterior'),p=plane();
    const next={version:2,layers:[l],planes:[p],strokes:[],activeLayer:l.id,activePlane:p.id,legacySource:clone(old)};
    function add(points){
      if(points.length<2)return;
      const a=V(points[0]);let u=V(points.at(-1)).sub(a);if(u.length()<1e-8)u=V(points[1]).sub(a);if(u.length()<1e-8)return;u.normalize();
      let n=new THREE.Vector3();for(const pt of points)n.add(u.clone().cross(V(pt).sub(a)));
      if(n.length()<1e-8)n=u.clone().cross(Math.abs(u.y)<0.9?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0));
      const v=n.normalize().cross(u).normalize(),p=plane('Pla importat',a.toArray(),u.toArray(),v.toArray());next.planes.push(p);
      next.strokes.push({id:uid(),layerId:l.id,planeId:p.id,color:'#ffb84d',width:0.01,points:points.map(x=>local(p,V(x)))});
    }
    const nodes=new Map((old.nodes||[]).map(n=>[n.id,n]));
    for(const w of old.walls||[]){const a=nodes.get(w.a),b=nodes.get(w.b);if(a&&b)add([[a.x,a.y,a.z],[b.x,b.y,b.z]]);}
    for(const s of old.shapes||[]){const a=s.a,b=s.b;if(!a||!b)continue;
      if(s.type==='circle'){const r=Math.hypot(b.x-a.x,b.z-a.z);add(Array.from({length:65},(_,i)=>[a.x+r*Math.cos(i*Math.PI/32),a.y,a.z+r*Math.sin(i*Math.PI/32)]));}
      else if(s.type==='rect')add([[a.x,a.y,a.z],[b.x,a.y,a.z],[b.x,b.y,b.z],[a.x,b.y,b.z],[a.x,a.y,a.z]]);
      else add([[a.x,a.y,a.z],[b.x,b.y,b.z]]);
    }return next;
  }
  const api={
    floating:true,onChange:null,
    getState:()=>clone(state),
    setState(s){cancel();const next=s.version===2?validated(s):migrate(s);state=next;undoStack=[];redoStack=[];selected=null;render();refresh();},
    setActive(value){
      cancel();
      const sidebar=document.getElementById('sidebox'), reopen=document.getElementById('sideReopen');
      if(value&&!active)sideWasCollapsed=sidebar?.classList.contains('collapsed')||false;
      sidebar?.classList.toggle('collapsed',value||sideWasCollapsed);reopen?.classList.toggle('show',value||sideWasCollapsed);
      active=value;touches.clear();panel.hidden=!value;ctx.setDrawingNavigation(value,mode==='navigate');updateGrid();
      if(value){const welcome=document.getElementById('welcomeScreen');if(welcome)welcome.style.display='none';const r=canvas.getBoundingClientRect();if(!onPlane({clientX:r.left+r.width/2,clientY:r.top+r.height/2}))ctx.alignToPlane(getPlane(state.activePlane));clampPanel();status('');}
      else{canvas.style.cursor='default';selected=null;render();}
    },
    setMode(value){cancel();mode=value;picking=[];render();ctx.setDrawingNavigation(active,value==='navigate');canvas.style.cursor=value==='navigate'?'grab':'crosshair';refresh();status(value==='trim'?'Arrossega un rectangle: retalla els fragments interiors de la capa i el pla actius.':value==='erase'?'Goma: elimina fragments de la capa i el pla actius.':value==='plane-pick'?'Tria tres punts no alineats del model.':value==='edit'?'Selecciona un traç i arrossega un dels seus quadrats.':'');},
    undo:()=>history(undoStack,redoStack),redo:()=>history(redoStack,undoStack),
    clear(){change(()=>{state.strokes=[];selected=null;});},
    count:()=>({walls:state.strokes.length,nodes:state.strokes.reduce((n,s)=>n+s.points.length,0),openings:0}),
    addShape(sh){change(()=>{const old=migrate({shapes:[sh]});for(const p of old.planes)state.planes.push(p);for(const s of old.strokes)state.strokes.push({...s,layerId:state.activeLayer});});},
    dispose(){cancel();canvas.removeEventListener('pointerdown',down,true);canvas.removeEventListener('pointermove',move,true);canvas.removeEventListener('pointerup',up,true);canvas.removeEventListener('pointercancel',pointerCancel,true);canvas.removeEventListener('lostpointercapture',pointerCancel,true);window.removeEventListener('pointerup',releaseTouch,true);window.removeEventListener('pointercancel',releaseTouch,true);window.removeEventListener('blur',blur);window.removeEventListener('resize',clampPanel);document.removeEventListener('keydown',key,true);disposeChildren();scene.remove(group);scene.remove(workGrid);workGrid.geometry.dispose();workGrid.material.dispose();panel.remove();style.remove();intro.remove();},
  };
  refresh();return api;
}
