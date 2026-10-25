const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {initializeApp}=require('firebase-admin/app');
const {getFirestore,Timestamp,FieldValue}=require('firebase-admin/firestore');
const {getStorage}=require('firebase-admin/storage');
const {randomBytes,scryptSync,timingSafeEqual,createHash}=require('node:crypto');
initializeApp();const db=getFirestore();
const options={region:'europe-west1',enforceAppCheck:true,maxInstances:10};
const text=(v,max)=>typeof v==='string'&&v.length<=max?v:'';
function id(v){if(!/^[a-zA-Z0-9_-]{1,100}$/.test(v||''))throw new HttpsError('invalid-argument','Identificador incorrecte.');return v;}
async function owner(r){if(!r.auth||!(await db.doc('owners/'+r.auth.uid).get()).exists)throw new HttpsError('permission-denied','Compte no autoritzat com a propietari.');return r.auth.uid;}
function check(password,secret){if(!secret||!text(password,200))return false;return timingSafeEqual(scryptSync(password,secret.salt,64),Buffer.from(secret.hash,'hex'));}
async function ownProject(r){const uid=await owner(r),ref=db.doc('projects/'+id(r.data.id)),p=await ref.get();if(!p.exists||p.data().ownerUid!==uid)throw new HttpsError('permission-denied','Projecte no disponible.');return {ref,p:p.data()};}
exports.createProject=onCall(options,async r=>{
  const uid=await owner(r),name=text(r.data.name,120).trim(),slug=text(r.data.slug,80),password=text(r.data.clientPassword,200);
  if(!name||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||password.length<12)throw new HttpsError('invalid-argument','Nom, slug vàlid i contrasenya de 12 caràcters com a mínim.');
  const ref=db.collection('projects').doc(),salt=randomBytes(16).toString('hex'),hash=scryptSync(password,salt,64).toString('hex');
  await db.runTransaction(async t=>{const s=db.doc('projectSlugs/'+slug);if((await t.get(s)).exists)throw new HttpsError('already-exists','Aquest slug ja existeix.');
    t.create(s,{projectId:ref.id});t.create(ref,{name,slug,ownerUid:uid,ownerEmail:r.auth.token.email||'',createdAt:FieldValue.serverTimestamp(),deleting:false});t.create(db.doc('projectSecrets/'+ref.id),{salt,hash});});
  return {id:ref.id,name,slug};
});
exports.verifySharePassword=onCall(options,async r=>{const {ref,p}=await ownProject(r);if(!check(r.data.password,(await db.doc('projectSecrets/'+ref.id).get()).data()))throw new HttpsError('permission-denied','Contrasenya incorrecta.');return {slug:p.slug};});
exports.openProject=onCall(options,async r=>{
  if(!r.auth)throw new HttpsError('unauthenticated','Cal una sessió anònima.');
  const slug=text(r.data.slug,80);if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))throw new HttpsError('permission-denied','Enllaç o contrasenya incorrectes.');
  const window=Math.floor(Date.now()/900000),ip=r.rawRequest.ip||r.auth.uid;
  const key=createHash('sha256').update(ip+':'+slug+':'+window).digest('hex'),rate=db.doc('accessAttempts/'+key);
  await db.runTransaction(async t=>{const d=await t.get(rate),count=d.data()?.count||0;if(count>=20)throw new HttpsError('resource-exhausted','Massa intents. Torna-ho a provar en 15 minuts.');t.set(rate,{count:count+1,expiresAt:Timestamp.fromMillis(Date.now()+3600000)});});
  const s=await db.doc('projectSlugs/'+slug).get(),pid=s.data()?.projectId;
  if(!pid)throw new HttpsError('permission-denied','Enllaç o contrasenya incorrectes.');
  const [p,secret]=await Promise.all([db.doc('projects/'+pid).get(),db.doc('projectSecrets/'+pid).get()]);
  if(!p.exists||p.data().deleting||!check(r.data.password,secret.data()))throw new HttpsError('permission-denied','Enllaç o contrasenya incorrectes.');
  await db.doc(`projects/${pid}/members/${r.auth.uid}`).set({expiresAt:Timestamp.fromMillis(Date.now()+8*3600000)});
  const data=p.data();return {id:pid,name:data.name,slug:data.slug,ownerEmail:data.ownerEmail};
});
exports.deleteProject=onCall({...options,timeoutSeconds:540},async r=>{
  const {ref,p}=await ownProject(r);await ref.update({deleting:true});
  // Keep the tombstone on failure: access is denied and the owner can retry.
  await getStorage().bucket().deleteFiles({prefix:`projects/${ref.id}/`});
  await db.recursiveDelete(ref.collection('captures'));await db.recursiveDelete(ref.collection('members'));
  const b=db.batch();b.delete(db.doc('projectSlugs/'+p.slug));b.delete(db.doc('projectSecrets/'+ref.id));b.delete(ref);await b.commit();return {deleted:true};
});
