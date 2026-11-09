import * as THREE from 'three';
import { scene, renderer } from './scene.js';
import { SUN_DIRECTION, SUN_LIGHT_COLOR, HAZE_COLOR, ATMOSPHERE_GLSL } from './atmosphere.js';

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vec4 wp = modelMatrix * vec4( position, 1.0 );
    vDir = wp.xyz - cameraPosition;
    gl_Position = ( projectionMatrix * viewMatrix * wp ).xyww;
  }
`;

const SKY_FRAG = /* glsl */`
  uniform vec3 uZenith;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uBounce;
  uniform vec3 uSunColor;
  uniform float uTime;
  varying vec3 vDir;

  ${ATMOSPHERE_GLSL}

  float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
  float vnoise( vec2 p ) {
    vec2 i = floor( p ), f = fract( p );
    f = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), f.x ),
                mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
  }
  float fbm( vec2 p ) {
    float a = 0.5, s = 0.0;
    for ( int i = 0; i < 5; i++ ) {
      s += a * vnoise( p );
      p = p * 2.03 + vec2( 17.3, 9.1 );
      a *= 0.5;
    }
    return s;
  }

  void main() {
    vec3 d = normalize( vDir );
    float y = d.y;
    float mu = max( dot( d, ATM_SUN_DIR ), 0.0 );

    vec3 haze = atmHaze( d, uHorizon );
    float h = max( y, 0.0 );
    vec3 col = mix( haze, uMid, smoothstep( 0.0, 0.55, pow( h, 0.7 ) ) );
    col = mix( col, uZenith, smoothstep( 0.3, 1.0, pow( h, 0.85 ) ) );

    #ifdef ENV_PASS
      col = mix( col, uBounce, smoothstep( 0.0, -0.25, y ) );
      vec3 glow = uSunColor * pow( mu, 6.0 ) * 0.3;
    #else
      col = y < 0.0 ? haze : col;

      if ( y > 0.0 ) {
        vec2 cp = d.xz / ( y + 0.10 );
        cp = cp * 0.35 + vec2( uTime * 0.006, uTime * 0.002 );
        vec2 q = vec2( cp.x * 0.55, cp.y * 1.7 );
        float warp = fbm( q * 0.8 + 3.7 );
        float w = fbm( q * 1.4 + warp * 1.6 );
        float fade = smoothstep( 0.0, 0.12, y ) * ( 1.0 - smoothstep( 0.6, 0.98, y ) );
        float cloud = clamp( smoothstep( 0.48, 0.82, w ) * 0.8 + smoothstep( 0.5, 0.95, fbm( q * 3.2 + warp ) ) * 0.45, 0.0, 1.0 ) * fade;
        vec3 lit = mix( vec3( 0.98, 0.84, 0.74 ), vec3( 1.0, 0.62, 0.34 ), pow( mu, 2.0 ) ) * 1.05;
        lit += uSunColor * pow( mu, 10.0 ) * 1.2;
        vec3 shade = mix( lit, uMid * 1.1, 0.35 );
        col = mix( col, mix( shade, lit, smoothstep( 0.35, 0.65, w ) ), cloud * 0.85 );
      }

      vec3 glow = uSunColor * ( pow( mu, 6.0 ) * 0.3 + pow( mu, 48.0 ) * 0.8 + pow( mu, 700.0 ) * 3.0 );
      glow += vec3( 1.0, 0.93, 0.78 ) * smoothstep( 0.99970, 0.99988, mu ) * 22.0;
      glow *= smoothstep( -0.02, 0.02, y );
    #endif

    gl_FragColor = vec4( col + glow, 1.0 );
  }
`;

/**
 * Sky - golden-hour sky dome, sun light with stable shadows, and an image-based environment.
 */
export class Sky {
  constructor() {
    this.sunDirection = SUN_DIRECTION.clone();
    this.sunLight = null;
    this.hemiLight = null;
    this.skyMesh = null;
    this.skyMat = null;
    this.shadowExtent = 75;
    this.init();
  }

  createSkyMaterial(envPass = false) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uZenith: { value: new THREE.Color(0x2F63A8) },
        uMid: { value: new THREE.Color(0x7FA9DA) },
        uHorizon: { value: HAZE_COLOR.clone() },
        uBounce: { value: new THREE.Color(0xB9783B) },
        uSunColor: { value: new THREE.Color(0xFFB868) }
      },
      defines: envPass ? { ENV_PASS: '' } : {},
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false
    });
  }

  init() {
    this.sunLight = new THREE.DirectionalLight(SUN_LIGHT_COLOR, 4.6);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    const ext = this.shadowExtent;
    const cam = this.sunLight.shadow.camera;
    cam.left = -ext;
    cam.right = ext;
    cam.top = ext;
    cam.bottom = -ext;
    cam.near = 20;
    cam.far = 420;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.06;
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);

    this.hemiLight = new THREE.HemisphereLight(0xA9C3E6, 0xB9772F, 0.28);
    scene.add(this.hemiLight);

    this.skyMat = this.createSkyMaterial(false);
    this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), this.skyMat);
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = -1000;
    scene.add(this.skyMesh);

    this.buildEnvironment();
  }

  /** Bakes the sky into a PMREM environment so PBR surfaces pick up sky light and warm ground bounce. */
  buildEnvironment() {
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.createSkyMaterial(true)));
    const pmrem = new THREE.PMREMGenerator(renderer);
    const target = pmrem.fromScene(envScene, 0.02, 0.1, 100);
    scene.environment = target.texture;
    pmrem.dispose();
  }

  setShadowResolution(size) {
    const shadow = this.sunLight.shadow;
    if (shadow.mapSize.x === size) return;
    shadow.mapSize.set(size, size);
    if (shadow.map) {
      shadow.map.dispose();
      shadow.map = null;
    }
  }

  /**
   * @param {number} time - elapsed seconds
   * @param {THREE.Vector3} cameraPosition - dome follows the camera
   * @param {THREE.Vector3} followPosition - shadow frustum center (snapped to shadow texels)
   */
  update(time, cameraPosition, followPosition) {
    this.skyMat.uniforms.uTime.value = time;
    if (cameraPosition) this.skyMesh.position.copy(cameraPosition);
    if (followPosition) this.followShadow(followPosition);
  }

  followShadow(target) {
    const f = this.sunDirection;
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), f).normalize();
    const up = new THREE.Vector3().crossVectors(f, right).normalize();
    const texel = (this.shadowExtent * 2) / this.sunLight.shadow.mapSize.x;
    const sx = Math.round(target.dot(right) / texel) * texel;
    const sy = Math.round(target.dot(up) / texel) * texel;
    const sz = target.dot(f);

    this.sunLight.target.position.set(0, 0, 0)
      .addScaledVector(right, sx)
      .addScaledVector(up, sy)
      .addScaledVector(f, sz);
    this.sunLight.position.copy(this.sunLight.target.position).addScaledVector(f, 220);
    this.sunLight.target.updateMatrixWorld();
  }
}
