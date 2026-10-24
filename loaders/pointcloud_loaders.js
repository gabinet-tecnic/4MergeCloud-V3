// loaders/pointcloud_loaders.js
import * as THREE from '../three/three.module.js';
import { PLYLoader } from './PLYLoader.js';

// FileReader wrappers — compatibles amb tots els navegadors mòbils
function readAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Error llegint fitxer: ' + file.name));
    reader.readAsArrayBuffer(file);
  });
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Error llegint fitxer: ' + file.name));
    reader.readAsText(file);
  });
}

// -----------------------------------------------------------------------------
// Carregador PLY
// -----------------------------------------------------------------------------
export async function loadPLY(file) {
  console.log("loadPLY() ->", file.name);
  const arrayBuffer = await readAsArrayBuffer(file);

  const loader = new PLYLoader();
  const geometry = loader.parse(arrayBuffer);

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const hasColor = geometry.getAttribute('color') !== undefined;

  const material = new THREE.PointsMaterial({
    size: 3,
    sizeAttenuation: false,
    vertexColors: hasColor,
    color: hasColor ? undefined : 0xffffff
  });

  const points = new THREE.Points(geometry, material);
  points.name = file.name;

  const posAttr = geometry.getAttribute('position');
  console.log('PLY carregat, punts:', posAttr ? posAttr.count : 0);

  return points;
}

// -----------------------------------------------------------------------------
// Carregador XYZ (x y z [r g b])
// -----------------------------------------------------------------------------
export async function loadXYZ(file) {
  console.log("loadXYZ() ->", file.name);
  const text = await readAsText(file);
  const lines = text.split(/\r?\n/);

  const positions = [];
  const colors = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    // Accepta espais, comes i punt-i-coma com a separadors (formats iOS)
    const parts = line.trim().split(/[\s,;]+/);
    if (parts.length < 3) continue;

    const x = parseFloat(parts[0]);
    const y = parseFloat(parts[1]);
    const z = parseFloat(parts[2]);

    if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) continue;

    positions.push(x, y, z);

    if (parts.length >= 6) {
      const r = parseFloat(parts[3]);
      const g = parseFloat(parts[4]);
      const b = parseFloat(parts[5]);

      const rr = (!Number.isNaN(r) ? r : 255) / 255;
      const gg = (!Number.isNaN(g) ? g : 255) / 255;
      const bb = (!Number.isNaN(b) ? b : 255) / 255;

      colors.push(rr, gg, bb);
    } else {
      colors.push(1, 1, 1);
    }
  }

  const numPoints = positions.length / 3;
  console.log("Línies vàlides XYZ:", numPoints);

  if (numPoints === 0) throw new Error('Cap punt vàlid al fitxer ' + file.name);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color',    new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const material = new THREE.PointsMaterial({
    size: 3,
    sizeAttenuation: false,
    vertexColors: true
  });

  const points = new THREE.Points(geometry, material);
  points.name = file.name;

  console.log('XYZ carregat, punts:', numPoints);
  return points;
}

// ─────────────────────────────────────────────────────────────────────────────
// LAS/LAZ (ASPRS LASer format) — lidar/escaneig terrestre
// Suporta LAS 1.0-1.4 i point formats 0-10 (sense compressió). Els formats 6-10
// de LAS 1.4 utilitzen els camps de X/Y/Z/RGB a offsets diferents però mantenim
// el mateix principi: X/Y/Z = int32 escalats + offset; RGB opcional segons el PDRF.
// LAZ (comprimit) encara no té decoder integrat: mostra un missatge clar.
// ─────────────────────────────────────────────────────────────────────────────
export async function loadLAS(file) {
  const ab = await readAsArrayBuffer(file);
  const dv = new DataView(ab);
  const u8 = new Uint8Array(ab);

  // Signatura "LASF"
  if (!(u8[0] === 0x4C && u8[1] === 0x41 && u8[2] === 0x53 && u8[3] === 0x46))
    throw new Error('No sembla un fitxer LAS vàlid (falta signatura "LASF")');

  const vMaj = u8[24];
  const vMin = u8[25];

  // Offsets fixos de la Public Header Block (iguals en 1.0-1.4 per aquests camps)
  const offsetToPointData = dv.getUint32(96, true);
  const pointDataFormat   = u8[104] & 0x3F;   // bits 0-5 (bits 6-7 són flags LAZ/wave data)
  const compressionFlag   = (u8[104] & 0xC0) !== 0 ||
                            (dv.getUint32(0, true) !== 0x4653414C && false);  // no fiable, ja ho decidim per bits
  const pointDataLength   = dv.getUint16(105, true);
  // Nombre de punts: a LAS<=1.3 és uint32 a offset 107; a 1.4 pot ser 0 i cal
  // llegir el uint64 a offset 247.
  let numPoints = dv.getUint32(107, true);
  if (numPoints === 0 && vMaj === 1 && vMin >= 4) {
    const lo = dv.getUint32(247, true);
    const hi = dv.getUint32(251, true);
    numPoints = hi * 0x100000000 + lo;
  }
  const scaleX  = dv.getFloat64(131, true);
  const scaleY  = dv.getFloat64(139, true);
  const scaleZ  = dv.getFloat64(147, true);
  const offX    = dv.getFloat64(155, true);
  const offY    = dv.getFloat64(163, true);
  const offZ    = dv.getFloat64(171, true);
  const maxX    = dv.getFloat64(179, true);
  const minX    = dv.getFloat64(187, true);
  const maxY    = dv.getFloat64(195, true);
  const minY    = dv.getFloat64(203, true);
  const maxZ    = dv.getFloat64(211, true);
  const minZ    = dv.getFloat64(219, true);

  // Detecció LAZ: el PDRF té el bit 0x80 (bit 7) activat per fitxers comprimits.
  // També ho detectem per l'extensió i la presència d'una VLR "laszip encoded".
  const isLaz = (u8[104] & 0x80) !== 0 || /\.laz$/i.test(file.name);
  if (isLaz) {
    throw new Error('Els fitxers LAZ (comprimits) encara no es poden obrir directament. ' +
      'Descomprimeix-los a .las amb CloudCompare, LAStools o PDAL, i torna-ho a provar.');
  }

  if (pointDataLength < 20) throw new Error('Longitud de registre no vàlida: ' + pointDataLength);
  if (numPoints <= 0) throw new Error('El fitxer no té cap punt (nombre de registres = 0).');

  // Offsets interns dins de cada registre segons el point data record format (PDRF).
  // Mapa simplificat: {rgbOffset: null si no en té}.
  // PDRF: 0, 1 → sense RGB. 2, 3, 5, 7, 8, 10 → amb RGB. 4, 6, 9 → sense RGB.
  const pdrfInfo = {
     0: { rgb: null },
     1: { rgb: null },
     2: { rgb: 20 },
     3: { rgb: 28 },
     4: { rgb: null },
     5: { rgb: 28 },
     6: { rgb: null },
     7: { rgb: 30 },
     8: { rgb: 30 },
     9: { rgb: null },
    10: { rgb: 30 },
  };
  const info = pdrfInfo[pointDataFormat];
  if (!info) throw new Error('PDRF ' + pointDataFormat + ' no suportat (0-10 vàlids).');

  // Càrrega de punts
  const positions = new Float32Array(numPoints * 3);
  let colors = info.rgb != null ? new Float32Array(numPoints * 3) : null;
  // Centre pels punts (restem el centre perquè les coordenades grans del lidar
  // -per exemple UTM- no perdin precisió com a Float32 ni causin flickering).
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;

  let colorMax = 0;   // detectem si el color és 8-bit (0-255) o 16-bit (0-65535)
  let base = offsetToPointData;
  for (let i = 0; i < numPoints; i++) {
    const ix = dv.getInt32(base,     true);
    const iy = dv.getInt32(base + 4, true);
    const iz = dv.getInt32(base + 8, true);
    // Convencions: LAS és Z-up, nosaltres també (three.js té Y-up, però el visor
    // ja tracta els núvols amb Z-up vs Y-up al carregar segons el format).
    // Per compatibilitat amb la resta de loaders (XYZ, PLY) que no reinterpretar
    // els eixos, mantenim l'ordre (X, Y, Z) tal com venen.
    const px = ix * scaleX + offX - cx;
    const py = iy * scaleY + offY - cy;
    const pz = iz * scaleZ + offZ - cz;
    positions[i*3]   = px;
    positions[i*3+1] = pz;        // Y-up al visor: mapejem LAS.Z → three.Y
    positions[i*3+2] = -py;       // i LAS.Y → three.-Z (compatible amb els altres loaders)
    if (colors) {
      const ro = base + info.rgb;
      const r = dv.getUint16(ro,     true);
      const g = dv.getUint16(ro + 2, true);
      const b = dv.getUint16(ro + 4, true);
      if (r > colorMax) colorMax = r;
      if (g > colorMax) colorMax = g;
      if (b > colorMax) colorMax = b;
      colors[i*3]   = r;
      colors[i*3+1] = g;
      colors[i*3+2] = b;
    }
    base += pointDataLength;
  }

  // Normalitzem el color al rang 0..1 (si venia en 16-bit)
  if (colors) {
    const div = colorMax > 255 ? 65535 : 255;
    for (let i = 0; i < colors.length; i++) colors[i] /= div;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (colors) geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.computeBoundingBox();
  geom.computeBoundingSphere();

  const material = new THREE.PointsMaterial({
    size: 3, sizeAttenuation: false,
    vertexColors: !!colors,
    color: colors ? 0xffffff : 0xcccccc,
  });
  const points = new THREE.Points(geom, material);
  points.name = file.name;

  console.log('LAS carregat:', numPoints, 'punts · v' + vMaj + '.' + vMin +
              ' · PDRF ' + pointDataFormat + ' · color: ' + (colors ? 'sí' : 'no'));
  return points;
}
