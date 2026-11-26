/**
 * Krunked Lumia — WebGL2 (GLSL ES 3.00) Shader Sources & Compilation Utilities
 *
 * Preserves Mixolumia's exact 4 post-process/effect shaders:
 * 1. bloom_filter_luminance_shd (0.229, 0.587, 0.114 luminance weights + light-palette ink extraction)
 * 2. blur_2_pass_gauss_lerp_shd (separable bilinear Gaussian blur: blur_steps = 3.0, sigma = 0.5)
 * 3. blend_darken_shd           (dark additive bloom / light multiplicative ink-darken composite)
 * 4. color_threshold_shd        (96x96 monochrome cover remapping: intensity > 0.5 ? u_col2 : u_col1)
 */

export const SHADER_NAMES = {
  bloomFilter: 'bloom_filter_luminance_shd',
  blurGauss: 'blur_2_pass_gauss_lerp_shd',
  blendDarken: 'blend_darken_shd',
  colorThreshold: 'color_threshold_shd',
} as const;

export const SPRITE_VERT_SRC = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in vec4 a_color;

uniform vec2 u_resolution;

out vec2 v_uv;
out vec4 v_color;

void main() {
  vec2 zeroToOne = a_pos / u_resolution;
  vec2 ndc = zeroToOne * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  v_uv = a_uv;
  v_color = a_color;
}
`;

export const SPRITE_FRAG_SRC = `#version 300 es
precision highp float;

in vec2 v_uv;
in vec4 v_color;

uniform sampler2D u_tex;

out vec4 outColor;

void main() {
  vec4 texel = texture(u_tex, v_uv);
  vec4 col = texel * v_color;
  if (col.a <= 0.001) {
    discard;
  }
  outColor = col;
}
`;

export const FULLSCREEN_VERT_SRC = `#version 300 es
precision highp float;

out vec2 v_uv;

void main() {
  // Fullscreen triangle covering NDC [-1, 1] without vertex buffers
  vec2 pos = vec2(
    (gl_VertexID == 1) ? 3.0 : -1.0,
    (gl_VertexID == 2) ? 3.0 : -1.0
  );
  v_uv = pos * 0.5 + 0.5;
  gl_Position = vec4(pos, 0.0, 1.0);
}
`;

/**
 * Present pass vertex shader supporting optional 90-degree Tate rotation and Board Zoom
 * while preserving exact nearest-neighbor pixel crispness on the 320x180 scene texture.
 */
export const PRESENT_VERT_SRC = `#version 300 es
precision highp float;

uniform float u_tateRotate;
uniform float u_boardZoom;

out vec2 v_uv;

void main() {
  vec2 pos = vec2(
    (gl_VertexID == 1) ? 3.0 : -1.0,
    (gl_VertexID == 2) ? 3.0 : -1.0
  );
  vec2 uv = pos * 0.5 + 0.5;

  // 90-degree CW Tate rotation (vertical monitor orientation)
  if (u_tateRotate > 0.5) {
    uv = vec2(1.0 - uv.y, uv.x);
  }

  // Board Zoom: tight crisp 1.25x framing around centered diamond container
  if (u_boardZoom > 1.001) {
    uv = (uv - 0.5) / u_boardZoom + 0.5;
  }

  v_uv = uv;
  gl_Position = vec4(pos, 0.0, 1.0);
}
`;

/**
 * Shader 1: bloom_filter_luminance_shd
 * Extracts bright luminance bloom on dark palettes using exact weights (0.229, 0.587, 0.114),
 * or inverted ink contrast on light palettes (u_isLight > 0.5) so light themes get crisp
 * subtractive ink-bloom with zero white washout.
 */
export const BLOOM_FILTER_LUMINANCE_FRAG_SRC = `#version 300 es
precision highp float;
// bloom_filter_luminance_shd

in vec2 v_uv;

uniform sampler2D u_tex;
uniform float u_threshold;
uniform float u_range;
uniform float u_isLight;

out vec4 outColor;

void main() {
  vec4 col = texture(u_tex, v_uv);
  float lum = dot(col.rgb, vec3(0.229, 0.587, 0.114));

  if (u_isLight > 0.5) {
    // Light palette: extract inverted contrast tinted toward darker accent ink
    float invLum = 1.0 - lum;
    float factor = smoothstep(u_threshold, u_threshold + u_range, invLum);
    vec3 ink = (1.0 - col.rgb) * factor;
    outColor = vec4(ink, 1.0);
  } else {
    // Dark palette: extract luminous emissive highlights
    float factor = smoothstep(u_threshold, u_threshold + u_range, lum);
    outColor = vec4(col.rgb * factor, 1.0);
  }
}
`;

/**
 * Shader 2: blur_2_pass_gauss_lerp_shd
 * Separable horizontal/vertical bilinear Gaussian blur with exact extracted parameters:
 * blur_steps = 3.0, sigma = 0.5.
 */
export const BLUR_2_PASS_GAUSS_LERP_FRAG_SRC = `#version 300 es
precision highp float;
// blur_2_pass_gauss_lerp_shd

in vec2 v_uv;

uniform sampler2D u_tex;
uniform vec2 u_texelStep;

const float blur_steps = 3.0;
const float sigma = 0.5;

out vec4 outColor;

float gaussWeight(float stepIndex) {
  float t = stepIndex / blur_steps;
  return exp(-(t * t) / (2.0 * sigma * sigma));
}

void main() {
  float w0 = gaussWeight(0.0);
  vec3 acc = texture(u_tex, v_uv).rgb * w0;
  float totalWeight = w0;

  // Bilinear lerp pairing across symmetric positive/negative taps
  for (float i = 1.0; i <= blur_steps; i += 2.0) {
    float w1 = gaussWeight(i);
    if (i + 1.0 <= blur_steps) {
      float w2 = gaussWeight(i + 1.0);
      float wPair = w1 + w2;
      float lerpOffset = (i * w1 + (i + 1.0) * w2) / wPair;
      vec2 delta = u_texelStep * lerpOffset;
      acc += (texture(u_tex, v_uv + delta).rgb + texture(u_tex, v_uv - delta).rgb) * wPair;
      totalWeight += 2.0 * wPair;
    } else {
      vec2 delta = u_texelStep * i;
      acc += (texture(u_tex, v_uv + delta).rgb + texture(u_tex, v_uv - delta).rgb) * w1;
      totalWeight += 2.0 * w1;
    }
  }

  outColor = vec4(acc / totalWeight, 1.0);
}
`;

/**
 * Shader 3: blend_darken_shd
 * Dark-light adaptive bloom composite:
 * - Dark palette (bgLuma <= 128): additive base + bloom * u_bloomIntensity
 * - Light palette (bgLuma > 128): multiplicative darken blend preserving razor-sharp contrast
 *   on Pico Light (#fff1e8) with ZERO white washout.
 */
export const BLEND_DARKEN_FRAG_SRC = `#version 300 es
precision highp float;
// blend_darken_shd

in vec2 v_uv;

uniform sampler2D u_baseTex;
uniform sampler2D u_bloomTex;
uniform float u_bloomIntensity;
uniform float u_isLight;
uniform vec4 u_flashColor;

out vec4 outColor;

void main() {
  vec4 base = texture(u_baseTex, v_uv);
  vec4 bloom = texture(u_bloomTex, v_uv);

  vec3 col;
  if (u_isLight > 0.5) {
    // Multiplicative darken ink-bloom for light palettes
    vec3 darkened = base.rgb * (1.0 - bloom.rgb * 0.65);
    col = mix(base.rgb, darkened, clamp(u_bloomIntensity * 2.2, 0.0, 1.0));
  } else {
    // Emissive additive bloom for dark palettes
    col = clamp(base.rgb + bloom.rgb * u_bloomIntensity, 0.0, 1.0);
  }

  col = mix(col, u_flashColor.rgb, u_flashColor.a);
  outColor = vec4(col, 1.0);
}
`;

/**
 * Shader 4: color_threshold_shd (vertex + fragment)
 * Renders 96x96 monochrome album covers directly into the 320x180 scene,
 * mapping pixel intensity > 0.5 ? u_col2 : u_col1.
 */
export const COLOR_THRESHOLD_VERT_SRC = `#version 300 es
precision highp float;
// color_threshold_shd vertex

uniform vec2 u_resolution;
uniform vec4 u_rect; // x, y, w, h in logical 320x180 coords

out vec2 v_uv;

void main() {
  // Triangle strip corners: (0,0), (1,0), (0,1), (1,1)
  vec2 corner = vec2(
    float(gl_VertexID & 1),
    float((gl_VertexID >> 1) & 1)
  );
  vec2 pxPos = u_rect.xy + corner * u_rect.zw;
  vec2 ndc = (pxPos / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  v_uv = corner;
}
`;

export const COLOR_THRESHOLD_FRAG_SRC = `#version 300 es
precision highp float;
// color_threshold_shd

in vec2 v_uv;

uniform sampler2D u_tex;
uniform vec3 u_col1;
uniform vec3 u_col2;
uniform float u_alpha;

out vec4 outColor;

void main() {
  vec4 sampleCol = texture(u_tex, v_uv);
  float intensity = dot(sampleCol.rgb, vec3(0.229, 0.587, 0.114));
  vec3 mapped = intensity > 0.5 ? u_col2 : u_col1;
  outColor = vec4(mapped, sampleCol.a * u_alpha);
}
`;

export function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error('Failed to allocate WebGL2 shader object');
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) || 'Unknown shader compile error';
    gl.deleteShader(shader);
    throw new Error(`WebGL2 shader compile error: ${info}`);
  }
  return shader;
}

export function compileProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string,
): WebGLProgram {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    throw new Error('Failed to allocate WebGL2 program object');
  }
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);

  gl.deleteShader(vert);
  gl.deleteShader(frag);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) || 'Unknown program link error';
    gl.deleteProgram(program);
    throw new Error(`WebGL2 program link error: ${info}`);
  }
  return program;
}
