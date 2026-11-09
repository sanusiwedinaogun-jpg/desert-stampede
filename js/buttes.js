import * as THREE from 'three';
import { seededRandom, noise3D, smoothstep } from './utils.js';

/**
 * Procedural Monument Valley style rock formations.
 * A butte is a polar grid: a flared talus skirt, banded cliff walls with ledges and a flat cap.
 */
export function createButteGeometry(o = {}) {
  const {
    height = 80, radius = 40, aspect = 1, seed = 1, taper = 0.05,
    talus = 0.34, talusSpread = 1.9, ledges = 5, capOverhang = 0, lobes = 3,
    squareness = 0.0, radial = 72, rings = 44, roughness = 1
  } = o;

  const rand = seededRandom(seed);
  const ph = [rand() * 90, rand() * 90, rand() * 90];
  const lobePh = rand() * Math.PI * 2;
  const ledgeH = [];
  const ledgeA = [];
  for (let k = 0; k < ledges; k++) {
    ledgeH.push(talus + 0.06 + rand() * (0.84 - talus));
    ledgeA.push((rand() - 0.42) * 0.07);
  }
  const sx = Math.sqrt(aspect);
  const sz = 1 / sx;

  const profile = (v) => {
    let s;
    if (v < talus) {
      s = 1 + (talusSpread - 1) * Math.pow(1 - v / talus, 2.1);
    } else {
      s = 1 - (taper * (v - talus)) / (1 - talus);
      for (let k = 0; k < ledges; k++) {
        s += ledgeA[k] * smoothstep(ledgeH[k] - 0.012, ledgeH[k] + 0.012, v);
      }
    }
    if (capOverhang) {
      s += capOverhang * smoothstep(0.82, 0.87, v) * (1 - smoothstep(0.95, 0.975, v));
    }
    if (v > 0.965) {
      const t = (v - 0.965) / 0.035;
      s *= 1 - 0.07 * t * t;
    }
    return s;
  };

  const bottomY = -Math.max(4, height * 0.05);
  const ringV = [-1];
  for (let i = 0; i <= rings; i++) ringV.push(i / rings);
  const R = ringV.length;

  const positions = new Float32Array((R * radial + 1) * 3);
  const info = new Float32Array((R * radial + 1) * 2);

  for (let i = 0; i < R; i++) {
    const below = ringV[i] < 0;
    const v = below ? 0 : ringV[i];
    const y = below ? bottomY : v * height;
    const prof = profile(v);
    const cliff = smoothstep(talus - 0.04, talus + 0.06, v);

    for (let j = 0; j < radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      const cx = Math.cos(th);
      const sn = Math.sin(th);

      const n1 = noise3D(cx * 1.15 + ph[0], sn * 1.15 + ph[1], v * 1.5 + ph[2]);
      const n2 = noise3D(cx * 3.3 + ph[1], sn * 3.3 + ph[2], v * 3.4 + ph[0]);
      const lobe = Math.sin(th * lobes + lobePh) * 0.11 + Math.sin(th * (lobes + 2) + lobePh * 1.7) * 0.05;
      let k = 1 + 0.2 * n1 + 0.07 * n2 + lobe;
      k += cliff * 0.035 * roughness * noise3D(cx * 10 + ph[2], sn * 10 + ph[0], v * 0.8 + ph[1]);
      k += (1 - cliff) * 0.08 * noise3D(cx * 4 + ph[0], sn * 4 + ph[2], v * 5 + ph[1]);

      if (squareness > 0) {
        const sq = 1 / Math.pow(Math.pow(Math.abs(cx), 4) + Math.pow(Math.abs(sn), 4), 0.25);
        k *= 1 + (sq - 1) * squareness;
      }

      const r = radius * prof * k;
      const idx = i * radial + j;
      positions[idx * 3] = cx * r * sx;
      positions[idx * 3 + 1] = y;
      positions[idx * 3 + 2] = sn * r * sz;
      info[idx * 2] = below ? 0 : Math.min(v / talus, 1);
      info[idx * 2 + 1] = v;
    }
  }

  const top = R * radial;
  positions[top * 3 + 1] = height;
  info[top * 2] = 1;
  info[top * 2 + 1] = 1;

  const indices = [];
  for (let i = 0; i < R - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      const c = (i + 1) * radial + j;
      const d = (i + 1) * radial + ((j + 1) % radial);
      indices.push(a, c, b, c, d, b);
    }
  }
  const lastRing = (R - 1) * radial;
  for (let j = 0; j < radial; j++) {
    indices.push(top, lastRing + ((j + 1) % radial), lastRing + j);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aInfo', new THREE.BufferAttribute(info, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Shared sandstone material: world-space strata, desert varnish streaks, sandy talus and dust caps. */
export function createRockMaterial() {
  const palette = ['#8C3A20', '#B2502A', '#C8703B', '#D99A5C', '#E7C597', '#7A2F1A', '#A5603A'].map(c => new THREE.Color(c));
  const sand = new THREE.Color('#E2AA66');

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPal = { value: palette };
    shader.uniforms.uSand = { value: sand };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        attribute vec2 aInfo;
        varying vec2 vInfo;
        varying vec3 vWPos;
        varying vec3 vWNrm;
      `)
      .replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        vInfo = aInfo;
        vec4 rkPos = vec4( transformed, 1.0 );
        vec3 rkNrm = objectNormal;
        #ifdef USE_INSTANCING
          rkPos = instanceMatrix * rkPos;
          mat3 rkIm = mat3( instanceMatrix );
          rkNrm = rkIm * rkNrm / vec3( dot( rkIm[0], rkIm[0] ), dot( rkIm[1], rkIm[1] ), dot( rkIm[2], rkIm[2] ) );
        #endif
        vWPos = ( modelMatrix * rkPos ).xyz;
        vWNrm = normalize( mat3( modelMatrix ) * rkNrm );
      `);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        uniform vec3 uPal[7];
        uniform vec3 uSand;
        varying vec2 vInfo;
        varying vec3 vWPos;
        varying vec3 vWNrm;

        float rk_h( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
        float rk_n( vec2 p ) {
          vec2 i = floor( p ), f = fract( p );
          f = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( rk_h( i ), rk_h( i + vec2( 1.0, 0.0 ) ), f.x ),
                      mix( rk_h( i + vec2( 0.0, 1.0 ) ), rk_h( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
        }
        float rk_h3( vec3 p ) { return fract( sin( dot( p, vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 ); }
        float rk_n3( vec3 p ) {
          vec3 i = floor( p ), f = fract( p );
          f = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( mix( rk_h3( i ), rk_h3( i + vec3( 1.0, 0.0, 0.0 ) ), f.x ),
                           mix( rk_h3( i + vec3( 0.0, 1.0, 0.0 ) ), rk_h3( i + vec3( 1.0, 1.0, 0.0 ) ), f.x ), f.y ),
                      mix( mix( rk_h3( i + vec3( 0.0, 0.0, 1.0 ) ), rk_h3( i + vec3( 1.0, 0.0, 1.0 ) ), f.x ),
                           mix( rk_h3( i + vec3( 0.0, 1.0, 1.0 ) ), rk_h3( i + vec3( 1.0, 1.0, 1.0 ) ), f.x ), f.y ), f.z );
        }
        vec3 rk_pal( float band ) {
          int idx = int( floor( rk_h( vec2( band, 3.7 ) ) * 7.0 ) );
          return uPal[ clamp( idx, 0, 6 ) ];
        }
      `)
      .replace('#include <map_fragment>', /* glsl */`
        #include <map_fragment>
        {
          vec3 wn = normalize( vWNrm );
          float y = vWPos.y;
          float warp = rk_n( vWPos.xz * 0.018 ) * 2.4 + rk_n( vec2( vWPos.x + vWPos.z, y ) * 0.04 ) * 1.3;
          float hh = y * 0.09 + warp;
          float band = floor( hh );
          vec3 rock = mix( rk_pal( band ), rk_pal( band + 1.0 ), smoothstep( 0.78, 1.0, fract( hh ) ) );
          rock *= 0.92 + 0.10 * sin( y * 3.7 + warp * 5.0 );
          float streak = rk_n( vec2( ( vWPos.x + vWPos.z ) * 0.6, y * 0.045 ) );
          rock *= mix( 1.0, 0.7, smoothstep( 0.55, 0.92, streak ) );
          vec3 sandCol = uSand * ( 0.9 + 0.25 * rk_n( vWPos.xz * 0.25 ) );
          rock = mix( rock, mix( rock, sandCol, 0.6 ), smoothstep( 0.0, 1.0, 1.0 - vInfo.x ) );
          rock = mix( rock, sandCol * 1.05, smoothstep( 0.55, 0.95, wn.y ) * 0.75 );
          diffuseColor.rgb = rock;
        }
      `)
      .replace('#include <normal_fragment_maps>', /* glsl */`
        #include <normal_fragment_maps>
        {
          vec3 q = vWPos * vec3( 0.85, 0.55, 0.85 );
          float e = 0.3;
          float n0 = rk_n3( q );
          vec3 g = vec3( rk_n3( q + vec3( e, 0.0, 0.0 ) ) - n0,
                         rk_n3( q + vec3( 0.0, e, 0.0 ) ) - n0,
                         rk_n3( q + vec3( 0.0, 0.0, e ) ) - n0 ) / e;
          normal = normalize( normal - ( viewMatrix * vec4( g, 0.0 ) ).xyz * 0.32 );
        }
      `);
  };
  return mat;
}
