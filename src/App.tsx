import { useMemo, useState, useEffect, useRef } from "react";
import "./App.css";
import { DecodedImage, decodeGB7 } from "./formats/gb7Decoder";
import { EncodedImage, encodeGB7 } from "./formats/gb7Encoder";
import { CANVAS_BG, CANVAS_HEIGHT, CANVAS_WIDTH } from "./core/constants";
import { LoadedImageInfo } from "./core/imageModel";
import { detectImageColorInfo } from "./core/colorDepth";
import {
  createCanvasFromImageData,
  drawPreviewToWorkspace,
  resetCanvasBackground,
  setCanvasResolution,
} from "./canvas/canvasUtils";
import {
  applyChannelVisibility,
  ChannelMode,
  ChannelKey,
  ChannelVisibility,
  createChannelThumbnail,
  DEFAULT_CHANNEL_VISIBILITY,
} from "./canvas/channelPreview";
import { rgbToCielab } from "./core/cielab";

function App() {
  type CanvasViewMode = "workspace" | "native";
  type ToolKey = "none" | "eyedropper";
  type PickedPixel = {
    x: number;
    y: number;
    r: number;
    g: number;
    b: number;
    l: number;
    labA: number;
    labB: number;
  };

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [currentImage, setCurrentImage] = useState<EncodedImage | null>(null);
  const [pendingGb7Image, setPendingGb7Image] = useState<DecodedImage | null>(null);
  const [loadedImageInfo, setLoadedImageInfo] = useState<LoadedImageInfo | null>(null);
  const [canvasViewMode, setCanvasViewMode] = useState<CanvasViewMode>("workspace");
  const [hasAlphaChannel, setHasAlphaChannel] = useState(false);
  const [channelMode, setChannelMode] = useState<ChannelMode>("rgb");
  const [channelVisibility, setChannelVisibility] = useState<ChannelVisibility>(
    DEFAULT_CHANNEL_VISIBILITY
  );
  const [channelThumbnails, setChannelThumbnails] = useState<
    Partial<Record<ChannelKey, string>>
  >({});
  const [activeTool, setActiveTool] = useState<ToolKey>("none");
  const [pickedPixel, setPickedPixel] = useState<PickedPixel | null>(null);

  const hasTransparentPixels = (data: Uint8ClampedArray): boolean => {
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) {
        return true;
      }
    }
    return false;
  };

  const resetChannelsForImage = (
    alphaAvailable: boolean,
    mode: ChannelMode
  ): void => {
    setHasAlphaChannel(alphaAvailable);
    setChannelMode(mode);
    setChannelVisibility({ ...DEFAULT_CHANNEL_VISIBILITY });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = setCanvasResolution(canvas, CANVAS_WIDTH, CANVAS_HEIGHT);
    resetCanvasBackground(context, CANVAS_WIDTH, CANVAS_HEIGHT, CANVAS_BG);
  }, []);

  const visibleImageData = useMemo(() => {
    if (!currentImage) {
      return null;
    }

    return applyChannelVisibility(
      currentImage.data,
      channelVisibility,
      hasAlphaChannel,
      channelMode
    );
  }, [currentImage, channelVisibility, hasAlphaChannel, channelMode]);

  useEffect(() => {
    if (!currentImage) {
      setChannelThumbnails({});
      return;
    }

    const thumbnails: Partial<Record<ChannelKey, string>> = {};
    const baseChannels: ChannelKey[] =
      channelMode === "gray" ? ["gray"] : ["r", "g", "b"];

    baseChannels.forEach((channel) => {
      const thumb = createChannelThumbnail(
        currentImage.data,
        currentImage.width,
        currentImage.height,
        channel
      );
      if (thumb) {
        thumbnails[channel] = thumb;
      }
    });

    if (hasAlphaChannel) {
      const alphaThumb = createChannelThumbnail(
        currentImage.data,
        currentImage.width,
        currentImage.height,
        "a"
      );
      if (alphaThumb) {
        thumbnails.a = alphaThumb;
      }
    }

    setChannelThumbnails(thumbnails);
  }, [currentImage, hasAlphaChannel, channelMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !currentImage) {
      return;
    }

    const visibleData = visibleImageData;
    if (!visibleData) {
      return;
    }
    const sourceCanvas = createCanvasFromImageData(
      currentImage.width,
      currentImage.height,
      visibleData
    );
    if (!sourceCanvas) {
      return;
    }

    if (canvasViewMode === "native") {
      const context = setCanvasResolution(
        canvas,
        currentImage.width,
        currentImage.height
      );
      if (!context) {
        return;
      }

      context.clearRect(0, 0, currentImage.width, currentImage.height);
      context.drawImage(sourceCanvas, 0, 0);
      return;
    }

    drawPreviewToWorkspace(
      canvas,
      sourceCanvas,
      currentImage.width,
      currentImage.height,
      CANVAS_WIDTH,
      CANVAS_HEIGHT,
      CANVAS_BG
    );
  }, [currentImage, canvasViewMode, visibleImageData]);

  const handleUpload = (): void => {
    fileInputRef.current?.click();
  };

  const loadGb7AsNative = (decoded: DecodedImage): void => {
    setCanvasViewMode("native");
    resetChannelsForImage(decoded.hasMask, "gray");

    setCurrentImage({
      width: decoded.width,
      height: decoded.height,
      data: new Uint8ClampedArray(decoded.data),
      hasMask: decoded.hasMask,
    });
    setLoadedImageInfo({
      width: decoded.width,
      height: decoded.height,
      colorDepthBits: decoded.colorDepth,
    });
    setPickedPixel(null);
  };

  const loadGb7AsRgba = (decoded: DecodedImage): void => {
    setCanvasViewMode("workspace");
    resetChannelsForImage(decoded.hasMask, "rgb");

    setCurrentImage({
      width: decoded.width,
      height: decoded.height,
      data: new Uint8ClampedArray(decoded.data),
      hasMask: decoded.hasMask,
    });
    setLoadedImageInfo({
      width: decoded.width,
      height: decoded.height,
      colorDepthBits: decoded.hasMask ? 32 : 24,
    });
    setPickedPixel(null);
  };

  const gb7ImportDialogRef = useRef<HTMLDialogElement | null>(null);

  const closeGb7ImportDialog = (): void => {
    gb7ImportDialogRef.current?.close();
    setPendingGb7Image(null);
  };

  const handleKeepGb7 = (): void => {
    if (!pendingGb7Image) {
      return;
    }

    loadGb7AsNative(pendingGb7Image);
    closeGb7ImportDialog();
  };

  const handleConvertGb7ToRgba = (): void => {
    if (!pendingGb7Image) {
      return;
    }

    loadGb7AsRgba(pendingGb7Image);
    closeGb7ImportDialog();
  };

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const fileName = file.name.toLowerCase();

    if (fileName.endsWith(".gb7")) {
      const buffer = await file.arrayBuffer();
      const decoded = decodeGB7(buffer);
      setPendingGb7Image(decoded);
      gb7ImportDialogRef.current?.showModal();
      event.target.value = "";
      
      return;
    }

    if (
      file.type === "image/png" ||
      file.type === "image/jpeg" ||
      fileName.endsWith(".png") ||
      fileName.endsWith(".jpg") ||
      fileName.endsWith(".jpeg")
    ) {
      const detectedColorInfo = await detectImageColorInfo(file, fileName);
      const imageUrl = URL.createObjectURL(file);
      const image = new Image();

      image.onload = (): void => {
        const sourceCanvas = document.createElement("canvas");
        sourceCanvas.width = image.width;
        sourceCanvas.height = image.height;
        const sourceContext = sourceCanvas.getContext("2d");
        if (!sourceContext) {
          URL.revokeObjectURL(imageUrl);
          return;
        }

        sourceContext.clearRect(0, 0, image.width, image.height);
        sourceContext.drawImage(image, 0, 0);

        const originalData = sourceContext.getImageData(
          0,
          0,
          image.width,
          image.height
        );
        const alphaInPixels = hasTransparentPixels(originalData.data);
        const effectiveHasAlpha =
          detectedColorInfo.hasAlphaChannel || alphaInPixels;
        const effectiveColorDepth = effectiveHasAlpha
          ? Math.max(detectedColorInfo.colorDepthBits, 32)
          : detectedColorInfo.colorDepthBits;

        setCanvasViewMode("workspace");
        resetChannelsForImage(effectiveHasAlpha, "rgb");

        setLoadedImageInfo({
          width: image.width,
          height: image.height,
          colorDepthBits: effectiveColorDepth,
        });
        setCurrentImage({
          width: image.width,
          height: image.height,
          data: originalData.data,
          hasMask: effectiveHasAlpha,
        });
        setPickedPixel(null);

        URL.revokeObjectURL(imageUrl);
      };

      image.onerror = (): void => {
        URL.revokeObjectURL(imageUrl);
        alert("Не удалось загрузить изображение");
      };

      image.src = imageUrl;
      event.target.value = "";

      return;
    }

    alert("Неподдерживаемый формат файла");
    event.target.value = "";
  };

  const saveImage = (): void => {
    if (!currentImage) {
      return;
    }

    const exportCanvas = createCanvasFromImageData(
      currentImage.width,
      currentImage.height,
      currentImage.data
    );
    if (!exportCanvas) {
      return;
    }

    const link = document.createElement("a");
    link.download = "edited_image.png";
    link.href = exportCanvas.toDataURL("image/png");
    link.click();
  };

  const handleDownloadJPG = (): void => {
    if (!currentImage) {
      return;
    }

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = currentImage.width;
    exportCanvas.height = currentImage.height;
    const exportContext = exportCanvas.getContext("2d");
    if (!exportContext) {
      return;
    }

    exportContext.fillStyle = "#ffffff";
    exportContext.fillRect(0, 0, currentImage.width, currentImage.height);

    const sourceCanvas = createCanvasFromImageData(
      currentImage.width,
      currentImage.height,
      currentImage.data
    );
    if (!sourceCanvas) {
      return;
    }

    exportContext.drawImage(sourceCanvas, 0, 0);

    const link = document.createElement("a");
    link.download = "image.jpg";
    link.href = exportCanvas.toDataURL("image/jpeg", 0.92);
    link.click();
  };

  const handleDownloadGB7 = (): void => {
    if (!currentImage) {
      alert("Сначала загрузите изображение");
      return;
    }

    const buffer = encodeGB7(currentImage);

    const blob = new Blob([buffer], {
      type: "application/octet-stream",
    });

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = "image.gb7";
    link.click();

    const decoded = decodeGB7(buffer);
    setCanvasViewMode("native");
    resetChannelsForImage(decoded.hasMask, "gray");

    setCurrentImage({
      width: decoded.width,
      height: decoded.height,
      data: decoded.data,
      hasMask: decoded.hasMask,
    });
    setLoadedImageInfo({
      width: decoded.width,
      height: decoded.height,
      colorDepthBits: decoded.colorDepth,
    });
    setPickedPixel(null);
    URL.revokeObjectURL(url);
  };

  const dialogRef = useRef<HTMLDialogElement | null>(null);

  const openDialog = (): void => {
    dialogRef.current?.showModal();
  };

  const closeDialog = (): void => {
    dialogRef.current?.close();
  };

  const handleDialogClick = (event: React.MouseEvent<HTMLDialogElement>): void => {
    if (event.target === dialogRef.current) {
      dialogRef.current?.close();
    }
  };

  const toggleChannelVisibility = (channel: ChannelKey): void => {
    if (channel === "a" && !hasAlphaChannel) {
      return;
    }
    if (
      (channelMode === "gray" && (channel === "r" || channel === "g" || channel === "b")) ||
      (channelMode === "rgb" && channel === "gray")
    ) {
      return;
    }

    setChannelVisibility((prev) => ({
      ...prev,
      [channel]: !prev[channel],
    }));
  };

  const getImagePointFromCanvasClick = (
    event: React.MouseEvent<HTMLCanvasElement>
  ): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas || !currentImage) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const canvasX = (event.clientX - rect.left) * (canvas.width / rect.width);
    const canvasY = (event.clientY - rect.top) * (canvas.height / rect.height);

    if (canvasViewMode === "native") {
      const x = Math.floor(canvasX);
      const y = Math.floor(canvasY);
      if (x < 0 || y < 0 || x >= currentImage.width || y >= currentImage.height) {
        return null;
      }
      return { x, y };
    }

    const ratio = Math.min(
      CANVAS_WIDTH / currentImage.width,
      CANVAS_HEIGHT / currentImage.height
    );
    const drawWidth = currentImage.width * ratio;
    const drawHeight = currentImage.height * ratio;
    const offsetX = (CANVAS_WIDTH - drawWidth) / 2;
    const offsetY = (CANVAS_HEIGHT - drawHeight) / 2;

    if (
      canvasX < offsetX ||
      canvasY < offsetY ||
      canvasX >= offsetX + drawWidth ||
      canvasY >= offsetY + drawHeight
    ) {
      return null;
    }

    const x = Math.floor((canvasX - offsetX) / ratio);
    const y = Math.floor((canvasY - offsetY) / ratio);

    if (x < 0 || y < 0 || x >= currentImage.width || y >= currentImage.height) {
      return null;
    }

    return { x, y };
  };

  const handleCanvasMouseDown = (
    event: React.MouseEvent<HTMLCanvasElement>
  ): void => {
    if (activeTool !== "eyedropper" || event.button !== 0 || !currentImage || !visibleImageData) {
      return;
    }

    const point = getImagePointFromCanvasClick(event);
    if (!point) {
      return;
    }

    const pixelIndex = (point.y * currentImage.width + point.x) * 4;
    const r = visibleImageData[pixelIndex];
    const g = visibleImageData[pixelIndex + 1];
    const b = visibleImageData[pixelIndex + 2];
    const lab = rgbToCielab(r, g, b);

    setPickedPixel({
      x: point.x,
      y: point.y,
      r,
      g,
      b,
      l: lab.l,
      labA: lab.a,
      labB: lab.b,
    });
  };

  return (
    <div className="App">
      <main className="App-main">
        <aside className="Left-panel">
          <nav className="Upload-menu">
            <ul>
              <li>
                <details open>
                  <summary>Файл</summary>

                  <div className="Column">
                    <input
                      ref={fileInputRef}
                      className="HiddenInput"
                      type="file"
                      accept=".gb7,image/png,image/jpeg"
                      onChange={handleFileUpload}
                    />

                    <button
                      className="Nav-buttons"
                      type="button"
                      onClick={handleUpload}
                    >
                      Загрузить изображение
                    </button>

                    <button
                      className="Nav-buttons"
                      type="button"
                      onClick={openDialog}
                    >
                      Экспортировать как...
                    </button>
                  </div>
                </details>
              </li>
            </ul>
          </nav>

          <dialog
            ref={dialogRef}
            className="Export-dialog"
            onClick={handleDialogClick}
          >
            <p>В каком формате сохранить изображение?</p>
            <button
              className="Nav-buttons"
              type="button"
              onClick={saveImage}
            >
              PNG
            </button>
            <button
              className="Nav-buttons"
              type="button"
              onClick={handleDownloadGB7}
            >
              GB7
            </button>
            <button
              className="Nav-buttons"
              type="button"
              onClick={handleDownloadJPG}
            >
              JPG
            </button>
            <button
              className="Nav-buttons"
              type="button"
              onClick={closeDialog}
            >
              Закрыть
            </button>
          </dialog>
          <dialog
            ref={gb7ImportDialogRef}
            className="Import-dialog"
            onClick={(event) => {
              if (event.target === gb7ImportDialogRef.current) {
                closeGb7ImportDialog();
              }
            }}
          >
            <p>Как загрузить GB7?</p>
            <button
              className="Nav-buttons"
              type="button"
              onClick={handleConvertGb7ToRgba}
            >
              Конвертировать в RGBA
            </button>
            <button
              className="Nav-buttons"
              type="button"
              onClick={handleKeepGb7}
            >
              Оставить GB7
            </button>
            <button
              className="Nav-buttons"
              type="button"
              onClick={closeGb7ImportDialog}
            >
              Отмена
            </button>
          </dialog>

          <section className="Future-tools">
            <div className="Tools-panel">
              <h4>Инструменты</h4>
              <div className="Tools-grid">
                <button
                  type="button"
                  className={`Tool-tile ${activeTool === "eyedropper" ? "tool-active" : ""}`}
                  onClick={() =>
                    setActiveTool((prev) => (prev === "eyedropper" ? "none" : "eyedropper"))
                  }
                >
                  Пипетка
                </button>
                <button type="button" className="Tool-tile Tool-tile-placeholder" disabled>
                  Скоро
                </button>
                <button type="button" className="Tool-tile Tool-tile-placeholder" disabled>
                  Скоро
                </button>
                <button type="button" className="Tool-tile Tool-tile-placeholder" disabled>
                  Скоро
                </button>
              </div>
            </div>

            <div className="Channels-panel">
              <h4>Каналы</h4>
              <div className="Channels-list">
                {(channelMode === "gray" ? (["gray"] as ChannelKey[]) : (["r", "g", "b"] as ChannelKey[])).map((channel) => (
                  <button
                    key={channel}
                    type="button"
                    className={`Channel-card ${channelVisibility[channel] ? "active" : ""}`}
                    onClick={() => toggleChannelVisibility(channel)}
                  >
                    <span className="Channel-name">
                      {channel === "gray" ? "Gray" : channel.toUpperCase()}
                    </span>
                    {channelThumbnails[channel] ? (
                      <img
                        className="Channel-thumb"
                        src={channelThumbnails[channel] as string}
                        alt={`${channel === "gray" ? "Gray" : channel.toUpperCase()} channel preview`}
                      />
                    ) : (
                      <span className="Channel-thumb-placeholder">Нет данных</span>
                    )}
                  </button>
                ))}

                {hasAlphaChannel && (
                  <button
                    type="button"
                    className={`Channel-card ${channelVisibility.a ? "active" : ""}`}
                    onClick={() => toggleChannelVisibility("a")}
                  >
                    <span className="Channel-name">A</span>
                    {channelThumbnails.a ? (
                      <img
                        className="Channel-thumb"
                        src={channelThumbnails.a}
                        alt="Alpha channel preview"
                      />
                    ) : (
                      <span className="Channel-thumb-placeholder">Нет данных</span>
                    )}
                  </button>
                )}
              </div>
              <p className="Channels-help">
                Нажмите на канал, чтобы включить или выключить его отображение на канвасе.
              </p>
            </div>
          </section>
        </aside>

        <section className="Canvas-workspace">
          <div className="canvas-container">
            <canvas
              ref={canvasRef}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              id="myCanvas"
              onMouseDown={handleCanvasMouseDown}
              className={activeTool === "eyedropper" ? "eyedropper-active" : ""}
            >
              Your browser does not support the HTML canvas tag.
            </canvas>
          </div>
          <div className="canvas-info">
            <span>
              Глубина цвета:{" "}
              {loadedImageInfo ? `${loadedImageInfo.colorDepthBits} бит` : "—"}
            </span>
            <span>
              Разрешение:{" "}
              {loadedImageInfo
                ? `${loadedImageInfo.width} x ${loadedImageInfo.height}`
                : "—"}
            </span>
            <span>
              Пипетка:{" "}
              {pickedPixel
                ? `X:${pickedPixel.x}, Y:${pickedPixel.y} | RGB(${pickedPixel.r}, ${pickedPixel.g}, ${pickedPixel.b}) | LAB(${pickedPixel.l.toFixed(2)}, ${pickedPixel.labA.toFixed(2)}, ${pickedPixel.labB.toFixed(2)})`
                : "—"}
            </span>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
