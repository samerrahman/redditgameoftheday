import * as Phaser from 'phaser';

export const DUNGEON_ATMOSPHERE_NODE = 'DungeonAtmosphereFilter';

export type PixelLightSpec = {
  x: number;
  y: number;
  radius: number;
  r: number;
  g: number;
  b: number;
};

const FRAGMENT_SHADER = `
#pragma phaserTemplate(shaderName)
precision mediump float;

uniform sampler2D uMainSampler;

uniform vec2 uPixelGrid;
uniform vec3 uAmbientColor;
uniform vec4 uVignetteColor;
uniform vec4 uFlashColor;

uniform vec4 uLightPos0;
uniform vec3 uLightCol0;
uniform vec4 uLightPos1;
uniform vec3 uLightCol1;
uniform vec4 uLightPos2;
uniform vec3 uLightCol2;
uniform vec4 uLightPos3;
uniform vec3 uLightCol3;
uniform vec4 uLightPos4;
uniform vec3 uLightCol4;
uniform vec4 uLightPos5;
uniform vec3 uLightCol5;

varying vec2 outTexCoord;

vec3 accumLight(vec2 puv, vec2 cell, vec4 lp, vec3 lc)
{
    if (lp.z <= 0.001 || lp.w <= 0.001) {
        return vec3(0.0);
    }
    vec2 diff = (puv - lp.xy) * vec2(1.5, 1.0);
    float dist = length(diff);
    float falloff = clamp(1.0 - dist / lp.z, 0.0, 1.0);
    float bayer = fract(dot(mod(cell, 2.0), vec2(0.5, 0.25)) + 0.125);
    float stepped = floor(falloff * falloff * 5.0 + bayer) / 5.0;
    return lc * (clamp(stepped, 0.0, 1.0) * lp.w);
}

void main ()
{
    vec4 base = texture2D(uMainSampler, outTexCoord);

    // Phaser WebGL internal framebuffer Y=0 is bottom; flip to top-left arena UV.
    vec2 uv = vec2(outTexCoord.x, 1.0 - outTexCoord.y);
    vec2 cell = floor(uv * uPixelGrid);
    vec2 puv = (cell + 0.5) / uPixelGrid;

    vec3 lightAccum = vec3(0.0);
    lightAccum += accumLight(puv, cell, uLightPos0, uLightCol0);
    lightAccum += accumLight(puv, cell, uLightPos1, uLightCol1);
    lightAccum += accumLight(puv, cell, uLightPos2, uLightCol2);
    lightAccum += accumLight(puv, cell, uLightPos3, uLightCol3);
    lightAccum += accumLight(puv, cell, uLightPos4, uLightCol4);
    lightAccum += accumLight(puv, cell, uLightPos5, uLightCol5);

    vec3 lit = base.rgb * clamp(uAmbientColor + lightAccum, uAmbientColor, vec3(1.32));
    lit += lightAccum * (0.045 + base.rgb * 0.08);

    // Pixel-snapped Bayer-dithered dungeon vignette around edges.
    vec2 vigDiff = (puv - vec2(0.5, 0.5)) * vec2(1.0, 0.92);
    float vigDist = length(vigDiff);
    float vigFactor = clamp((vigDist - 0.34) / 0.44, 0.0, 1.0) * uVignetteColor.a;
    float vigBayer = fract(dot(mod(cell, 2.0), vec2(0.5, 0.25)) + 0.125);
    float vigStep = floor(vigFactor * vigFactor * 6.0 + vigBayer) / 6.0;
    lit = mix(lit, uVignetteColor.rgb, clamp(vigStep, 0.0, 0.72));

    lit = mix(lit, uFlashColor.rgb, clamp(uFlashColor.a, 0.0, 0.55));
    gl_FragColor = vec4(lit, base.a);
}
`.trim();

const EMPTY_LIGHT_POS: [number, number, number, number] = [0, 0, 0, 0];
const EMPTY_LIGHT_COL: [number, number, number] = [0, 0, 0];

export class DungeonAtmosphereController extends Phaser.Filters.Controller {
  public ambientColor: [number, number, number] = [0.64, 0.6, 0.74];
  public vignetteColor: [number, number, number] = [0.05, 0.03, 0.09];
  public vignetteStrength = 0.58;
  public flashColor: [number, number, number] = [1, 0.85, 0.6];
  public flashStrength = 0;

  public readonly lights: Array<[number, number, number, number]> = Array.from(
    { length: 6 },
    (): [number, number, number, number] => [...EMPTY_LIGHT_POS],
  );
  public readonly lightColors: Array<[number, number, number]> = Array.from(
    { length: 6 },
    (): [number, number, number] => [...EMPTY_LIGHT_COL],
  );

  constructor(camera: Phaser.Cameras.Scene2D.Camera) {
    super(camera, DUNGEON_ATMOSPHERE_NODE);
  }

  public setLight(index: number, spec: PixelLightSpec | null, intensity = 1): void {
    const pos = this.lights[index];
    const col = this.lightColors[index];
    if (!pos || !col) return;
    if (!spec || spec.radius <= 0 || intensity <= 0) {
      pos[0] = 0;
      pos[1] = 0;
      pos[2] = 0;
      pos[3] = 0;
      col[0] = 0;
      col[1] = 0;
      col[2] = 0;
      return;
    }
    pos[0] = spec.x;
    pos[1] = spec.y;
    pos[2] = spec.radius;
    pos[3] = intensity;
    col[0] = spec.r;
    col[1] = spec.g;
    col[2] = spec.b;
  }
}

export class DungeonAtmosphereNode extends Phaser.Renderer.WebGL.RenderNodes.BaseFilterShader {
  constructor(manager: Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager) {
    super(DUNGEON_ATMOSPHERE_NODE, manager, undefined, FRAGMENT_SHADER);
  }

  public override setupUniforms(
    controller: Phaser.Filters.Controller,
    _drawingContext: Phaser.Renderer.WebGL.DrawingContext,
  ): void {
    if (!(controller instanceof DungeonAtmosphereController)) return;
    const pm = this.programManager;

    pm.setUniform('uPixelGrid', [224, 150]);
    pm.setUniform('uAmbientColor', controller.ambientColor);
    pm.setUniform('uVignetteColor', [
      controller.vignetteColor[0],
      controller.vignetteColor[1],
      controller.vignetteColor[2],
      controller.vignetteStrength,
    ]);
    pm.setUniform('uFlashColor', [
      controller.flashColor[0],
      controller.flashColor[1],
      controller.flashColor[2],
      controller.flashStrength,
    ]);

    pm.setUniform('uLightPos0', controller.lights[0] ?? EMPTY_LIGHT_POS);
    pm.setUniform('uLightCol0', controller.lightColors[0] ?? EMPTY_LIGHT_COL);
    pm.setUniform('uLightPos1', controller.lights[1] ?? EMPTY_LIGHT_POS);
    pm.setUniform('uLightCol1', controller.lightColors[1] ?? EMPTY_LIGHT_COL);
    pm.setUniform('uLightPos2', controller.lights[2] ?? EMPTY_LIGHT_POS);
    pm.setUniform('uLightCol2', controller.lightColors[2] ?? EMPTY_LIGHT_COL);
    pm.setUniform('uLightPos3', controller.lights[3] ?? EMPTY_LIGHT_POS);
    pm.setUniform('uLightCol3', controller.lightColors[3] ?? EMPTY_LIGHT_COL);
    pm.setUniform('uLightPos4', controller.lights[4] ?? EMPTY_LIGHT_POS);
    pm.setUniform('uLightCol4', controller.lightColors[4] ?? EMPTY_LIGHT_COL);
    pm.setUniform('uLightPos5', controller.lights[5] ?? EMPTY_LIGHT_POS);
    pm.setUniform('uLightCol5', controller.lightColors[5] ?? EMPTY_LIGHT_COL);
  }
}

export function attachDungeonAtmosphere(scene: Phaser.Scene): DungeonAtmosphereController | null {
  const renderer = scene.game.renderer;
  if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) {
    return null;
  }
  if (!renderer.renderNodes.hasNode(DUNGEON_ATMOSPHERE_NODE)) {
    renderer.renderNodes.addNodeConstructor(DUNGEON_ATMOSPHERE_NODE, DungeonAtmosphereNode);
  }
  const controller = new DungeonAtmosphereController(scene.cameras.main);
  scene.cameras.main.filters.internal.add(controller);
  return controller;
}
