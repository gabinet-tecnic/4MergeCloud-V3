import {firebaseConfig, projectSettings} from './firebase-config.js';

export const isConfigured = () => ['apiKey','authDomain','projectId','storageBucket','appId']
  .every(k => firebaseConfig[k] && !firebaseConfig[k].includes('XXX'));
let ready;
let clientMode = false;
const clientAccess = new Map();
export async function initFirebase() {
  if (!isConfigured()) return null;
  if (!ready) ready = (async () => {
    const base = 'https://www.gstatic.com/firebasejs/10.12.0/';
    const [app,A,D,S,F,C] = await Promise.all(['app','auth','firestore','storage','functions','app-check'].map(n => import(base+'firebase-'+n+'.js')));
    const ownerApp = app.initializeApp(firebaseConfig,'projects-owner');
    const guestApp = app.initializeApp(firebaseConfig,'projects-client');
    if (projectSettings.appCheckSiteKey) for (const a of [ownerApp,guestApp]) C.initializeAppCheck(a,{
      provider:new C.ReCaptchaV3Provider(projectSettings.appCheckSiteKey),isTokenAutoRefreshEnabled:true});
    const ctx = a => ({auth:A.getAuth(a),db:D.getFirestore(a),storage:S.getStorage(a),functions:F.getFunctions(a,projectSettings.region)});
    const owner=ctx(ownerApp),guest=ctx(guestApp);
    await Promise.all([A.setPersistence(owner.auth,A.browserSessionPersistence),A.setPersistence(guest.auth,A.inMemoryPersistence)]);
    await Promise.all([owner.auth.authStateReady(),guest.auth.authStateReady()]);
    return {A,D,S,F,owner,guest};
  })().catch(e => {ready=null;throw e;});
  return ready;
}
async function requireFirebase() {const s=await initFirebase();if(!s)throw new Error('Primer cal configurar Firebase. Consulta README.md.');return s;}
export async function signInOwner(email,password) {const s=await requireFirebase();return s.A.signInWithEmailAndPassword(s.owner.auth,email,password);}
export async function signOutOwner() {const s=await requireFirebase();await s.A.signOut(s.owner.auth);}
export async function onAuthChange(cb) {const s=await initFirebase();if(!s){cb(null);return ()=>{};}return s.A.onAuthStateChanged(s.owner.auth,cb);}
async function call(name,data,guest=false) {const s=await requireFirebase();return (await s.F.httpsCallable((guest?s.guest:s.owner).functions,name)(data)).data;}
export async function getOwnerProjects() {
  const s=await requireFirebase(),uid=s.owner.auth.currentUser?.uid;if(!uid)return [];
  const q=s.D.query(s.D.collection(s.owner.db,'projects'),s.D.where('ownerUid','==',uid));
  const rows=(await s.D.getDocs(q)).docs.map(d=>({id:d.id,...d.data()}));
  await Promise.all(rows.map(async p=>{p.captureCount=(await s.D.getCountFromServer(s.D.collection(s.owner.db,'projects',p.id,'captures'))).data().count;}));
  return rows.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
}
export const createProject = data => call('createProject',data);
export const deleteProject = id => call('deleteProject',{id});
export const verifySharePassword = (id,password) => call('verifySharePassword',{id,password});
export async function getProjectBySlug(slug,pwd) {
  const s=await requireFirebase();clientMode=true;
  if(!s.guest.auth.currentUser)await s.A.signInAnonymously(s.guest.auth);
  const p=await call('openProject',{slug,password:pwd},true);clientAccess.set(p.id,true);return p;
}
function context(s,id) {return clientMode&&clientAccess.has(id)?s.guest:s.owner;}
export async function listCaptures(projectId,authSlug,authPwd) {
  if(authSlug)await getProjectBySlug(authSlug,authPwd);
  const s=await requireFirebase(),c=context(s,projectId);
  return (await s.D.getDocs(s.D.collection(c.db,'projects',projectId,'captures'))).docs
    .map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.uploadedAt?.seconds||0)-(b.uploadedAt?.seconds||0));
}
export async function imageBlob(projectId,path) {
  if(!path.startsWith('projects/'+projectId+'/'))throw new Error('Ruta d’imatge no vàlida.');
  const s=await requireFirebase();return s.S.getBlob(s.S.ref(context(s,projectId).storage,path),20*1024*1024);
}
export async function makeThumbnail(blob) {
  const image=await createImageBitmap(blob);
  try {const c=document.createElement('canvas');c.width=c.height=400;const g=c.getContext('2d');g.fillStyle='#eef0f4';g.fillRect(0,0,400,400);
    const k=Math.min(400/image.width,400/image.height);g.drawImage(image,(400-image.width*k)/2,(400-image.height*k)/2,image.width*k,image.height*k);
    return await new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('No s’ha pogut crear la miniatura.')),'image/jpeg',.82));
  } finally {image.close();}
}
export async function uploadCapture(projectId,blob,name,metadata={}) {
  if(blob.type!=='image/png'||blob.size>20*1024*1024)throw new Error('Cal un PNG de menys de 20 MB.');
  const s=await requireFirebase(),c=s.owner,uid=c.auth.currentUser?.uid;
  if(!uid)throw new Error('Inicia sessió per pujar captures.');
  const project=await s.D.getDoc(s.D.doc(c.db,'projects',projectId));
  if(!project.exists()||project.data().ownerUid!==uid||project.data().deleting)throw new Error('Projecte no disponible.');
  const ref=s.D.doc(s.D.collection(c.db,'projects',projectId,'captures')),id=ref.id;
  const imagePath=`projects/${projectId}/${id}.png`,thumbPath=`projects/${projectId}/${id}_thumb.jpg`;
  const thumb=await makeThumbnail(blob);
  try {
    await s.S.uploadBytes(s.S.ref(c.storage,imagePath),blob,{contentType:'image/png'});
    await s.S.uploadBytes(s.S.ref(c.storage,thumbPath),thumb,{contentType:'image/jpeg'});
    // Recheck the project inside the transaction so deletion cannot leave a new capture.
    await s.D.runTransaction(c.db,async t=>{const p=await t.get(s.D.doc(c.db,'projects',projectId));
      if(!p.exists()||p.data().deleting)throw new Error('El projecte s’està esborrant.');
      t.set(ref,{fileName:String(name).slice(0,180),imagePath,thumbPath,metadata,uploadedAt:s.D.serverTimestamp(),uploaderUid:uid,annotations:[],revision:0});});
    return {id,imagePath,thumbPath};
  } catch(e) {await Promise.allSettled([imagePath,thumbPath].map(p=>s.S.deleteObject(s.S.ref(c.storage,p))));throw e;}
}
export async function saveAnnotations(projectId,captureId,annotationsJSON,authorName,revision=0) {
  const operations=typeof annotationsJSON==='string'?JSON.parse(annotationsJSON):annotationsJSON;
  if(!Array.isArray(operations)||JSON.stringify(operations).length>180000)throw new Error('Massa anotacions; desa-les en un PNG.');
  const s=await requireFirebase(),c=context(s,projectId),ref=s.D.doc(c.db,'projects',projectId,'captures',captureId);
  return s.D.runTransaction(c.db,async t=>{const d=await t.get(ref);if(!d.exists())throw new Error('La captura ja no existeix.');
    if((d.data().revision||0)!==revision)throw new Error('Algú ha modificat les anotacions. Descarrega el teu PNG abans de tornar a obrir la captura.');
    t.update(ref,{annotations:operations,authorName:String(authorName).slice(0,100),updatedAt:s.D.serverTimestamp(),revision:revision+1});return revision+1;});
}
