# 4 Merge Cloud V3

Visor estàtic Three.js de núvols de punts, dibuix sobre plans i ortoimatges.
El mòdul **Projectes** afegeix galeries privades i anotacions sobre captures.
Sense configuració Firebase, el visor i el dibuix 3D continuen funcionant.

## Configurar Firebase

1. Crea un projecte Firebase i registra una app web. Tria la regió de Firestore
   i Storage conscientment; les funcions d'aquest codi utilitzen `europe-west1`.
2. Activa Authentication amb **Email/Password** i **Anonymous**. Crea manualment
   el compte del propietari. Afegeix `gabinet-tecnic.github.io` als dominis autoritzats.
3. Crea Firestore i Storage. A Firestore crea `owners/UID_DEL_PROPIETARI`
   amb un camp `enabled: true`. L'existència d'aquest document autoritza el compte;
   per revocar-lo, elimina el document. Cap client pot llegir ni escriure `owners`.
4. Copia la configuració **pública de l'app web** a `firebase-config.js`. Conserva
   el `storageBucket` exacte que mostri la consola: no pressuposis el sufix.
   No afegeixis comptes de servei, claus privades ni contrasenyes a GitHub.
5. Registra l'app web a **App Check / reCAPTCHA v3** per al domini del web.
   Copia la clau pública a `projectSettings.appCheckSiteKey`. Les funcions rebutgen
   peticions sense App Check. Per a desenvolupament, utilitza el proveïdor de
   depuració de Firebase i registra el token només al teu entorn local.
6. Amb Node 22 o compatible i Firebase CLI instal·lats, inicia sessió a Firebase,
   selecciona explícitament el projecte correcte, instal·la les dependències de
   `functions` i desplega:

   ```sh
   cd functions
   npm install
   cd ..
   firebase use --add
   firebase deploy --only firestore:rules,storage,functions
   ```

   Cal el pla **Blaze** per desplegar Cloud Functions. No s'ha activat cap pla,
   creat cap projecte ni desplegat res a Firebase com a part d'aquests canvis.
   Configura avisos de pressupost abans del desplegament; no són un límit de despesa.
7. A la primera publicació de regles Storage, accepta la integració amb Firestore
   perquè les regles puguin consultar els permisos del projecte.
8. Aplica CORS al bucket per a les descàrregues autenticades `getBlob()`:

   ```sh
   gsutil cors set storage-cors.json gs://EL_BUCKET_REAL
   ```

   Per provar en localhost afegeix-ne l'origen exacte al fitxer CORS; no deixis `*`
   en producció. Activa una política TTL per al camp `expiresAt` de la col·lecció
   `accessAttempts` per netejar els comptadors caducats.
9. Verifica les regles amb emuladors i un Firebase de proves abans de fusionar
   els canvis. Finalment publica el frontend amb el procés GitHub Pages existent.

Documentació oficial: [App Check per a funcions](https://firebase.google.com/docs/app-check/cloud-functions),
[descàrrega autenticada i CORS](https://firebase.google.com/docs/storage/web/download-files),
[desplegament de funcions](https://firebase.google.com/docs/functions/get-started).

## Ús

- **Projectes**: entrar, crear un projecte (nom, slug únic i contrasenya de 12
  caràcters com a mínim), veure captures, compartir i esborrar.
- **Ortoimatge → Pujar a projecte**: tria una vista ortogonal, enquadra, selecciona
  el projecte i puja. Conserva resolució, dimensions, vista, world file i sidecar
  com a metadades. El botó de captura local conserva PNG + PGW + WLD + TXT.
- **Compartir** demana de nou la contrasenya. El servidor només desa un hash
  scrypt amb salt; no és possible recuperar-la de la base de dades.
- L'enllaç nou usa `?project=slug#pwd=contrasenya`: el fragment evita enviar la
  contrasenya al servidor estàtic. També s'accepten els enllaços antics amb `&pwd=`;
  aquests ja hauran enviat la contrasenya al servidor en la petició inicial.
  L'app elimina tots dos formats de la barra d'adreces després de llegir-los.
  Qualsevol persona que rebi l'enllaç complet pot accedir-hi; comparteix-lo amb cura.
- El client veu directament la galeria, sense carregar WebGL ni Google Drive.
- A les anotacions: ratolí, llapis o **un dit** dibuixen; **dos dits** mouen/amplien.
  També hi ha «Moure vista», roda del ratolí i «Enquadrar».
- Llapis, línia, fletxa, rectangle i text; color, gruix, desfer/refer, netejar.
  Les coordenades normalitzades són independents del zoom i de la mida de pantalla.
- «Desar» conserva JSON separat del PNG original. «Enviar per correu» desa i mostra
  un enllaç `mailto:` perquè l'usuari obri el seu correu. **No envia correus ni adjunts
  automàticament.** «Descarregar PNG» combina la captura i les anotacions.
- Si algú desa alhora, la revisió transaccional rebutja la sobreescriptura. Cal
  descarregar el PNG propi abans de reobrir la versió remota. No hi ha fusió en viu.

## Accés i dades

La proposta inicial de lectura pública amb contrasenya comprovada al navegador
**no s'ha implementat**. Quatre funcions gestionades (`createProject`, `openProject`,
`verifySharePassword`, `deleteProject`) verifiquen les operacions privilegiades.
No cal mantenir un servidor propi, però sí desplegar aquestes funcions a Firebase.

`openProject` comprova el hash i crea un permís de 8 hores per a la sessió anònima
del client. Les regles Firestore i Storage comproven aquest permís en cada lectura.
La sessió del client és en memòria i separada de la del propietari. No es publiquen
URLs permanents de descàrrega; les imatges s'obtenen amb el SDK autenticat.
Hi ha App Check i un límit de 20 intents per IP/projecte cada 15 minuts; no és una
garantia contra atacants distribuïts. Utilitza contrasenyes llargues i úniques.

Esquema:

- `owners/{uid}`: llista de propietaris configurada manualment.
- `projects/{id}`: nom, slug, ownerUid, ownerEmail, createdAt, deleting.
- `projectSlugs/{slug}` i `projectSecrets/{id}`: índex únic i hash/salt;
  accessibles exclusivament des de les funcions administradores.
- `projects/{id}/members/{uid}`: permís amb caducitat, creat només pel servidor.
- `projects/{id}/captures/{captureId}`: paths, nom, metadades, annotations,
  authorName, revision i timestamps.
- Storage: `projects/{id}/{captureId}.png` i `{captureId}_thumb.jpg` (400×400,
  proporcions conservades amb marges). Límit de pujada: menys de 20 MB.

L'esborrat marca primer el projecte com a inaccessible. Si falla Storage, el
propietari veu «Reintentar esborrat». L'últim pas elimina captures, permisos,
secret i reserva del slug. Cal verificar els casos de pujada/esborrat simultanis
contra el backend real i vigilar objectes orfes després d'interrupcions de xarxa.
No s'inclou rotació de contrasenyes ni revocació individual a la interfície.

## Quota orientativa

Una captura típica ocupa aproximadament 1–5 MB més la miniatura; cent captures
suposen aproximadament 100–500 MB més miniatures. Cada pujada fa dues escriptures
Storage i una de metadades Firestore; cada visita llegeix metadades i descarrega
miniatures, i obrir una imatge descarrega l'original. El recompte de captures fa
una consulta agregada per projecte. Obrir el projecte també escriu el comptador
d'intents i el permís temporal. Desar anotacions fa una transacció Firestore.
Les descàrregues repetides, Auth, App Check i funcions tenen quotes pròpies.
Aquestes xifres són volum orientatiu, no una estimació monetària.

## Validació

```sh
node tests/projectes.test.mjs
node tests/projectes-functions.cjs
node tests/projectes.browser.cjs
node tests/drawing.test.mjs
node tests/drawing.browser.cjs
node tests/drawing.integration.cjs
```

Les proves de navegador necessiten Playwright i Chromium. Es poden indicar
`PLAYWRIGHT_MODULE` i `CHROME_PATH`. La prova de Projectes substitueix **només dins
la prova** el servei Firebase per un doble en memòria. La prova de funcions usa
Firestore/Storage simulats. Això verifica fluxos locals, no desplegament, IAM,
regles, App Check ni connexió real. No hi ha cap Firebase real configurat.

Revisió necessària al backend de proves: propietari A contra B, convidat sense
permís, contrasenya incorrecta, permís caducat, pujada no autoritzada, canvis de
paths/ownerUid, intents repetits, col·lisions de slug, desat concurrent, esborrat
fallit i reintentat, CORS i lectura de blobs amb sessió caducada.

El mòdul DIBUIX 3D existent no forma part d'aquest nou editor d'imatges. Les
extrusions, operacions booleanes i exportació IFC continuen fora d'àmbit.
