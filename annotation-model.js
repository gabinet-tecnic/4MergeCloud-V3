const types=new Set(['pencil','line','arrow','rect','text']);
export function validateAnnotations(input) {
  if(!Array.isArray(input)||input.length>2000)throw new Error('Format d’anotacions incorrecte.');
  let count=0;
  return input.map(o=>{
    if(!types.has(o.type)||!/^#[0-9a-f]{6}$/i.test(o.color)||!Number.isFinite(o.width)||o.width<1||o.width>100||!Array.isArray(o.points)||o.points.length<1)throw new Error('Anotació no vàlida.');
    count+=o.points.length;if(count>50000)throw new Error('Massa punts a les anotacions.');
    const points=o.points.map(p=>{if(!Array.isArray(p)||p.length!==2||p.some(n=>!Number.isFinite(n)||n<0||n>1))throw new Error('Coordenades no vàlides.');return [...p];});
    if(o.type!=='pencil'&&o.type!=='text'&&points.length!==2)throw new Error('Figura incompleta.');
    return {type:o.type,color:o.color,width:o.width,points,...(o.type==='text'?{text:String(o.text||'').slice(0,500)}:{})};
  });
}
export function drawOperations(ctx,ops,w,h) {
  for(const o of ops){const pts=o.points.map(([x,y])=>[x*w,y*h]);ctx.strokeStyle=ctx.fillStyle=o.color;ctx.lineWidth=o.width;ctx.lineCap=ctx.lineJoin='round';
    const a=pts[0],b=pts.at(-1);ctx.beginPath();
    if(o.type==='text'){ctx.font=`${Math.max(14,o.width*5)}px sans-serif`;ctx.fillText(o.text,a[0],a[1]);continue;}
    if(o.type==='rect'){ctx.strokeRect(a[0],a[1],b[0]-a[0],b[1]-a[1]);continue;}
    ctx.moveTo(...a);for(const p of pts.slice(1))ctx.lineTo(...p);if(pts.length===1)ctx.lineTo(a[0]+.1,a[1]);ctx.stroke();
    if(o.type==='arrow'){const angle=Math.atan2(b[1]-a[1],b[0]-a[0]),size=Math.max(12,o.width*4);ctx.beginPath();ctx.moveTo(...b);ctx.lineTo(b[0]-size*Math.cos(angle-.5),b[1]-size*Math.sin(angle-.5));ctx.moveTo(...b);ctx.lineTo(b[0]-size*Math.cos(angle+.5),b[1]-size*Math.sin(angle+.5));ctx.stroke();}
  }
}
export class AnnotationHistory {
  constructor(ops=[]){this.ops=validateAnnotations(ops);this.past=[];this.future=[];}
  set(ops){const next=validateAnnotations(ops);this.past.push(this.ops);if(this.past.length>50)this.past.shift();this.ops=next;this.future=[];}
  undo(){if(this.past.length){this.future.push(this.ops);this.ops=this.past.pop();}}
  redo(){if(this.future.length){this.past.push(this.ops);this.ops=this.future.pop();}}
}
