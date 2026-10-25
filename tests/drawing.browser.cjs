const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
const browser=await chromium.launch({headless:true,downloadsPath:path.resolve(__dirname,'../../browser-downloads'),...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),args:['--enable-webgl','--ignore-gpu-blocklist']});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const root=path.resolve(__dirname,'..');
 await page.route('https://drawing.test/**',async route=>{const u=new URL(route.request().url()),p=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));try{await route.fulfill({body:fs.readFileSync(p),contentType:p.endsWith('.js')?'text/javascript':p.endsWith('.html')?'text/html':'application/octet-stream'});}catch{await route.fulfill({status:404,body:''});}});
 await page.goto('https://drawing.test/');
 await page.evaluate(()=>{const original=URL.createObjectURL;URL.createObjectURL=function(blob){window.testExportBlob=blob;return original.call(this,blob);};});
 await page.locator('#welcomeCard .popup-close').click();
 await page.locator('#tabDraw').click();await page.locator('#drawingPalette').waitFor();
assert.ok((await page.locator('#drawingPalette').boundingBox()).height<580);
assert.equal(await page.locator('#drawingPalette details[open]').count(),0);
assert.equal(await page.evaluate(()=>__mc.scene.getObjectByName('Quadrícula de dibuix').type),'GridHelper');
await page.locator('#drawingPalette details').evaluateAll(items=>items.forEach(d=>d.open=true));
 const action=a=>page.locator(`#drawingPalette [data-action="${a}"]`).click().then(()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
 const mode=m=>page.locator(`#drawingPalette [data-mode="${m}"]`).click();
 const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('mc_editor_state')));
 const drag=async(a,b)=>{await page.mouse.move(...a);await page.mouse.down();await page.mouse.move(...b,{steps:12});await page.mouse.up();};
 await action('face');await page.locator('[data-width]').fill('100');await page.locator('[data-width]').dispatchEvent('change');
 await drag([500,400],[850,500]);let s=await saved();assert.equal(s.strokes.length,1);assert.ok(s.strokes[0].points.length>3);const first=JSON.stringify(s.strokes[0]);
 await action('undo');assert.equal((await saved()).strokes.length,0);await action('redo');assert.equal(JSON.stringify((await saved()).strokes[0]),first);
 // A locked layer must reject drawing and destructive tools.
 await page.getByRole('button',{name:'Bloquejar capa',exact:true}).click();await drag([500,600],[850,600]);assert.equal((await saved()).strokes.length,1);
 await page.getByRole('button',{name:'Desbloquejar capa',exact:true}).click();
 await mode('trim');await drag([650,350],[700,550]);assert.equal((await saved()).strokes.length,2);
 await action('undo');assert.equal((await saved()).strokes.length,1);
 await mode('erase');await drag([650,420],[650,480]);assert.equal((await saved()).strokes.length,2);
 await action('undo');await mode('select');await drag([670,449],[690,479]);assert.notEqual(JSON.stringify((await saved()).strokes[0]),first);await action('undo');
 await action('layer');assert.equal((await saved()).layers.length,2);await mode('line');await drag([500,650],[850,650]);assert.equal((await saved()).strokes.length,2);
 const second=(await saved()).strokes[1];assert.notEqual(second.layerId,(await saved()).strokes[0].layerId);
 await page.getByRole('button',{name:'Ocultar capa',exact:true}).last().click();await mode('delete');await page.mouse.click(670,650);assert.equal((await saved()).strokes.length,2);await page.getByRole('button',{name:'Mostrar capa',exact:true}).click();
 // Real touchscreen gestures must navigate without writing, and cancel an active stroke.
 await mode('draw');const beforeTouch=JSON.stringify(await saved());const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:600,y:600,id:1},{x:750,y:600,id:2}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:570,y:580,id:1},{x:790,y:620,id:2}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.equal(JSON.stringify(await saved()),beforeTouch);
 await action('face');await page.mouse.move(500,700);await page.mouse.down();await page.mouse.move(700,710,{steps:5});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:800,y:700,id:3}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.mouse.up();assert.equal((await saved()).strokes.length,2);
 // Pen pointer input uses the same planar path.
 await action('face');await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:500,y:720,button:'left',buttons:1,clickCount:1,pointerType:'pen'});
 await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:850,y:720,button:'left',buttons:1,pointerType:'pen'});
 await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:850,y:720,button:'left',buttons:0,clickCount:1,pointerType:'pen'});assert.equal((await saved()).strokes.length,3);
 // Changing camera must preserve all plane-local coordinates.
 const beforeView=JSON.stringify(await saved());await action('perspective');assert.equal(JSON.stringify(await saved()),beforeView);await action('face');
 await page.locator('[data-export]').selectOption('drawing');const pngPromise=page.waitForEvent('download');await action('png');const png=await pngPromise;assert.equal(png.suggestedFilename(),'dibuix-drawing.png');
 // Validate a transparent background, not a flattened dark screenshot.
 console.log('PNG download initiated');const pngBytes=await page.evaluate(()=>new Promise((resolve,reject)=>{setTimeout(()=>reject(Error('Blob read timeout')),5000);const reader=new FileReader();reader.onerror=()=>reject(Error('Blob read: '+reader.error));reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(window.testExportBlob);}));const pixels=await page.evaluate(async b64=>{const img=new Image();img.src='data:image/png;base64,'+b64;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d');x.drawImage(img,0,0);const d=x.getImageData(0,0,c.width,c.height).data;let zero=0,ink=0;for(let i=3;i<d.length;i+=4){if(d[i]===0)zero++;else ink++;}return {zero,ink};},pngBytes);assert.ok(pixels.zero>1000&&pixels.ink>10,JSON.stringify(pixels));
 // Save/reload round-trip, including startup restoration while the editor is inactive.
 console.log('PNG pixels validated');const beforeReload=JSON.stringify(await saved());await page.reload();await page.waitForFunction(()=>document.getElementById('drawingPalette'));assert.equal(JSON.stringify(await saved()),beforeReload);await page.locator('#tabDraw').click();await page.locator('#drawingPalette details').evaluateAll(items=>items.forEach(d=>d.open=true));await action('face');
 assert.equal(await page.evaluate(()=>window.__mc.scene.getObjectByName('Dibuix 3D').children.length),3);
 console.log('render state',await page.evaluate(()=>{const g=window.__mc.scene.getObjectByName('Dibuix 3D');return {visible:g?.visible,children:g?.children.length,positions:g?.children.map(o=>o.geometry.attributes.position.count),stored:JSON.parse(localStorage.getItem('mc_editor_state')).strokes.length};}));
 await page.locator('#drawingPalette details').evaluateAll(items=>items.forEach(d=>d.open=false));
 await page.screenshot({path:path.resolve(root,'../drawing-preview.png')});
 assert.deepEqual(errors,[]);console.log('PASS: freehand, pen, layer isolation/locks, trim, eraser, move, undo/redo, touch cancellation, perspective, transparent PNG and reload');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
