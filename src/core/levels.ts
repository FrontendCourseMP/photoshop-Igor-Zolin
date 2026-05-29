export type LevelsTarget = "master" | "r" | "g" | "b" | "a" | "gray";
export type HistogramScale = "linear" | "log";

export type LevelsSettings = {
  inputBlack: number;
  inputWhite: number;
  gamma: number;
};

const BYTE_MIN = 0;
const BYTE_MAX = 255;

function clampByte(value: number): number {
  return Math.min(BYTE_MAX, Math.max(BYTE_MIN, Math.round(value)));
}

function srgbToLinear(value: number): number {
  const normalized = value / BYTE_MAX;
  if (normalized <= 0.04045) {
    return normalized / 12.92;
  }
  return Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function getMasterLuminanceBin(r: number, g: number, b: number): number {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  const luminance = 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
  return clampByte(luminance * BYTE_MAX);
}

function mapLevelValue(value: number, settings: LevelsSettings): number {
  const inputBlack = clampByte(settings.inputBlack);
  const inputWhite = clampByte(settings.inputWhite);
  const gamma = Math.min(9.99, Math.max(0.1, settings.gamma));
  const safeWhite = inputWhite <= inputBlack ? inputBlack + 1 : inputWhite;

  const normalized = Math.min(
    1,
    Math.max(0, (value - inputBlack) / (safeWhite - inputBlack))
  );
  const corrected = Math.pow(normalized, gamma);
  return clampByte(corrected * BYTE_MAX);
}

export function buildHistogram(
  data: Uint8ClampedArray,
  target: LevelsTarget
): Uint32Array {
  const bins = new Uint32Array(256);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    let value = 0;
    if (target === "master") {
      value = getMasterLuminanceBin(r, g, b);
    } else if (target === "r") {
      value = r;
    } else if (target === "g") {
      value = g;
    } else if (target === "b") {
      value = b;
    } else if (target === "a") {
      value = a;
    } else {
      value = clampByte((r + g + b) / 3);
    }

    bins[value] += 1;
  }

  return bins;
}

export function applyLevelsToData(
  sourceData: Uint8ClampedArray,
  target: LevelsTarget,
  settings: LevelsSettings,
  hasAlphaChannel: boolean
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(sourceData);

  for (let i = 0; i < sourceData.length; i += 4) {
    if (target === "master") {
      output[i] = mapLevelValue(sourceData[i], settings);
      output[i + 1] = mapLevelValue(sourceData[i + 1], settings);
      output[i + 2] = mapLevelValue(sourceData[i + 2], settings);
      continue;
    }

    if (target === "r") {
      output[i] = mapLevelValue(sourceData[i], settings);
      continue;
    }

    if (target === "g") {
      output[i + 1] = mapLevelValue(sourceData[i + 1], settings);
      continue;
    }

    if (target === "b") {
      output[i + 2] = mapLevelValue(sourceData[i + 2], settings);
      continue;
    }

    if (target === "gray") {
      const mapped = mapLevelValue(sourceData[i], settings);
      output[i] = mapped;
      output[i + 1] = mapped;
      output[i + 2] = mapped;
      continue;
    }

    if (target === "a" && hasAlphaChannel) {
      output[i + 3] = mapLevelValue(sourceData[i + 3], settings);
    }
  }

  return output;
}
