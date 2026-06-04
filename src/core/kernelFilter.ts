export type KernelPaddingMode = "black" | "white" | "copy";
export type KernelFilterChannel = "r" | "g" | "b" | "a";
export type FilterOperation = "kernel" | "median3x3";

export type KernelPresetId =
  | "identity"
  | "sharpen"
  | "gaussian3x3"
  | "boxBlur"
  | "prewittHorizontal"
  | "prewittVertical";

export type KernelPreset = {
  id: KernelPresetId;
  label: string;
  values: number[];
};

export type KernelFilterOptions = {
  channels: KernelFilterChannel[];
  padding: KernelPaddingMode;
  rowsPerChunk?: number;
  signal?: AbortSignal;
};

const CHANNEL_INDEX: Record<KernelFilterChannel, number> = {
  r: 0,
  g: 1,
  b: 2,
  a: 3,
};

export const KERNEL_PRESETS: KernelPreset[] = [
  {
    id: "identity",
    label: "Тождественное отображение",
    values: [0, 0, 0, 0, 1, 0, 0, 0, 0],
  },
  {
    id: "sharpen",
    label: "Повышение резкости",
    values: [0, -1, 0, -1, 5, -1, 0, -1, 0],
  },
  {
    id: "gaussian3x3",
    label: "Фильтр Гаусса (3x3)",
    values: [
      1 / 16, 2 / 16, 1 / 16,
      2 / 16, 4 / 16, 2 / 16,
      1 / 16, 2 / 16, 1 / 16,
    ],
  },
  {
    id: "boxBlur",
    label: "Прямоугольное размытие",
    values: [
      1 / 9, 1 / 9, 1 / 9,
      1 / 9, 1 / 9, 1 / 9,
      1 / 9, 1 / 9, 1 / 9,
    ],
  },
  {
    id: "prewittHorizontal",
    label: "Прюитт горизонтальный",
    values: [-1, -1, -1, 0, 0, 0, 1, 1, 1],
  },
  {
    id: "prewittVertical",
    label: "Прюитт вертикальный",
    values: [-1, 0, 1, -1, 0, 1, -1, 0, 1],
  },
];

export function getKernelPreset(id: KernelPresetId): KernelPreset {
  return KERNEL_PRESETS.find((preset) => preset.id === id) ?? KERNEL_PRESETS[0];
}

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function normalizeKernel(kernel: number[]): number[] {
  if (kernel.length !== 9) {
    throw new Error("Kernel must contain exactly 9 values");
  }
  if (!kernel.every(Number.isFinite)) {
    throw new Error("Kernel values must be finite numbers");
  }
  return kernel;
}

function getPaddedChannelValue(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  channelIndex: number,
  padding: KernelPaddingMode
): number {
  if (x >= 0 && y >= 0 && x < width && y < height) {
    return sourceData[(y * width + x) * 4 + channelIndex];
  }

  if (padding === "black") {
    return 0;
  }
  if (padding === "white") {
    return 255;
  }

  const safeX = Math.min(width - 1, Math.max(0, x));
  const safeY = Math.min(height - 1, Math.max(0, y));
  return sourceData[(safeY * width + safeX) * 4 + channelIndex];
}

function waitForNextChunk(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export async function applyKernelFilterAsync(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  kernel: number[],
  options: KernelFilterOptions
): Promise<Uint8ClampedArray> {
  const safeWidth = Math.round(width);
  const safeHeight = Math.round(height);
  const safeKernel = normalizeKernel(kernel);
  const selectedChannelIndexes = new Set(
    options.channels.map((channel) => CHANNEL_INDEX[channel])
  );
  const rowsPerChunk = Math.max(1, Math.round(options.rowsPerChunk ?? 24));

  if (safeWidth <= 0 || safeHeight <= 0) {
    throw new Error("Image dimensions must be positive");
  }
  if (sourceData.length < safeWidth * safeHeight * 4) {
    throw new Error("Source data is smaller than image dimensions require");
  }

  const output = new Uint8ClampedArray(sourceData);

  for (let y = 0; y < safeHeight; y += 1) {
    if (options.signal?.aborted) {
      throw new DOMException("Kernel filtering aborted", "AbortError");
    }

    for (let x = 0; x < safeWidth; x += 1) {
      const outputOffset = (y * safeWidth + x) * 4;

      for (let channelIndex = 0; channelIndex < 4; channelIndex += 1) {
        if (!selectedChannelIndexes.has(channelIndex)) {
          continue;
        }

        let value = 0;
        for (let kernelY = 0; kernelY < 3; kernelY += 1) {
          for (let kernelX = 0; kernelX < 3; kernelX += 1) {
            const sourceX = x + kernelX - 1;
            const sourceY = y + kernelY - 1;
            const kernelValue = safeKernel[kernelY * 3 + kernelX];
            value +=
              getPaddedChannelValue(
                sourceData,
                safeWidth,
                safeHeight,
                sourceX,
                sourceY,
                channelIndex,
                options.padding
              ) * kernelValue;
          }
        }

        output[outputOffset + channelIndex] = clampByte(value);
      }
    }

    if ((y + 1) % rowsPerChunk === 0) {
      await waitForNextChunk();
    }
  }

  return output;
}

export async function applyMedianFilterAsync(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  options: KernelFilterOptions
): Promise<Uint8ClampedArray> {
  const safeWidth = Math.round(width);
  const safeHeight = Math.round(height);
  const selectedChannelIndexes = new Set(
    options.channels.map((channel) => CHANNEL_INDEX[channel])
  );
  const rowsPerChunk = Math.max(1, Math.round(options.rowsPerChunk ?? 24));

  if (safeWidth <= 0 || safeHeight <= 0) {
    throw new Error("Image dimensions must be positive");
  }
  if (sourceData.length < safeWidth * safeHeight * 4) {
    throw new Error("Source data is smaller than image dimensions require");
  }

  const output = new Uint8ClampedArray(sourceData);

  for (let y = 0; y < safeHeight; y += 1) {
    if (options.signal?.aborted) {
      throw new DOMException("Median filtering aborted", "AbortError");
    }

    for (let x = 0; x < safeWidth; x += 1) {
      const outputOffset = (y * safeWidth + x) * 4;

      for (let channelIndex = 0; channelIndex < 4; channelIndex += 1) {
        if (!selectedChannelIndexes.has(channelIndex)) {
          continue;
        }

        const values: number[] = [];
        for (let kernelY = 0; kernelY < 3; kernelY += 1) {
          for (let kernelX = 0; kernelX < 3; kernelX += 1) {
            values.push(
              getPaddedChannelValue(
                sourceData,
                safeWidth,
                safeHeight,
                x + kernelX - 1,
                y + kernelY - 1,
                channelIndex,
                options.padding
              )
            );
          }
        }

        values.sort((a, b) => a - b);
        output[outputOffset + channelIndex] = values[4];
      }
    }

    if ((y + 1) % rowsPerChunk === 0) {
      await waitForNextChunk();
    }
  }

  return output;
}
