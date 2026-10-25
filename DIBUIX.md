# Dibuix sobre plans — 3.1.1

El mòdul DIBUIX utilitza ara `drawing3d.js`. La caixa d’eines és flotant,
arrossegable i plegable; en obrir-la es recull el panell lateral. La creu de
la capçalera torna al mòdul de núvols. L’editor anterior es conserva al
repositori, però no és el que s’obre amb la pestanya DIBUIX.

## Interfície simplificada

La caixa principal mostra quatre eines: Dibuixar, Moure, Goma i Retallar.
Capes, pla de dibuix, més eines i opcions de fitxer estan plegats per defecte.
Les vistes plana i 3D, desfer/refer i el desament són accessibles directament.

El pla actiu es mostra amb una quadrícula fina gris clar, sense punts de
referència decoratius. Es pot ocultar dins de les opcions del pla. És una
guia visual de 40 metres amb quadrats de 0,5 metres: no limita el dibuix ni
activa un ajust automàtic. La quadrícula no s'inclou en els PNG exportats.
Els petits quadrats d'edició només apareixen en «Ajustar traç».
Els núvols reals carregats per l'usuari es conserven; la previsualització
lliurada utilitza només quadrícula i dibuix, sense núvol sintètic.

## Ús

1. Obre DIBUIX. Crea un pla de terra, façana o lateral amb la seva posició
   en metres, o marca tres punts no alineats sobre el model/núvol.
2. «Vista plana» orienta la vista perpendicularment al pla. També es pot
   dibuixar en perspectiva: el pla roman fix encara que la càmera giri.
3. Tria la capa activa i dibuixa amb ratolí o llapis. Els dits només naveguen.
   Un gest tàctil durant un traç cancel·la aquell traç sense alterar els anteriors.
4. «Moure» desplaça un traç dins del seu pla. «Ajustar traç» permet moure'n els
   vèrtexs. «Esborrar» elimina un traç; «Goma» n'elimina fragments.
   «Retall» elimina els fragments interiors d'un rectangle del pla actiu.
5. Cada capa es pot anomenar, mostrar, ocultar, bloquejar o eliminar. Les
   eines només editen la capa activa visible i desbloquejada. Goma i retall
   també es restringeixen al pla actiu. Un traç seleccionat es pot duplicar,
   recolorir, canviar de gruix o traslladar a una altra capa desbloquejada.
6. Desfer/refer recupera traços, edicions, retalls i operacions de capa
   (fins a 50 operacions durant la sessió). Ctrl/Cmd+Z desfà; Shift+Z o Ctrl+Y refà.
7. PNG permet capturar la vista amb el model, les capes visibles amb fons
   transparent o només la capa activa. La resolució és la del visor.
8. «Desar» genera un `.4draw` editable. «Obrir dibuix» reemplaça el
   dibuix actual i es pot desfer. «Desar projecte» conserva núvols i dibuix
   en el format `.4mc` existent. També hi ha recuperació automàtica local.

Una capa pot contenir traços de diversos plans. Les coordenades es desen
en la base local de cada pla, independentment de la càmera. Les línies
tenen gruix físic en mil·límetres, sense convertir-les automàticament en
parets ni eliminar els punts del traç original.

## Compatibilitat i límits d'aquesta entrega

- Els dibuixos anteriors es recuperen com a traços. La representació
  original completa es conserva a `legacySource`, inclosos gruixos i
  obertures. Les eines semàntiques de parets, portes i finestres de
  l'editor antic no formen part d'aquesta nova paleta. La conversió de
  cercles antics assumeix el pla de planta, com el format original més habitual.
- No s'hi incorpora encara la generació de sòlids ni l'exportació IFC.
- El retall és per àrea rectangular; no és l'eina CAD de retall entre
  interseccions. La goma sí que divideix un traç en fragments independents.
- Els plans són fixos en coordenades del projecte. Moure posteriorment
  un núvol no arrossega automàticament els dibuixos.
- La navegació tàctil i el llapis s'han comprovat amb esdeveniments reals
  del navegador automatitzat. Cal validar el palmell i Apple Pencil en
  un iPad físic abans de considerar completada la validació de dispositius.
- La versió s'ha preparat localment; no s'ha publicat a GitHub Pages.

## Implementació i proves

- `drawing-geometry.js`: interseccions exactes de segments amb goma circular
  i retall rectangular; conserva tots els fragments exteriors.
- `drawing3d.js`: document versionat, plans, capes, històric, entrada de
  punter, malles de traç, paleta, importació i PNG transparent.
- `main.js`: integra el nou editor, controls de càmera, selecció de punts,
  desament `.4mc`, recuperació i redirecció de l'anotació antiga.
- `sw.js`: inclou els mòduls nous i actualitza la memòria cau.

Proves de geometria: `node tests/drawing.test.mjs`.

Les proves de navegador necessiten Playwright i Chromium. Executa
`node tests/drawing.browser.cjs` i `node tests/drawing.integration.cjs`.
Es pot indicar el navegador instal·lat amb `CHROME_PATH` i la ubicació
del paquet Playwright amb `PLAYWRIGHT_MODULE`. Serveixen els recursos
locals mitjançant interceptació de peticions, sense publicar-los.

Les proves comproven dibuix lliure, llapis, capes, bloqueig, retalls, goma,
edició, desfer/refer, gestos tàctils, PNG amb alfa, recuperació, plans
inclinats sobre un núvol, importació validada i conservació de projectes antics.
La prova PNG inspecciona el contingut generat i el nom de la descàrrega;
el directori de baixades del navegador depèn de l'entorn d'execució.
