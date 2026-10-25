# Informe complet per a Claude — 4 Merge Cloud V3

Data: 25 d’octubre de 2026. Repositori: `gabinet-tecnic/4MergeCloud-V3`.
Aquest informe és una guia de revisió, no una afirmació que Firebase estigui
configurat ni que els canvis nous s'hagin publicat.

## Estat i bases de comparació

- Base anterior al nou dibuix: `edd569179cc9708c619ec1fc3978b85ed132aa99`.
- Dibuix publicat a `main`: `6341462bf6625c85358cb7caf789d6dc89640e0c`.
- Proves publicades: `8372587fc45f45cfb197944c7ca7bbbd66e17d2a` i
  `925396a8b4417773348bbf227a2605f62734fd07`.
- GitHub Pages va completar correctament el desplegament de `925396a`:
  https://github.com/gabinet-tecnic/4MergeCloud-V3/actions/runs/40172781101
- Versió pública verificada: `3.1.1-drawing` a
  https://gabinet-tecnic.github.io/4MergeCloud-V3/ .
- Base exacta de Projectes: `925396a8b4417773348bbf227a2605f62734fd07`.
  Abans de publicar la branca s'ha actualitzat sobre
  `a648ea1f01224219fc201b1ad9c56664400eff30`, incorporant els quatre canvis
  posteriors de menú i vista Interior. L'únic conflicte era el versionat del script;
  s'ha conservat el menú nou i les correccions de Polycam.
- Canvis nous a la branca de revisió `codex/projectes-firebase`, versió
  `3.2.0-projectes-preview`. **No fusionats ni desplegats.**
- S'han separat sis commits locals per àmbit. Els noms inclouen PR1–PR6 per
  correspondència amb l'encàrrec; **això no significa que existeixin sis PR remotes**.
  El paquet conté sis patches seqüencials amb els commits i les signatures.
  Són dependents: aplicar en ordre. Per petició de l'usuari de fer visible tot el
  paquet a Claude, es publica una PR conjunta de revisió amb el resultat complet.
  La càrrega web de GitHub agrupa els fitxers en commits diferents dels sis locals.
  Cal revisar la PR abans de fusionar; no s'ha desplegat Firebase.

## 1. Canvis del dibuix 3D ja publicats

`drawing3d.js` substitueix l'ús actiu de `editor2d.js` mitjançant una API compatible.
`editor2d.js` es conserva al repositori. `drawing-geometry.js` conté la geometria
de selecció i tall independent de Three.js.

Funcionalitats introduïdes:

- Traços en coordenades locals d'un pla: origen i bases ortonormals u/v.
  No depenen de la perspectiva de la càmera.
- Plans horitzontals/verticals i selecció de tres punts sobre el model/núvol.
- Capes independents: nom, visibilitat, bloqueig, capa activa i trasllat de traços.
- Mà alçada, línia, rectangle, moure, ajustar vèrtexs, duplicar, canviar color/gruix,
  esborrar traços, goma parcial i retall rectangular. Els contorns tancats mantenen
  l'extrem coincident quan es mou el primer o últim vèrtex.
- Desfer/refer fins a 50 estats; fitxer editable `.4draw`; persistència `.4mc` i local.
- Migració del dibuix anterior amb còpia `legacySource`, sense eliminar-ne les dades.
- Ratolí/llapis dibuixen. Dits naveguen; un toc cancel·la el traç en curs.
- Exportació PNG de la vista, amb transparència o només la capa activa.
- Caixa flotant de 252 px, quatre eines principals i apartats avançats plegats.
- Quadrícula gris clar fina sobre el pla actiu, sense punts decoratius; no surt al PNG.
- Integració a `main.js`: selecció de punts, canvi de vista, exclusivitat d'eines,
  sincronització de persistència per timestamp i obertura de la caixa flotant.
- Service worker `mergecloud-v77-drawing`; guia `DIBUIX.md` i proves de geometria,
  navegador i integració amb núvol inclinat.

No s'han implementat extrusió, booleans ni exportació IFC. Les parets/portes
semàntiques de l'editor antic no tenen controls equivalents al nou menú.

## 2. Encàrrec Projectes i decisions

L'usuari ha demanat aplicar `codex-v3-projectes-firebase_2.md` i generar aquest
informe complet. Ha confirmat explícitament que **a la galeria sí es dibuixa
amb els dits**. Això no altera el comportament tàctil del dibuix 3D.

Desviacions intencionades respecte del document:

- No s'han acceptat regles de lectura pública amb contrasenya validada només
  al navegador. Això hauria exposat les captures i la contrasenya.
- Es lliuren quatre Cloud Functions gestionades per comprovar permisos i hashes.
  Requereixen desplegament, App Check i pla Blaze. No s'ha activat facturació.
- La contrasenya es desa amb scrypt i salt en una col·lecció només del servidor;
  no es desa en clar al document públic del projecte.
- Els enllaços nous són `?project=slug#pwd=...`. Es manté compatibilitat amb
  `?project=slug&pwd=...`, però aquest format antic sí transmet el secret al hosting
  en la petició inicial. Es retira el secret de l'adreça després de llegir-lo.
- Compartir demana de nou la contrasenya, perquè el hash no permet recuperar-la.
- Les anotacions es desen amb control de revisió transaccional. Un desat concurrent
  no sobreescriu silenciosament les modificacions d'una altra persona.
- Els mòduls nous s'han separat de `main.js` per evitar afegir-hi tota la UI.
  `app-entry.js` decideix si arrencar galeria o visor; només el visor carrega Drive.

## 3. Fitxers i responsabilitats

| Fitxer | Canvi |
| --- | --- |
| `firebase-config.js` | Config pública buida; regió i clau pública App Check. |
| `projectes.js` | SDK modular 10.12.0 sota demanda; Auth separat propietari/client; llistat, pujada, miniatures, blobs autenticats i anotacions. |
| `functions/index.cjs` | createProject, openProject, verifySharePassword, deleteProject; owners allowlist, slug únic, hash, permisos de 8 hores, límit d'intents i esborrat reintentable. |
| `firestore.rules` | Accés pel propietari autoritzat o membre vigent; captures amb camps i paths restringits; actualització d'anotacions amb revisió. |
| `storage.rules` | Lectura autenticada segons projecte; escriptura només propietari, PNG/JPEG i mida limitada; originals immutables. |
| `firebase.json`, `storage-cors.json` | Desplegament/emuladors i origen CORS explícit. |
| `projectes-ui.js` | Modal d'accés, llista, crear, compartir, esborrar i coordinació amb ortoimatges. |
| `projectes-gallery.js` | Galeria, estats buit/error/carregant, quatre descàrregues simultànies, entrada de client. |
| `projectes-annotations.js` | Editor d'imatges amb ratolí/llapis/un dit; pinça de dos dits, desat, mailto i PNG. |
| `annotation-model.js` | Validació del JSON, coordenades normalitzades, render de figures i historial. |
| `projectes.css` | Modals, galeria responsive i eines de dibuix; barra superior amb desplaçament horitzontal. |
| `app-entry.js` | Arrencada diferenciada galeria/visor, Google Drive només al visor. |
| `index.html` | Botó Projectes, controls de destinació de captures, CSS, política no-referrer i entrada versionada. |
| `main.js` | Versió preview; `_orthoCapture({upload:true})` retorna blob+metadades; muntatge del mòdul. |
| `sw.js` | Cache v78; recursos nous; no cacheja Firebase ni URLs de galeria/amb contrasenya. |
| `README.md` | Configuració, regles, App Check, quota, ús, limitacions i validació pendent. |
| `tests/projectes*` | Proves del model, backend simulat i fluxos de navegador. |
| `tests/drawing.integration.cjs` | Espera explícita que el visor estigui inicialitzat abans de carregar el núvol amb la nova entrada dinàmica. |

No s'ha modificat `drawing3d.js`, `drawing-geometry.js` ni `editor2d.js` durant
l'encàrrec Projectes. Tampoc no s'ha tocat `4MergeCloud-v2`.

## 4. Seguretat i configuració que falta

El propietari s'autentica amb Email/Password i necessita un document `owners/{uid}`
creat manualment. El client té una Auth anònima en una app Firebase separada,
amb persistència només en memòria. `openProject` comprova la contrasenya al servidor
i concedeix un permís de 8 hores. Les regles el comproven en cada lectura.

Les captures s'obtenen amb `getBlob()` autenticat, no amb links públics permanents.
Els camps rebuts d'usuaris es mostren amb `textContent`; les anotacions carregades
es validen abans de dibuixar. L'original no s'alterarà en desar les anotacions.
Els correus només es preparen amb `mailto:`; no s'ha enviat cap correu.

Falta rebre/emplenar la configuració real, activar Auth/Firestore/Storage,
configurar owners, App Check i CORS, desplegar les funcions/regles i provar amb
dos comptes i sessions client reals. El README descriu el procediment.
No s'han creat comptes, permisos al núvol ni recursos amb cost.

## 5. Proves i límits de l'evidència

Han passat en aquesta sessió:

- `projectes.test.mjs`: init sense config, validació de JSON, coordenades,
  desfer/refer i branques de l'historial.
- `projectes-functions.cjs`: permisos del propietari, unicitat de slug,
  secrets amb salt, contrasenya incorrecta/correcta, concessió amb caducitat,
  esborrat denegat a convidat, tombstone després de fallada i reintent.
- `projectes.browser.cjs`: visor sense Firebase, avís de configuració, entrada
  de client sense carregar main/WebGL/Drive, neteja de URL, creació de projecte,
  captura ortogonal real amb retorn de blob/metadades, dibuix amb ratolí i toc,
  cancel·lació del traç en iniciar pinça, desat/reobertura, PNG i mida mòbil.
- `drawing.test.mjs`: talls geomètrics exactes i selecció.
- `drawing.integration.cjs`: núvol inclinat real, pla per tres punts, dibuix,
  vèrtexs, duplicació, importació/rollback, paleta mòbil i preservació legacy.

Les proves de Firebase usen dobles en memòria: **no proven les Security Rules,
IAM, SDK contra serveis reals, desplegament, App Check ni CORS del bucket real**.
No s'han executat emuladors Firebase ni proves en un iPad físic. La captura
`projectes-anotacions-prova.png` mostra la UI real amb una imatge sintètica i backend
de prova; no és cap projecte real ni evidència d'una publicació Firebase.

**Fallada antiga reproduïda:** `tests/drawing.browser.cjs` falla al tall amb goma
(espera dos fragments, en troba un). S'ha executat també contra una còpia neta
de `origin/main` / `925396a` i hi falla al mateix punt. Uns intents diagnòstics
amb coordenades de clic alternatives van arribar fins a una altra comprovació
de moviment que també fallava. Aquests canvis diagnòstics s'han retirat; el test
original es conserva. Cal investigar-ho com a incidència pendent del dibuix,
sense atribuir-ho automàticament a Projectes ni afirmar que totes les proves passen.

## 6. Revisió demanada a Claude

Compara el paquet amb `925396a` per Projectes i amb `edd5691` per tota la història
del dibuix. Revisa el codi independentment d'aquest informe. Dona prioritat a:

1. Regles Firestore/Storage: cap lectura sense permís, cap canvi de paths/ownerUid
   per client, expiració, revocació, projectes d'un altre propietari.
2. Funcions: App Check, allowlist, limitació d'intents, secrets, unicitat de slug,
   esborrat interromput i pujades simultànies. Vigilar possibles objectes orfes.
3. Persistència: conflictes de revisió, errors/offline, captures eliminades mentre
   s'anoten, desar/obrir a la galeria, URLs de blobs i recursos alliberats.
4. Gestos: un dit dibuixa només a la galeria; dos dits cancel·len el traç i naveguen;
   llapis, pointercancel, captura del punter i canvi de mida en mòbil.
5. Entrada client: absència de Drive/WebGL, tractament del secret de l'enllaç,
   service worker, recàrrega i accés després de caducar.
6. No regressió de Drive, captura PNG/PGW/WLD/TXT local i dibuix 3D.
7. Investigar la fallada de la prova antiga de goma sense amagar-la ni relaxar-ne
   les assercions per fer-la passar.

No hi ha rotació de contrasenyes, revocació individual a UI, col·laboració en viu,
adjunts de correu, extrusions, booleans ni IFC. Les annotations es poden redibuixar
i ampliar, netejar, desfer/refer; no hi ha un editor individual de figures persistides.

Revisar la PR remota i fer la revisió humana abans de qualsevol fusió. La versió
pública anterior continua disponible fins que l'usuari i Claude validin aquest paquet.
