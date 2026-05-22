export function setCanvasResolution(
  canvas: HTMLCanvasElement,
  width: number,
  height: number
): CanvasRenderingContext2D | null {
  canvas.width = width;
  canvas.height = height;

  try {
    return canvas.getContext("2d");
  } catch {
    return null;
  }
}

export function resetCanvasBackground(
  context: CanvasRenderingContext2D | null,
  width: number,
  height: number,
  color: string
): void {
  if (!context) {
    return;
  }

  context.fillStyle = color;
  context.fillRect(0, 0, width, height);
}

export function drawPreviewToWorkspace(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  workspaceWidth: number,
  workspaceHeight: number,
  backgroundColor: string
): void {
  const context = setCanvasResolution(canvas, workspaceWidth, workspaceHeight);
  if (!context) {
    return;
  }

  resetCanvasBackground(
    context,
    workspaceWidth,
    workspaceHeight,
    backgroundColor
  );

  const ratio = Math.min(
    workspaceWidth / sourceWidth,
    workspaceHeight / sourceHeight
  );
  const width = sourceWidth * ratio;
  const height = sourceHeight * ratio;
  const x = (workspaceWidth - width) / 2;
  const y = (workspaceHeight - height) / 2;

  context.drawImage(source, x, y, width, height);
}

export function createCanvasFromImageData(
  width: number,
  height: number,
  data: Uint8ClampedArray
): HTMLCanvasElement | null {
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempContext = tempCanvas.getContext("2d");
  if (!tempContext) {
    return null;
  }

  const imageData = new ImageData(new Uint8ClampedArray(data), width, height);
  tempContext.putImageData(imageData, 0, 0);

  return tempCanvas;
}
