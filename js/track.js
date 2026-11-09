import * as THREE from 'three';
import { scene, renderer } from './scene.js';
import { clamp, lerp } from './utils.js';
import { WIND } from './atmosphere.js';

const CIRCUIT_POINTS = [
  [130, 15], [240, 50], [290, 140], [250, 240], [140, 290], [30, 260], [-50, 295], [-170, 260],
  [-250, 150], [-280, 0], [-250, -140], [-140, -220], [-20, -190], [65, -130], [35, -40], [0, 0]
];

const LINEAR_POINTS = [
  [0, 0], [10, -115], [70, -225], [-35, -350], [55, -485], [-20, -625], [45, -800]
];

const DASH_CONTINUATION_POINTS = [
  [0, 0], [10, -115], [70, -225], [-35, -350], [55, -485], [20, -625], [75, -740], [85, -800]
];

const DASH_SECTIONS = [
  { label: 'Desert Dash', type: 'classic' },
  { label: 'Sandy Incline', type: 'incline' },
  { label: 'Rocky Descent', type: 'rocky' },
  { label: 'Sandstorm', type: 'storm' },
  { label: 'Cactus Run', type: 'cactus' },
  { label: 'Open Desert', type: 'classic' }
];

class SectionedCoursePath {
  constructor(curves, sectionLength) {
    this.curves = curves;
    this.sectionLength = sectionLength;
  }

  getLength() {
    return this.sectionLength * this.curves.length;
  }

  getSectionAt(t) {
    const scaled = clamp(t, 0, 1) * this.curves.length;
    const index = Math.min(Math.floor(scaled), this.curves.length - 1);
    return { index, localT: index === this.curves.length - 1 && t >= 1 ? 1 : scaled - index };
  }

  getPointAt(t) {
    const { index, localT } = this.getSectionAt(t);
    return this.curves[index].getPointAt(localT);
  }

  getTangentAt(t) {
    const { index, localT } = this.getSectionAt(t);
    return this.curves[index].getTangentAt(localT);
  }

  getSpacedPoints(divisions = 5) {
    return Array.from({ length: divisions + 1 }, (_, index) => this.getPointAt(index / divisions));
  }
}

const maskCache = new Map();

function flagMaterial(color) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.65, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = WIND.time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindTime;')
      .replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        float wv = position.x * 3.2 - uWindTime * 7.0;
        transformed.z += sin( wv ) * 0.16 * position.x;
        transformed.y += sin( wv * 0.7 + 1.3 ) * 0.05 * position.x;
      `);
  };
  return mat;
}

function makeSignTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#7A1F14');
  grad.addColorStop(1, '#4E1009');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 256);
  g.strokeStyle = '#E6B450';
  g.lineWidth = 10;
  g.strokeRect(14, 14, 996, 228);
  g.lineWidth = 3;
  g.strokeRect(30, 30, 964, 196);
  g.fillStyle = '#F4DDA8';
  g.font = 'bold 112px Georgia, "Palatino Linotype", serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.55)';
  g.shadowBlur = 8;
  g.fillText('START  \u2022  FINISH', 512, 136);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeCheckerTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 32;
  const g = c.getContext('2d');
  for (let x = 0; x < 32; x++) {
    for (let y = 0; y < 4; y++) {
      g.fillStyle = (x + y) % 2 === 0 ? '#F4EFE4' : '#1B1410';
      g.fillRect(x * 8, y * 8, 8, 8);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Track - race circuit defined by a Catmull-Rom spline.
 * The road is painted into the terrain shader through a mask texture; this class owns the
 * fence line, start gate, checkpoints and the spline queries used by horses and the HUD.
 */
export class Track {
  constructor(terrain, mode = 'circuit') {
    this.terrain = terrain;
    this.mode = mode;
    this.isClosed = mode !== 'linear';
    this.totalLaps = this.isClosed ? 3 : 1;
    this.group = new THREE.Group();
    this.path = null;
    this.trackWidth = 20;
    this.totalLength = 0;
    this.checkpoints = [];
    this.samplePoints = [];
    this.roadMask = null;
    this.sections = [];
    this.isSectioned = mode === 'linear';
    this.init();
  }

  init() {
    if (scene) scene.add(this.group);

    const rawPoints = this.isClosed ? CIRCUIT_POINTS : LINEAR_POINTS;
    const controlPoints = rawPoints.map(([x, z]) => {
      const y = this.terrain ? this.terrain.getHeightAt(x, z) + 0.5 : 0.5;
      return new THREE.Vector3(x, y, z);
    });

    this.path = new THREE.CatmullRomCurve3(controlPoints, this.isClosed, 'centripetal');
    if (this.isSectioned) this.createDashSections();
    this.totalLength = this.path.getLength();

    const sampleCount = 360;
    this.samplePoints = [];
    const cachedPointCount = this.isClosed ? sampleCount : sampleCount + 1;
    for (let i = 0; i < cachedPointCount; i++) {
      const t = i / sampleCount;
      this.samplePoints.push({
        t,
        point: this.path.getPointAt(t),
        tangent: this.path.getTangentAt(t).normalize()
      });
    }

    this.createRoadMask();
    this.createFence();
    this.createStartFinishArch();
    this.createCheckpoints();
  }

  createDashSections() {
    const first = this.path;
    const sectionLength = first.getLength();
    const templatePoints = DASH_CONTINUATION_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z));
    const template = new THREE.CatmullRomCurve3(templatePoints, false, 'centripetal');
    const scale = sectionLength / template.getLength();
    const templateStart = template.getTangentAt(0).setY(0).normalize();
    const curves = [first];

    this.sections = [{
      ...DASH_SECTIONS[0], index: 0, path: first, length: sectionLength
    }];

    for (let index = 1; index < DASH_SECTIONS.length; index++) {
      const previous = curves[curves.length - 1];
      const start = previous.getPointAt(1);
      const previousTangent = previous.getTangentAt(1).setY(0).normalize();
      const yaw = Math.atan2(previousTangent.x, previousTangent.z) - Math.atan2(templateStart.x, templateStart.z);
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const points = templatePoints.map((point) => {
        const x = point.x * scale;
        const z = point.z * scale;
        const worldX = start.x + x * cos + z * sin;
        const worldZ = start.z - x * sin + z * cos;
        return new THREE.Vector3(worldX, this.terrain ? this.terrain.getHeightAt(worldX, worldZ) + 0.5 : 0.5, worldZ);
      });
      const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
      curves.push(curve);
      this.sections.push({ ...DASH_SECTIONS[index], index, path: curve, length: sectionLength });
    }

    this.path = new SectionedCoursePath(curves, sectionLength);
    this.totalLength = this.path.getLength();

    if (this.terrain) {
      this.terrain.setCourseSections(this.sections);
      curves.forEach((curve) => {
        curve.points.forEach((point) => { point.y = this.terrain.getHeightAt(point.x, point.z) + 0.5; });
        curve.updateArcLengths();
      });
    }

    this.path = new SectionedCoursePath(curves, sectionLength);
    this.totalLength = this.path.getLength();
    this.sections.forEach((section) => {
      section.start = section.path.getPointAt(0);
      section.end = section.path.getPointAt(1);
      section.direction = section.path.getTangentAt(0).setY(0).normalize();
    });
  }

  getSectionAtProgress(progress) {
    if (!this.isSectioned) return null;
    const index = Math.min(Math.floor(clamp(progress, 0, 0.999999) * this.sections.length), this.sections.length - 1);
    return this.sections[index];
  }

  /**
   * Paints the road into a 3-channel texture sampled by the terrain shader.
   * R = road surface, G = worn lanes and the sun-bleached racing line, B = pebbly shoulder.
   */
  createRoadMask() {
    const key = this.isClosed ? 'closed' : 'open';
    if (maskCache.has(key)) {
      this.roadMask = maskCache.get(key);
      return;
    }

    const pad = 40;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    this.samplePoints.forEach(({ point }) => {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minZ = Math.min(minZ, point.z);
      maxZ = Math.max(maxZ, point.z);
    });
    minX -= pad;
    minZ -= pad;
    maxX += pad;
    maxZ += pad;

    const sizeX = maxX - minX;
    const sizeZ = maxZ - minZ;
    const scale = 2048 / Math.max(sizeX, sizeZ);
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(sizeX * scale);
    canvas.height = Math.ceil(sizeZ * scale);
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const centre = this.path.getSpacedPoints(Math.ceil(this.totalLength / 2));
    const lanePoints = (offset) => centre.map((p, i) => {
      const a = centre[Math.max(i - 1, 0)];
      const b = centre[Math.min(i + 1, centre.length - 1)];
      const tx = b.x - a.x;
      const tz = b.z - a.z;
      const len = Math.hypot(tx, tz) || 1;
      return { x: p.x - (tz / len) * offset, z: p.z + (tx / len) * offset };
    });

    const stroke = (points, widthUnits) => {
      ctx.beginPath();
      points.forEach((p, i) => {
        const x = (p.x - minX) * scale;
        const y = (p.z - minZ) * scale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (this.isClosed) ctx.closePath();
      ctx.lineWidth = widthUnits * scale;
      ctx.stroke();
    };

    const w = this.trackWidth;

    // Shoulder band (B), cleared again under the road core.
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgb(0,0,128)';
    stroke(centre, w + 16);
    ctx.strokeStyle = 'rgb(0,0,127)';
    stroke(centre, w + 5);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = '#000';
    stroke(centre, w - 5);

    // Road surface (R) with a soft edge.
    ctx.globalCompositeOperation = 'lighter';
    const passes = 10;
    const soft = 1.8;
    ctx.strokeStyle = `rgb(${Math.floor(255 / passes)},0,0)`;
    for (let k = 0; k < passes; k++) {
      stroke(centre, w - 2 * soft + (4 * soft * (passes - 1 - k)) / (passes - 1));
    }

    // Worn hoof lanes (G) and the dashed racing line.
    ctx.strokeStyle = 'rgb(0,34,0)';
    [-4.4, 4.4].forEach((offset) => {
      const lane = lanePoints(offset);
      for (let k = 0; k < 4; k++) stroke(lane, 3.6 - k * 0.7);
    });
    ctx.strokeStyle = 'rgb(0,235,0)';
    ctx.setLineDash([5 * scale, 9 * scale]);
    stroke(centre, 0.95);
    ctx.setLineDash([]);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
    texture.flipY = false;
    texture.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
    texture.needsUpdate = true;

    this.roadMask = {
      texture,
      origin: new THREE.Vector2(minX, minZ),
      size: new THREE.Vector2(sizeX, sizeZ)
    };
    maskCache.set(key, this.roadMask);
  }

  /** Weathered ranch fence: posts every 14 units with two rails, hugging the road edge. */
  createFence() {
    const spacing = 14;
    const count = Math.max(2, Math.floor(this.totalLength / spacing));
    const postCount = this.isClosed ? count : count + 1;
    const segmentCount = count;
    const offset = this.trackWidth / 2 + 1.8;
    const up = new THREE.Vector3(0, 1, 0);

    const postGeo = new THREE.CylinderGeometry(0.11, 0.15, 2.3, 7);
    postGeo.translate(0, 1.15, 0);
    const wood = new THREE.MeshStandardMaterial({ color: 0x70513A, roughness: 0.92 });
    const posts = new THREE.InstancedMesh(postGeo, wood, postCount * 2);
    posts.castShadow = true;
    posts.receiveShadow = true;
    const railGeo = new THREE.BoxGeometry(0.07, 0.11, 1);
    const rails = new THREE.InstancedMesh(railGeo, wood, segmentCount * 2 * 2);
    rails.castShadow = true;
    rails.receiveShadow = true;

    const dummy = new THREE.Object3D();
    const anchors = { left: [], right: [] };
    for (let i = 0; i < postCount; i++) {
      const t = i / count;
      const centre = this.path.getPointAt(t);
      const tangent = this.path.getTangentAt(t).normalize();
      const side = new THREE.Vector3().crossVectors(tangent, up).normalize();
      [['left', -offset], ['right', offset]].forEach(([name, o], s) => {
        const p = centre.clone().addScaledVector(side, o);
        p.y = this.terrain ? this.terrain.getHeightAt(p.x, p.z) : p.y;
        anchors[name].push(p);
        dummy.position.set(p.x, p.y - 0.05, p.z);
        dummy.rotation.set(Math.sin(i * 12.3 + s) * 0.05, Math.sin(i * 1.7 + s) * 3.14, Math.cos(i * 9.7 + s) * 0.05);
        dummy.scale.set(1, 0.92 + Math.abs(Math.sin(i * 3.7 + s)) * 0.2, 1);
        dummy.updateMatrix();
        posts.setMatrixAt(i * 2 + s, dummy.matrix);
      });
    }

    let r = 0;
    const from = new THREE.Vector3();
    const to = new THREE.Vector3();
    ['left', 'right'].forEach((name) => {
      const list = anchors[name];
      for (let i = 0; i < segmentCount; i++) {
        const a = list[i];
        const b = list[(i + 1) % list.length];
        [1.0, 1.78].forEach((height) => {
          from.set(a.x, a.y + height, a.z);
          to.set(b.x, b.y + height, b.z);
          dummy.position.copy(from).lerp(to, 0.5);
          dummy.scale.set(1, 1, from.distanceTo(to));
          dummy.lookAt(to);
          dummy.updateMatrix();
          rails.setMatrixAt(r++, dummy.matrix);
        });
      }
    });

    posts.instanceMatrix.needsUpdate = true;
    rails.instanceMatrix.needsUpdate = true;
    rails.count = r;
    this.group.add(posts, rails);
  }

  /** Conforms a flat strip to the terrain for painted lines. */
  createGroundStrip(center, tangent, side, width, depth, material) {
    const across = 28;
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i <= across; i++) {
      const u = i / across;
      [-depth / 2, depth / 2].forEach((along, row) => {
        const p = center.clone()
          .addScaledVector(side, (u - 0.5) * width)
          .addScaledVector(tangent, along);
        const y = this.terrain ? this.terrain.getHeightAt(p.x, p.z) + 0.07 : p.y;
        positions.push(p.x, y, p.z);
        uvs.push(u, row);
      });
      if (i < across) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    return mesh;
  }

  /** Timber start/finish gate with a painted sign, hanging lanterns and a checkered line. */
  createStartFinishArch() {
    const center = this.path.getPointAt(0);
    const tangent = this.path.getTangentAt(0).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(tangent, up).normalize();

    const gate = new THREE.Group();
    const half = this.trackWidth / 2 + 1.8;
    const timber = new THREE.MeshStandardMaterial({ color: 0x5A3A22, roughness: 0.88 });
    const stone = new THREE.MeshStandardMaterial({ color: 0xB07A52, roughness: 0.95 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xE0B14C, roughness: 0.35, metalness: 0.9 });

    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.castShadow = true;
      m.receiveShadow = true;
      gate.add(m);
      return m;
    };

    const colGeo = new THREE.BoxGeometry(0.95, 7.4, 0.95);
    const baseGeo = new THREE.BoxGeometry(1.8, 1.3, 1.8);
    [-half, half].forEach((x) => {
      add(baseGeo, stone, x, 0.55, 0);
      add(colGeo, timber, x, 4.2, 0);
      add(new THREE.SphereGeometry(0.5, 12, 10), gold, x, 8.15, 0);
    });
    add(new THREE.BoxGeometry(this.trackWidth + 5.2, 1.1, 1.1), timber, 0, 7.4, 0);

    // Corner braces.
    const braceGeo = new THREE.BoxGeometry(0.35, 3.0, 0.35);
    [-1, 1].forEach((s) => {
      add(braceGeo, timber, s * (half - 1.45), 5.9, 0, 0, 0, s * 0.75);
    });

    const signW = 11;
    const signH = signW * 0.25;
    const signY = 6.85 - signH / 2 - 0.2;
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(signW, signH),
      new THREE.MeshStandardMaterial({ map: makeSignTexture(), roughness: 0.7 })
    );
    sign.position.set(0, signY, -0.62);
    sign.rotation.y = Math.PI;
    gate.add(sign);
    add(new THREE.BoxGeometry(signW + 0.5, signH + 0.4, 0.2), timber, 0, signY, -0.45);

    // Lanterns with an emissive glow that blooms at golden hour.
    const lanternMat = new THREE.MeshStandardMaterial({
      color: 0xFFD28A, emissive: 0xFFA640, emissiveIntensity: 3.2, roughness: 0.4
    });
    [-half + 1.1, half - 1.1].forEach((x) => {
      add(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 5), gold, x, 6.35, -0.55);
      add(new THREE.BoxGeometry(0.42, 0.62, 0.42), lanternMat, x, 5.6, -0.55);
      add(new THREE.ConeGeometry(0.34, 0.28, 4), gold, x, 6.05, -0.55, 0, Math.PI / 4, 0);
    });

    // Bunting strung under the beam.
    const flagColors = [0xC0392B, 0xE0B14C, 0x2E8B7A, 0xF4EFE4, 0xC0392B, 0xE0B14C, 0x2E8B7A];
    const buntingGeo = new THREE.ConeGeometry(0.38, 0.8, 3);
    const count = 15;
    for (let i = 0; i < count; i++) {
      const u = (i + 0.5) / count;
      const x = (u - 0.5) * (this.trackWidth + 2);
      if (Math.abs(x) < signW / 2 + 0.5) continue;
      const sag = Math.sin(u * Math.PI) * 0.5;
      const m = add(buntingGeo, flagMaterial(flagColors[i % flagColors.length]), x, 6.5 - sag, -0.6, Math.PI, 0.3, 0);
      m.castShadow = false;
    }

    gate.setRotationFromMatrix(new THREE.Matrix4().makeBasis(side, up, tangent));
    const groundY = this.terrain ? this.terrain.getHeightAt(center.x, center.z) : 0;
    gate.position.set(center.x, groundY - 0.05, center.z);
    this.group.add(gate);

    const line = this.createGroundStrip(
      center, tangent, side, this.trackWidth - 1.2, 1.8,
      new THREE.MeshStandardMaterial({
        map: makeCheckerTexture(),
        roughness: 0.9,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2
      })
    );
    this.group.add(line);
  }

  /** Checkpoint pennants flutter in the wind; the start/finish gate covers checkpoint zero. */
  createCheckpoints() {
    const cpFractions = [0.0, 0.22, 0.48, 0.72, 0.88];
    const up = new THREE.Vector3(0, 1, 0);

    const poleGeo = new THREE.CylinderGeometry(0.07, 0.11, 5.4, 8);
    poleGeo.translate(0, 2.7, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x5A4332, roughness: 0.8 });
    const pennantGeo = new THREE.PlaneGeometry(2.2, 1.1, 16, 1);
    pennantGeo.translate(1.1, 0, 0);
    const pa = pennantGeo.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const along = pa.getX(i) / 2.2;
      pa.setY(i, pa.getY(i) * (1 - along * 0.9));
    }
    pennantGeo.computeVertexNormals();
    const finialGeo = new THREE.SphereGeometry(0.16, 10, 8);
    const gold = new THREE.MeshStandardMaterial({ color: 0xE0B14C, roughness: 0.3, metalness: 0.9 });
    const pennantMat = flagMaterial(0xD1362B);

    this.checkpoints = [];
    cpFractions.forEach((tVal, idx) => {
      const pos = this.path.getPointAt(tVal);
      const tangent = this.path.getTangentAt(tVal).normalize();
      const side = new THREE.Vector3().crossVectors(tangent, up).normalize();
      const halfWidth = this.trackWidth / 2 + 1.8;

      this.checkpoints.push({
        id: idx,
        name: idx === 0 ? 'Start/Finish' : `Checkpoint ${idx}`,
        t: tVal,
        position: pos.clone(),
        tangent: tangent.clone(),
        side: side.clone(),
        radius: 18.0
      });

      if (idx === 0) return;
      [-halfWidth, halfWidth].forEach((sideOffset) => {
        const poleGroup = new THREE.Group();
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.castShadow = true;
        poleGroup.add(pole);
        const finial = new THREE.Mesh(finialGeo, gold);
        finial.position.y = 5.5;
        poleGroup.add(finial);
        const flag = new THREE.Mesh(pennantGeo, pennantMat);
        flag.position.set(0.05, 4.7, 0);
        flag.castShadow = true;
        poleGroup.add(flag);

        const flagPos = pos.clone().addScaledVector(side, sideOffset);
        const flagY = this.terrain ? this.terrain.getHeightAt(flagPos.x, flagPos.z) : 0;
        poleGroup.position.set(flagPos.x, flagY, flagPos.z);
        // Pennants stream along the track direction.
        poleGroup.quaternion.setFromUnitVectors(
          new THREE.Vector3(1, 0, 0),
          new THREE.Vector3(tangent.x, 0, tangent.z).normalize()
        );
        this.group.add(poleGroup);
      });
    });
  }

  /**
   * Starting grid just past the start/finish gate: slot 0 is pole position (player), then two abreast.
   * Racers begin ahead of the line so lap progress never wraps at the start.
   * @param {number} index
   * @returns {{ position: THREE.Vector3, direction: THREE.Vector3 }}
   */
  getStartSlot(index) {
    const base = this.getPointAt(0).clone();
    const direction = this.getTangentAt(0).clone().setY(0).normalize();
    const side = new THREE.Vector3(-direction.z, 0, direction.x);
    const row = Math.floor(index / 2);
    const lane = index % 2 === 0 ? 3.4 : -3.4;
    const position = base.clone()
      .addScaledVector(direction, 26.0 + row * 5.6)
      .addScaledVector(side, lane);
    position.y = this.terrain ? this.terrain.getHeightAt(position.x, position.z) : position.y;
    return { position, direction };
  }

  getPointAt(t) {
    const safeT = this.isClosed ? ((t % 1) + 1) % 1 : clamp(t, 0, 1);
    return this.path.getPointAt(safeT);
  }

  getTangentAt(t) {
    const safeT = this.isClosed ? ((t % 1) + 1) % 1 : clamp(t, 0, 1);
    return this.path.getTangentAt(safeT);
  }

  /**
   * Closest point on the track centerline using cached samples and segment refinement.
   */
  getClosestPoint(position) {
    const samples = this.samplePoints;
    let minSqDist = Infinity;
    let bestIdx = 0;

    for (let i = 0; i < samples.length; i++) {
      const p = samples[i].point;
      const dx = position.x - p.x;
      const dz = position.z - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < minSqDist) {
        minSqDist = d2;
        bestIdx = i;
      }
    }

    const prevIdx = this.isClosed
      ? (bestIdx - 1 + samples.length) % samples.length
      : Math.max(bestIdx - 1, 0);
    const nextIdx = this.isClosed
      ? (bestIdx + 1) % samples.length
      : Math.min(bestIdx + 1, samples.length - 1);

    const sA = samples[prevIdx];
    const sB = samples[bestIdx];
    const sC = samples[nextIdx];

    const vAB = sB.point.clone().sub(sA.point);
    const vPosA = position.clone().sub(sA.point);
    const uAB = clamp(vPosA.dot(vAB) / (vAB.lengthSq() || 1), 0, 1);
    const pAB = sA.point.clone().lerp(sB.point, uAB);
    const distAB = position.distanceTo(pAB);

    const vBC = sC.point.clone().sub(sB.point);
    const vPosB = position.clone().sub(sB.point);
    const uBC = clamp(vPosB.dot(vBC) / (vBC.lengthSq() || 1), 0, 1);
    const pBC = sB.point.clone().lerp(sC.point, uBC);
    const distBC = position.distanceTo(pBC);

    if (distAB <= distBC) {
      return { t: this.interpolateWrappedProgress(sA.t, sB.t, uAB), point: pAB, distance: distAB };
    }
    return { t: this.interpolateWrappedProgress(sB.t, sC.t, uBC), point: pBC, distance: distBC };
  }

  interpolateWrappedProgress(start, end, amount) {
    if (!this.isClosed) return lerp(start, end, amount);

    let wrappedEnd = end;
    if (wrappedEnd - start > 0.5) wrappedEnd -= 1;
    if (start - wrappedEnd > 0.5) wrappedEnd += 1;
    return ((lerp(start, wrappedEnd, amount) % 1) + 1) % 1;
  }

  isOnTrack(position) {
    return this.getClosestPoint(position).distance < (this.trackWidth / 2);
  }

  getProgress(position) {
    return this.getClosestPoint(position).t;
  }
}
