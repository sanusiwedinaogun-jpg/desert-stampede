/**
 * Desert Stampede - Three.js scene, renderer and post-processing pipeline.
 * HDR scene -> bloom -> golden-hour grade -> ACES tone mapping.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { HAZE_COLOR, FOG_DENSITY, ATMOSPHERE_GLSL } from './atmosphere.js';

export let scene;
export let camera;
export let renderer;
export let clock;
export let composer;

export const post = { grade: null, bloom: null };

// Fog tinted by the sun: haze brightens and warms toward the sun for every fogged material.
function patchFogChunks() {
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = /* glsl */`
    #ifdef USE_FOG
      varying float vFogDepth;
      varying vec3 vFogRay;
    #endif
  `;
  C.fog_vertex = /* glsl */`
    #ifdef USE_FOG
      vFogDepth = - mvPosition.z;
      vFogRay = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
    #endif
  `;
  C.fog_pars_fragment = /* glsl */`
    ${ATMOSPHERE_GLSL}
    #ifdef USE_FOG
      uniform vec3 fogColor;
      varying float vFogDepth;
      varying vec3 vFogRay;
      #ifdef FOG_EXP2
        uniform float fogDensity;
      #else
        uniform float fogNear;
        uniform float fogFar;
      #endif
    #endif
  `;
  C.fog_fragment = /* glsl */`
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
      #else
        float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
      #endif
      vec3 fogTinted = atmHaze( normalize( vFogRay ), fogColor );
      gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTinted, fogFactor );
    #endif
  `;
}

const GradeShader = {
  name: 'DesertGradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uSpeed: { value: 0 },
    uVignette: { value: 0.34 }
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uSpeed;
    uniform float uVignette;
    varying vec2 vUv;

    float hash12( vec2 p ) {
      vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
      p3 += dot( p3, p3.yzx + 33.33 );
      return fract( ( p3.x + p3.y ) * p3.z );
    }

    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot( d, d );
      float edge = smoothstep( 0.03, 0.4, r2 );

      float ca = ( 0.0007 + 0.0025 * uSpeed ) * edge;
      float blur = uSpeed * 0.07 * edge;

      vec3 col = vec3( 0.0 );
      for ( int i = 0; i < 6; i++ ) {
        float s = float( i ) / 5.0;
        vec2 duv = d * ( 1.0 - blur * s );
        col.r += texture2D( tDiffuse, 0.5 + duv * ( 1.0 + ca ) ).r;
        col.g += texture2D( tDiffuse, 0.5 + duv ).g;
        col.b += texture2D( tDiffuse, 0.5 + duv * ( 1.0 - ca ) ).b;
      }
      col /= 6.0;

      float luma = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
      col = pow( max( col, vec3( 0.0 ) ) / 0.2, vec3( 1.07 ) ) * 0.2;
      col *= mix( vec3( 0.93, 0.98, 1.07 ), vec3( 1.07, 1.0, 0.88 ), smoothstep( 0.04, 0.9, luma ) );
      float l2 = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
      col = mix( vec3( l2 ), col, 1.14 );

      col *= 1.0 - uVignette * smoothstep( 0.22, 0.95, sqrt( r2 ) * 1.4 );
      col += ( hash12( gl_FragCoord.xy + fract( uTime ) * 91.7 ) - 0.5 ) * 0.010;

      gl_FragColor = vec4( col, 1.0 );
    }
  `
};

const QUALITY = [
  { pixelRatio: 0.75, bloom: false, shadow: 1024 },
  { pixelRatio: 1.0, bloom: true, shadow: 1024 },
  { pixelRatio: 1.5, bloom: true, shadow: 2048 },
  { pixelRatio: 2.0, bloom: true, shadow: 2048 }
];
let qualityLevel = 3;

export function getQualityLevel() {
  return qualityLevel;
}

export function getShadowResolution() {
  return QUALITY[qualityLevel].shadow;
}

export function setStormWeather(enabled) {
  if (!scene || !scene.fog) return;
  scene.fog.color.set(enabled ? 0xB49D83 : HAZE_COLOR);
  scene.fog.density = enabled ? 0.018 : FOG_DENSITY;
}

/**
 * Initializes the scene, camera, renderer and post-processing chain.
 * @param {HTMLCanvasElement|string} canvas
 */
export function initScene(canvas) {
  const targetCanvas = typeof canvas === 'string'
    ? document.querySelector(canvas) || document.getElementById(canvas)
    : canvas;

  if (!targetCanvas) {
    throw new Error('[scene.js] Valid canvas element must be provided to initScene().');
  }

  patchFogChunks();

  scene = new THREE.Scene();
  scene.background = HAZE_COLOR.clone();
  scene.fog = new THREE.FogExp2(HAZE_COLOR, FOG_DENSITY);

  clock = new THREE.Clock();

  renderer = new THREE.WebGLRenderer({
    canvas: targetCanvas,
    antialias: false,
    powerPreference: 'high-performance',
    stencil: false
  });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.3, 4000);
  camera.position.set(0, 10, 20);

  const rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
    type: THREE.HalfFloatType,
    samples: 4
  });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));

  post.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.42, 0.6, 1.0);
  composer.addPass(post.bloom);

  post.grade = new ShaderPass(GradeShader);
  composer.addPass(post.grade);
  composer.addPass(new OutputPass());

  applyQuality(qualityLevel);
  window.addEventListener('resize', onResize);

  return { scene, camera, renderer, clock };
}

function applyQuality(level) {
  const q = QUALITY[level];
  const pr = Math.min(window.devicePixelRatio || 1, q.pixelRatio);
  renderer.setPixelRatio(pr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setPixelRatio(pr);
  composer.setSize(window.innerWidth, window.innerHeight);
  post.bloom.enabled = q.bloom;
}

/** @param {number} level 0 (lowest) .. 3 (highest) */
export function setQuality(level) {
  qualityLevel = THREE.MathUtils.clamp(Math.round(level), 0, QUALITY.length - 1);
  if (renderer) applyQuality(qualityLevel);
}

export function onResize() {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  applyQuality(qualityLevel);
}

/**
 * Renders the frame through the post chain.
 * @param {number} time - elapsed seconds (grain animation)
 * @param {number} speedFx - 0..1 speed/sprint intensity for radial blur and aberration
 */
export function renderFrame(time = 0, speedFx = 0) {
  post.grade.uniforms.uTime.value = time;
  post.grade.uniforms.uSpeed.value = speedFx;
  composer.render();
}
