import * as THREE from 'three';
import { scene } from './scene.js';
import { noise2D, fbm2D, smoothstep } from './utils.js';

const VERT_HEAD = /* glsl */`
  #include <common>
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
`;

const FRAG_HEAD = /* glsl */`
  #include <common>
  uniform sampler2D uRoadMask;
  uniform vec2 uMaskOrigin;
  uniform vec2 uMaskSize;
  uniform float uRoadOn;
  uniform vec3 uSandA;
  uniform vec3 uSandB;
  uniform vec3 uSandC;
  uniform vec3 uRock;
  uniform vec3 uRoadA;
  uniform vec3 uRoadB;
  uniform vec3 uRoadWorn;
  uniform vec2 uRockStart;
  uniform vec2 uRockDir;
  uniform float uRockLength;
  uniform float uRockOn;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  float th_hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
  vec2 th_hash2( vec2 p ) {
    p = vec2( dot( p, vec2( 127.1, 311.7 ) ), dot( p, vec2( 269.5, 183.3 ) ) );
    return fract( sin( p ) * 43758.5453 );
  }
  float th_noise( vec2 p ) {
    vec2 i = floor( p ), f = fract( p );
    f = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( th_hash( i ), th_hash( i + vec2( 1.0, 0.0 ) ), f.x ),
                mix( th_hash( i + vec2( 0.0, 1.0 ) ), th_hash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
  }
  float th_voronoiEdge( vec2 p ) {
    vec2 n = floor( p ), f = fract( p );
    float d1 = 8.0, d2 = 8.0;
    for ( int j = -1; j <= 1; j++ ) {
      for ( int i = -1; i <= 1; i++ ) {
        vec2 g = vec2( float( i ), float( j ) );
        vec2 r = g + th_hash2( n + g ) - f;
        float d = dot( r, r );
        if ( d < d1 ) { d2 = d1; d1 = d; } else if ( d < d2 ) { d2 = d; }
      }
    }
    return sqrt( d2 ) - sqrt( d1 );
  }

  const vec2 WIND = vec2( 0.8, 0.6 );
  // Wind ripples: domain-warped sine crests whose strength drifts across the dune field.
  float th_ripple( vec2 p ) {
    float warp = th_noise( p * 0.11 ) * 3.2 + th_noise( p * 0.45 ) * 0.55;
    float s = dot( p, WIND ) * 3.6 + warp * 3.0;
    float drift = 0.55 + 0.45 * sin( dot( p, vec2( -WIND.y, WIND.x ) ) * 0.35 + th_noise( p * 0.2 ) * 4.0 );
    return sin( s ) * drift;
  }
  float th_ripple2( vec2 p ) {
    float warp = th_noise( p * 0.9 + 5.0 ) * 2.0;
    return sin( dot( p, vec2( WIND.y, -WIND.x ) * 11.0 ) + warp * 3.0 );
  }
`;

const FRAG_COLOR = /* glsl */`
  #include <map_fragment>
  vec2 wp = vWorldPos.xz;
  vec3 wn = normalize( vWorldNormal );
  float slope = 1.0 - clamp( wn.y, 0.0, 1.0 );

  float fw = length( fwidth( wp ) );
  float amp1 = 1.0 - smoothstep( 0.17, 0.7, fw );
  float amp2 = 1.0 - smoothstep( 0.06, 0.25, fw );

  float nLarge = th_noise( wp * 0.0035 );
  float nMid = th_noise( wp * 0.02 + 11.0 );
  float nSmall = th_noise( wp * 0.35 + 3.0 );

  vec3 sand = mix( uSandA, uSandB, smoothstep( 0.25, 0.75, nLarge * 0.6 + nMid * 0.4 ) );
  sand = mix( sand, uSandC, smoothstep( 0.55, 0.9, th_noise( wp * 0.011 + 40.0 ) ) * 0.5 );
  sand *= 0.93 + 0.14 * nSmall;

  vec3 mask = texture2D( uRoadMask, ( wp - uMaskOrigin ) / uMaskSize ).rgb * uRoadOn;
  float roadAmt = mask.r;

  float rippleAmp = ( 1.0 - 0.9 * roadAmt );
  float r1 = th_ripple( wp );
  float r2 = th_ripple2( wp );
  float rippleShade = r1 * amp1 * rippleAmp;
  sand *= 1.0 + 0.16 * rippleShade + 0.04 * r2 * amp2 * rippleAmp;

  vec3 dirt = mix( uRoadA, uRoadB, smoothstep( 0.3, 0.7, nMid ) );
  dirt *= 0.9 + 0.2 * th_noise( wp * 1.7 ) + 0.07 * th_noise( wp * 6.0 ) * amp2;
  dirt = mix( dirt, uRoadWorn, mask.g * 0.6 );

  vec3 ground = mix( sand, dirt, roadAmt );
  float pebbles = smoothstep( 0.8, 0.86, th_noise( wp * 4.7 ) ) * mask.b * amp2;
  ground = mix( ground, uRock * 0.8, pebbles * 0.7 );

  float rockAlong = dot( wp - uRockStart, uRockDir );
  float rockAcross = abs( ( wp.x - uRockStart.x ) * uRockDir.y - ( wp.y - uRockStart.y ) * uRockDir.x );
  float rockZone = smoothstep( 0.0, 55.0, rockAlong )
    * ( 1.0 - smoothstep( uRockLength - 45.0, uRockLength, rockAlong ) )
    * ( 1.0 - smoothstep( 130.0, 230.0, rockAcross ) ) * uRockOn;
  float rockGrain = th_noise( wp * 0.035 ) * 0.55 + th_noise( wp * 0.11 + 13.0 ) * 0.45;
  vec3 rockyGround = mix( uRock * 0.82, uRoadA, smoothstep( 0.35, 0.8, rockGrain ) );
  rockyGround *= 0.76 + 0.42 * rockGrain;
  ground = mix( ground, rockyGround, rockZone * 0.94 );

  float wash = 1.0 - smoothstep( 0.35, 1.5, vWorldPos.y );
  if ( wash > 0.01 ) {
    float crack = 1.0 - smoothstep( 0.0, 0.07, th_voronoiEdge( wp * 0.45 ) );
    vec3 bed = mix( ground, vec3( 0.55, 0.38, 0.25 ), 0.45 );
    bed *= 1.0 - crack * 0.35 * amp1;
    ground = mix( ground, bed, wash * 0.8 );
  }

  ground = mix( ground, uRock, smoothstep( 0.3, 0.55, slope ) * 0.8 );
  diffuseColor.rgb = ground;
`;

const FRAG_ROUGH = /* glsl */`
  #include <roughnessmap_fragment>
  roughnessFactor = mix( 0.95, 0.86, roadAmt );
`;

const FRAG_NORMAL = /* glsl */`
  #include <normal_fragment_maps>
  {
    vec2 e = vec2( 0.04, 0.0 );
    float h0 = r1;
    vec2 g1 = vec2( th_ripple( wp + e.xy ) - h0, th_ripple( wp + e.yx ) - h0 ) / e.x;
    float h2 = r2;
    vec2 g2 = vec2( th_ripple2( wp + e.xy ) - h2, th_ripple2( wp + e.yx ) - h2 ) / e.x;
    vec2 g = g1 * ( 0.075 * amp1 ) + g2 * ( 0.022 * amp2 );
    g *= rippleAmp;
    normal = normalize( normal + ( viewMatrix * vec4( -g.x, 0.0, -g.y, 0.0 ) ).xyz );
  }
`;

/**
 * Terrain - procedural Arizona desert floor with wind-rippled sand, a painted racing surface
 * and a heightfield shared with horse ground-following.
 */
export class Terrain {
  constructor() {
    this.size = 11000;
    this.segments = 480;
    this.courseSections = [];
    this.geometry = null;
    this.material = null;
    this.mesh = null;
    this.uniforms = null;
    this.init();
  }

  init() {
    this.geometry = new THREE.PlaneGeometry(this.size, this.size, this.segments, this.segments);
    this.geometry.rotateX(-Math.PI / 2);

    const posAttr = this.geometry.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      posAttr.setY(i, this.getHeightAt(posAttr.getX(i), posAttr.getZ(i)));
    }
    posAttr.needsUpdate = true;
    this.geometry.computeVertexNormals();

    const emptyMask = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    emptyMask.needsUpdate = true;

    this.uniforms = {
      uRoadMask: { value: emptyMask },
      uMaskOrigin: { value: new THREE.Vector2() },
      uMaskSize: { value: new THREE.Vector2(1, 1) },
      uRoadOn: { value: 0 },
      uSandA: { value: new THREE.Color(0xEBB872) },
      uSandB: { value: new THREE.Color(0xD28C47) },
      uSandC: { value: new THREE.Color(0xF2D29C) },
      uRock: { value: new THREE.Color(0x8E4D2B) },
      uRoadA: { value: new THREE.Color(0xA66C3C) },
      uRoadB: { value: new THREE.Color(0xBD8753) },
      uRoadWorn: { value: new THREE.Color(0xD9A66E) },
      uRockStart: { value: new THREE.Vector2() },
      uRockDir: { value: new THREE.Vector2(0, -1) },
      uRockLength: { value: 1 },
      uRockOn: { value: 0 }
    };

    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0 });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', VERT_HEAD)
        .replace('#include <begin_vertex>', /* glsl */`
          #include <begin_vertex>
          vWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
          vWorldNormal = normalize( mat3( modelMatrix ) * objectNormal );
        `);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', FRAG_HEAD)
        .replace('#include <map_fragment>', FRAG_COLOR)
        .replace('#include <roughnessmap_fragment>', FRAG_ROUGH)
        .replace('#include <normal_fragment_maps>', FRAG_NORMAL);
    };

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    if (scene) scene.add(this.mesh);
  }

  /**
   * Paints a track's road mask onto the ground.
   * @param {{ texture: THREE.Texture, origin: THREE.Vector2, size: THREE.Vector2 } | null} mask
   */
  setRoadMask(mask) {
    if (!mask) {
      this.uniforms.uRoadOn.value = 0;
      return;
    }
    this.uniforms.uRoadMask.value = mask.texture;
    this.uniforms.uMaskOrigin.value.copy(mask.origin);
    this.uniforms.uMaskSize.value.copy(mask.size);
    this.uniforms.uRoadOn.value = 1;
  }

  setCourseSections(sections) {
    this.courseSections = sections.map((section) => {
      const start = section.path.getPointAt(0);
      const direction = section.path.getTangentAt(0).setY(0).normalize();
      return { ...section, start, direction, length: section.path.getLength() };
    });

    const rocky = this.courseSections.find((section) => section.type === 'rocky');
    if (rocky) {
      this.uniforms.uRockStart.value.set(rocky.start.x, rocky.start.z);
      this.uniforms.uRockDir.value.set(rocky.direction.x, rocky.direction.z);
      this.uniforms.uRockLength.value = rocky.length;
      this.uniforms.uRockOn.value = 1;
    }

    const positions = this.geometry.attributes.position;
    for (let index = 0; index < positions.count; index++) {
      positions.setY(index, this.getHeightAt(positions.getX(index), positions.getZ(index)));
    }
    positions.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  /**
   * Pure heightfield shared by the visual mesh, ground-following and object placement.
   */
  calculateHeight(x, z) {
    const d1 = Math.sin(x * 0.006 + z * 0.004) * 0.9;
    const d2 = Math.cos(x * 0.003 - z * 0.005) * 0.7;
    const ripples = Math.sin((x * 0.707 + z * 0.707) * 0.032) * 0.35;
    const nFloor = fbm2D(x * 0.0025, z * 0.0025, 3) * 1.5;

    // Long crescent dune ridges that rise away from the course.
    const ridge = 1.0 - Math.abs(noise2D(x * 0.0032 + 7.0, z * 0.0032 + 3.0));
    const dist = Math.hypot(x, z - 40);
    const ridges = ridge * ridge * ridge * 3.4 * smoothstep(260, 520, dist);

    let h = 1.5 + d1 + d2 + ripples + nFloor + ridges;

    // Shallow dry washes.
    const washNoise = Math.abs(noise2D(x * 0.002 + 12.0, z * 0.002 + 34.0));
    h -= (1.0 - smoothstep(0.0, 0.14, washNoise)) * 1.7;

    const hill1 = Math.exp(-((x - 140) * (x - 140) + (z - 50) * (z - 50)) / 22000.0) * 5.5;
    const hill2 = Math.exp(-((x + 110) * (x + 110) + (z + 200) * (z + 200)) / 25000.0) * 4.2;
    const dip1 = -Math.exp(-((x + 70) * (x + 70) + (z - 180) * (z - 180)) / 18000.0) * 1.8;
    h += hill1 + hill2 + dip1;

    for (const section of this.courseSections) {
      if (section.type !== 'incline' && section.type !== 'rocky') continue;
      const dx = x - section.start.x;
      const dz = z - section.start.z;
      const along = dx * section.direction.x + dz * section.direction.z;
      const across = Math.abs(dx * section.direction.z - dz * section.direction.x);
      if (along < -35 || along > section.length + 35 || across > 230) continue;

      const longitudinal = smoothstep(0, 55, along) * (1 - smoothstep(section.length - 45, section.length, along));
      const lateral = 1 - smoothstep(130, 230, across);
      const zone = longitudinal * lateral;

      if (section.type === 'incline') {
        h += 22 * smoothstep(section.length * 0.15, section.length * 0.95, along) * zone;
      } else {
        h += 22 * (1 - smoothstep(0, section.length * 0.24, along)) * zone;
        h += fbm2D(x * 0.028 + 13, z * 0.028 - 7, 3) * 2.8 * zone;
      }
    }

    return Math.max(0.1, h);
  }

  getHeightAt(x, z) {
    return this.calculateHeight(x, z);
  }

  getNormalAt(x, z) {
    const eps = 0.5;
    const hL = this.getHeightAt(x - eps, z);
    const hR = this.getHeightAt(x + eps, z);
    const hD = this.getHeightAt(x, z - eps);
    const hU = this.getHeightAt(x, z + eps);
    return new THREE.Vector3(hL - hR, 2.0 * eps, hD - hU).normalize();
  }

  update() {}
}
