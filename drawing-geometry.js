// Plane-local geometry. No camera or DOM dependencies.
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export function distanceToSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy || 1)));
  const q = lerp(a,b,t);
  return { distance: Math.hypot(p[0]-q[0],p[1]-q[1]), t, point:q };
}

// Split exactly at boundary intersections, including segments whose endpoints
// are both outside the eraser. Preserve all remaining fragments in order.
export function cutPath(points, region) {
  const inside = p => region.kind === 'circle'
    ? Math.hypot(p[0]-region.center[0], p[1]-region.center[1]) < region.radius
    : p[0] > region.min[0] && p[0] < region.max[0] && p[1] > region.min[1] && p[1] < region.max[1];
  const result = []; let run = [];
  const flush = () => { if (run.length > 1) result.push(run); run = []; };
  for (let i=1;i<points.length;i++) {
    const a=points[i-1], b=points[i], dx=b[0]-a[0], dy=b[1]-a[1], ts=[0,1];
    if (region.kind === 'circle') {
      const x=a[0]-region.center[0], y=a[1]-region.center[1];
      const A=dx*dx+dy*dy, B=2*(x*dx+y*dy), C=x*x+y*y-region.radius**2, D=B*B-4*A*C;
      if (A>0 && D>0) ts.push((-B-Math.sqrt(D))/(2*A),(-B+Math.sqrt(D))/(2*A));
    } else {
      if (dx) ts.push((region.min[0]-a[0])/dx,(region.max[0]-a[0])/dx);
      if (dy) ts.push((region.min[1]-a[1])/dy,(region.max[1]-a[1])/dy);
    }
    const cuts=[...new Set(ts.filter(t=>t>=0&&t<=1))].sort((x,y)=>x-y);
    for(let j=1;j<cuts.length;j++) {
      const lo=cuts[j-1], hi=cuts[j];
      if(hi-lo<1e-10) continue;
      if(inside(lerp(a,b,(lo+hi)/2))) { flush(); continue; }
      const p=lerp(a,b,lo), q=lerp(a,b,hi);
      if(!run.length) run.push(p);
      run.push(q);
    }
  }
  flush(); return result;
}
