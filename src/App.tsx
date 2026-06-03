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
import {
  applyLevelsToData,
  buildHistogram,
  HistogramScale,
  LevelsSettings,
  LevelsTarget,
} from "./core/levels";

const DEFAULT_LEVELS_SETTINGS: LevelsSettings = {
  inputBlack: 0,
  inputWhite: 255,
  gamma: 1,
};

type LevelsSettingsMap = Record<LevelsTarget, LevelsSettings>;

const createDefaultLevelsSettingsMap = (): LevelsSettingsMap => ({
  master: { ...DEFAULT_LEVELS_SETTINGS },
  r: { ...DEFAULT_LEVELS_SETTINGS },
  g: { ...DEFAULT_LEVELS_SETTINGS },
  b: { ...DEFAULT_LEVELS_SETTINGS },
  a: { ...DEFAULT_LEVELS_SETTINGS },
  gray: { ...DEFAULT_LEVELS_SETTINGS },
});

const cloneLevelsSettingsMap = (source: LevelsSettingsMap): LevelsSettingsMap => ({
  master: { ...source.master },
  r: { ...source.r },
  g: { ...source.g },
  b: { ...source.b },
  a: { ...source.a },
  gray: { ...source.gray },
});

const isDefaultLevelsSettings = (settings: LevelsSettings): boolean =>
  settings.inputBlack === DEFAULT_LEVELS_SETTINGS.inputBlack &&
  settings.inputWhite === DEFAULT_LEVELS_SETTINGS.inputWhite &&
  Math.abs(settings.gamma - DEFAULT_LEVELS_SETTINGS.gamma) < 0.0001;

const clampMidInputToRange = (midInput: number, black: number, white: number): number => {
  return Math.min(white - 1, Math.max(black + 1, midInput));
};

const gammaFromMidInput = (
  midInput: number,
  inputBlack: number,
  inputWhite: number
): number => {
  const range = Math.max(1, inputWhite - inputBlack);
  const normalizedMid =
    (clampMidInputToRange(midInput, inputBlack, inputWhite) - inputBlack) / range;
  const safeNormalizedMid = Math.min(0.9999, Math.max(0.0001, normalizedMid));
  return Math.min(9.99, Math.max(0.1, Math.log(0.5) / Math.log(safeNormalizedMid)));
};

const midInputFromGamma = (
  gamma: number,
  inputBlack: number,
  inputWhite: number
): number => {
  const safeGamma = Math.min(9.99, Math.max(0.1, gamma));
  const normalizedMid = Math.pow(0.5, 1 / safeGamma);
  const range = Math.max(1, inputWhite - inputBlack);
  return clampMidInputToRange(inputBlack + normalizedMid * range, inputBlack, inputWhite);
};

const relativeMidPositionFromGamma = (
  gamma: number,
  inputBlack: number,
  inputWhite: number
): number => {
  const range = Math.max(1, inputWhite - inputBlack);
  return (midInputFromGamma(gamma, inputBlack, inputWhite) - inputBlack) / range;
};

const midInputFromRelativePosition = (
  relativePosition: number,
  inputBlack: number,
  inputWhite: number
): number => {
  const range = Math.max(1, inputWhite - inputBlack);
  return clampMidInputToRange(
    inputBlack + relativePosition * range,
    inputBlack,
    inputWhite
  );
};

const normalizeLevelsSettings = (settings: LevelsSettings): LevelsSettings => {
  let inputBlack = Math.max(0, Math.min(253, Math.round(settings.inputBlack)));
  let inputWhite = Math.max(2, Math.min(255, Math.round(settings.inputWhite)));

  if (inputBlack > inputWhite - 2) {
    inputWhite = Math.min(255, inputBlack + 2);
  }
  if (inputBlack > inputWhite - 2) {
    inputBlack = Math.max(0, inputWhite - 2);
  }

  const gamma = Math.min(9.99, Math.max(0.1, settings.gamma));
  const midInput = midInputFromGamma(gamma, inputBlack, inputWhite);
  const safeGamma = gammaFromMidInput(midInput, inputBlack, inputWhite);

  return {
    inputBlack,
    inputWhite,
    gamma: safeGamma,
  };
};

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
  const levelsDialogRef = useRef<HTMLDialogElement | null>(null);
  const levelsHistogramCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const levelsPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
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
  const [levelsTarget, setLevelsTarget] = useState<LevelsTarget>("master");
  const [histogramScale, setHistogramScale] = useState<HistogramScale>("linear");
  const [levelsSettingsByTarget, setLevelsSettingsByTarget] = useState<LevelsSettingsMap>(
    createDefaultLevelsSettingsMap
  );
  const [levelsPreviewEnabled, setLevelsPreviewEnabled] = useState(true);
  const [levelsDialogOpen, setLevelsDialogOpen] = useState(false);
  const [levelsBaseImage, setLevelsBaseImage] = useState<EncodedImage | null>(null);
  const [levelsInitialSettingsByTarget, setLevelsInitialSettingsByTarget] =
    useState<LevelsSettingsMap | null>(null);

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

  const clearLevelsDialogSession = (): void => {
    setLevelsDialogOpen(false);
    setLevelsPreviewEnabled(true);
    setLevelsBaseImage(null);
    setLevelsInitialSettingsByTarget(null);
    levelsDialogRef.current?.close();
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

  const availableLevelsTargets = useMemo((): LevelsTarget[] => {
    const base = channelMode === "gray" ? (["master", "gray"] as LevelsTarget[]) : (["master", "r", "g", "b"] as LevelsTarget[]);
    if (hasAlphaChannel) {
      base.push("a");
    }
    return base;
  }, [channelMode, hasAlphaChannel]);

  useEffect(() => {
    if (!availableLevelsTargets.includes(levelsTarget)) {
      setLevelsTarget("master");
    }
  }, [availableLevelsTargets, levelsTarget]);

  const activeLevelsSettings = levelsSettingsByTarget[levelsTarget];
  const levelsMidInput = useMemo(() => {
    return midInputFromGamma(
      activeLevelsSettings.gamma,
      activeLevelsSettings.inputBlack,
      activeLevelsSettings.inputWhite
    );
  }, [activeLevelsSettings]);

  const applyLevelsSettingsMapToData = (
    sourceData: Uint8ClampedArray,
    settingsMap: LevelsSettingsMap
  ): Uint8ClampedArray => {
    const targets =
      channelMode === "gray"
        ? (["master", "gray", "a"] as LevelsTarget[])
        : (["master", "r", "g", "b", "a"] as LevelsTarget[]);

    let result: Uint8ClampedArray = new Uint8ClampedArray(sourceData);
    targets.forEach((target) => {
      if (target === "a" && !hasAlphaChannel) {
        return;
      }
      const settings = settingsMap[target];
      if (isDefaultLevelsSettings(settings)) {
        return;
      }
      result = applyLevelsToData(result, target, settings, hasAlphaChannel);
    });

    return result;
  };

  const levelsPreviewData = useMemo(() => {
    if (!levelsDialogOpen || !levelsBaseImage) {
      return null;
    }
    if (!levelsPreviewEnabled) {
      return new Uint8ClampedArray(levelsBaseImage.data);
    }
    return applyLevelsSettingsMapToData(levelsBaseImage.data, levelsSettingsByTarget);
  }, [
    levelsDialogOpen,
    levelsBaseImage,
    levelsPreviewEnabled,
    levelsSettingsByTarget,
    channelMode,
    hasAlphaChannel,
  ]);

  const levelsHistogram = useMemo(() => {
    const histogramSource =
      levelsDialogOpen && levelsBaseImage ? levelsBaseImage : currentImage;
    if (!histogramSource) {
      return null;
    }
    return buildHistogram(histogramSource.data, levelsTarget, {
      masterMode: channelMode === "gray" ? "gray" : "luminance",
    });
  }, [currentImage, levelsTarget, levelsDialogOpen, levelsBaseImage, channelMode]);

  useEffect(() => {
    const canvas = levelsHistogramCanvasRef.current;
    if (!canvas || !levelsHistogram) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#161a22";
    context.fillRect(0, 0, width, height);

    const maxCount = levelsHistogram.reduce((max, value) => Math.max(max, value), 0);
    if (maxCount <= 0) {
      return;
    }

    const histogramValues =
      histogramScale === "log"
        ? Array.from(levelsHistogram, (value) => Math.log1p(value))
        : Array.from(levelsHistogram);
    const maxDisplayValue = histogramValues.reduce(
      (max, value) => Math.max(max, value),
      0
    );
    if (maxDisplayValue <= 0) {
      return;
    }

    const barWidth = width / 256;
    context.fillStyle = "#89a9d3";
    for (let i = 0; i < 256; i += 1) {
      const normalized = histogramValues[i] / maxDisplayValue;
      const barHeight = Math.max(1, Math.round(normalized * (height - 2)));
      const x = i * barWidth;
      const y = height - barHeight;
      context.fillRect(x, y, Math.ceil(barWidth), barHeight);
    }
  }, [levelsHistogram, histogramScale]);

  useEffect(() => {
    const canvas = levelsPreviewCanvasRef.current;
    if (!canvas || !levelsBaseImage || !levelsPreviewData) {
      return;
    }

    const sourceCanvas = createCanvasFromImageData(
      levelsBaseImage.width,
      levelsBaseImage.height,
      levelsPreviewData
    );
    if (!sourceCanvas) {
      return;
    }

    const context = setCanvasResolution(canvas, canvas.width, canvas.height);
    if (!context) {
      return;
    }

    resetCanvasBackground(context, canvas.width, canvas.height, "#161a22");

    const ratio = Math.min(
      canvas.width / levelsBaseImage.width,
      canvas.height / levelsBaseImage.height
    );
    const drawWidth = levelsBaseImage.width * ratio;
    const drawHeight = levelsBaseImage.height * ratio;
    const offsetX = (canvas.width - drawWidth) / 2;
    const offsetY = (canvas.height - drawHeight) / 2;
    context.drawImage(sourceCanvas, offsetX, offsetY, drawWidth, drawHeight);
  }, [levelsBaseImage, levelsPreviewData]);

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
    clearLevelsDialogSession();
    setCanvasViewMode("native");
    resetChannelsForImage(decoded.hasMask, "gray");
    setLevelsSettingsByTarget(createDefaultLevelsSettingsMap());
    setLevelsTarget("master");

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
    clearLevelsDialogSession();
    setCanvasViewMode("workspace");
    resetChannelsForImage(decoded.hasMask, "rgb");
    setLevelsSettingsByTarget(createDefaultLevelsSettingsMap());
    setLevelsTarget("master");

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
        clearLevelsDialogSession();
        setLevelsSettingsByTarget(createDefaultLevelsSettingsMap());
        setLevelsTarget("master");

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
    clearLevelsDialogSession();
    setCanvasViewMode("native");
    resetChannelsForImage(decoded.hasMask, "gray");
    setLevelsSettingsByTarget(createDefaultLevelsSettingsMap());
    setLevelsTarget("master");

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

  const openLevelsDialog = (): void => {
    if (!currentImage) {
      alert("Сначала загрузите изображение");
      return;
    }
    setLevelsBaseImage({
      width: currentImage.width,
      height: currentImage.height,
      hasMask: currentImage.hasMask,
      data: new Uint8ClampedArray(currentImage.data),
    });
    setLevelsInitialSettingsByTarget(cloneLevelsSettingsMap(levelsSettingsByTarget));
    setLevelsPreviewEnabled(true);
    setLevelsDialogOpen(true);
    levelsDialogRef.current?.showModal();
  };

  const closeLevelsDialog = (): void => {
    clearLevelsDialogSession();
  };

  const handleLevelsDialogClick = (
    event: React.MouseEvent<HTMLDialogElement>
  ): void => {
    if (event.target === levelsDialogRef.current) {
      handleCancelLevels();
    }
  };

  const updateActiveLevelsSettings = (
    updater: (settings: LevelsSettings) => LevelsSettings
  ): void => {
    setLevelsSettingsByTarget((prev) => ({
      ...prev,
      [levelsTarget]: normalizeLevelsSettings(updater(prev[levelsTarget])),
    }));
  };

  const handleLevelsBlackChange = (value: number): void => {
    if (!Number.isFinite(value)) {
      return;
    }
    updateActiveLevelsSettings((prev) => {
      const inputWhite = prev.inputWhite;
      const inputBlack = Math.min(inputWhite - 2, Math.max(0, Math.round(value)));
      const relativeMid = relativeMidPositionFromGamma(
        prev.gamma,
        prev.inputBlack,
        prev.inputWhite
      );
      const midInput = midInputFromRelativePosition(
        relativeMid,
        inputBlack,
        inputWhite
      );
      const gamma = gammaFromMidInput(midInput, inputBlack, inputWhite);
      return { inputBlack, inputWhite, gamma };
    });
  };

  const handleLevelsWhiteChange = (value: number): void => {
    if (!Number.isFinite(value)) {
      return;
    }
    updateActiveLevelsSettings((prev) => {
      const inputBlack = prev.inputBlack;
      const inputWhite = Math.max(inputBlack + 2, Math.min(255, Math.round(value)));
      const relativeMid = relativeMidPositionFromGamma(
        prev.gamma,
        prev.inputBlack,
        prev.inputWhite
      );
      const midInput = midInputFromRelativePosition(
        relativeMid,
        inputBlack,
        inputWhite
      );
      const gamma = gammaFromMidInput(midInput, inputBlack, inputWhite);
      return { inputBlack, inputWhite, gamma };
    });
  };

  const handleLevelsGammaChange = (value: number): void => {
    if (!Number.isFinite(value)) {
      return;
    }
    updateActiveLevelsSettings((prev) => ({ ...prev, gamma: value }));
  };

  const handleLevelsMidInputChange = (value: number): void => {
    if (!Number.isFinite(value)) {
      return;
    }
    updateActiveLevelsSettings((prev) => {
      const midInput = clampMidInputToRange(
        value,
        prev.inputBlack,
        prev.inputWhite
      );
      const gamma = gammaFromMidInput(midInput, prev.inputBlack, prev.inputWhite);
      return {
        ...prev,
        gamma,
      };
    });
  };

  const handleApplyLevels = (): void => {
    if (!levelsBaseImage || !currentImage) {
      return;
    }
    const nextData = applyLevelsSettingsMapToData(
      levelsBaseImage.data,
      levelsSettingsByTarget
    );
    setCurrentImage({
      ...currentImage,
      data: nextData,
    });
    setPickedPixel(null);
    closeLevelsDialog();
    setLevelsSettingsByTarget(createDefaultLevelsSettingsMap());
    setLevelsTarget("master");
  };

  const handleResetLevels = (): void => {
    setLevelsSettingsByTarget(createDefaultLevelsSettingsMap());
  };

  const handleCancelLevels = (): void => {
    if (levelsBaseImage && currentImage) {
      setCurrentImage({
        ...currentImage,
        width: levelsBaseImage.width,
        height: levelsBaseImage.height,
        hasMask: levelsBaseImage.hasMask,
        data: new Uint8ClampedArray(levelsBaseImage.data),
      });
    }

    if (levelsInitialSettingsByTarget) {
      setLevelsSettingsByTarget(cloneLevelsSettingsMap(levelsInitialSettingsByTarget));
    }
    setPickedPixel(null);
    closeLevelsDialog();
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


  // ----- Пипетка -----
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
    const visibleAlpha = currentImage.data[pixelIndex + 3];
    if (visibleAlpha === 0) {
      setPickedPixel(null);
      return;
    }

    const r = currentImage.data[pixelIndex];
    const g = currentImage.data[pixelIndex + 1];
    const b = currentImage.data[pixelIndex + 2];
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

  const getLevelsTargetLabel = (target: LevelsTarget): string => {
    if (target === "master") {
      return "Master";
    }
    if (target === "r") {
      return "Red";
    }
    if (target === "g") {
      return "Green";
    }
    if (target === "b") {
      return "Blue";
    }
    if (target === "a") {
      return "Alpha";
    }
    return "Gray";
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
          <dialog
            ref={levelsDialogRef}
            className="Levels-dialog"
            onClick={handleLevelsDialogClick}
            onCancel={(event) => {
              event.preventDefault();
              handleCancelLevels();
            }}
          >
            <div className="Levels-header">
              <h3>Уровни</h3>
              <button
                className="Nav-buttons Levels-close"
                type="button"
                onClick={handleCancelLevels}
              >
                X
              </button>
            </div>

            <div className="Levels-layout">
              <div className="Levels-controls-column">
                <div className="Levels-controls-row">
                  <label>
                    Канал
                    <select
                      value={levelsTarget}
                      onChange={(event) =>
                        setLevelsTarget(event.target.value as LevelsTarget)
                      }
                    >
                      {availableLevelsTargets.map((target) => (
                        <option key={target} value={target}>
                          {getLevelsTargetLabel(target)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Масштаб
                    <select
                      value={histogramScale}
                      onChange={(event) =>
                        setHistogramScale(event.target.value as HistogramScale)
                      }
                    >
                      <option value="linear">Линейный</option>
                      <option value="log">Логарифмический</option>
                    </select>
                  </label>
                </div>

                <div className="Levels-histogram">
                  <canvas
                    ref={levelsHistogramCanvasRef}
                    width={512}
                    height={180}
                    aria-label="Гистограмма уровней"
                  />
                </div>

                <div className="Levels-input-markers">
                  <div className="Levels-markers-axis" />
                  <input
                    className="Levels-marker Levels-marker-black"
                    type="range"
                    min={0}
                    max={255}
                    step={1}
                    value={activeLevelsSettings.inputBlack}
                    onChange={(event) =>
                      handleLevelsBlackChange(event.target.valueAsNumber)
                    }
                    aria-label="Black input marker"
                  />
                  <input
                    className="Levels-marker Levels-marker-gamma"
                    type="range"
                    min={0}
                    max={255}
                    step="any"
                    value={levelsMidInput}
                    onChange={(event) =>
                      handleLevelsMidInputChange(event.target.valueAsNumber)
                    }
                    aria-label="Gamma input marker"
                  />
                  <input
                    className="Levels-marker Levels-marker-white"
                    type="range"
                    min={0}
                    max={255}
                    step={1}
                    value={activeLevelsSettings.inputWhite}
                    onChange={(event) =>
                      handleLevelsWhiteChange(event.target.valueAsNumber)
                    }
                    aria-label="White input marker"
                  />
                  <div className="Levels-input-markers-scale">
                    <span>0</span>
                    <span>255</span>
                  </div>
                </div>

                <div className="Levels-values-row">
                  <label>
                    Black
                    <input
                      type="number"
                      min={0}
                      max={activeLevelsSettings.inputWhite - 2}
                      step={1}
                      value={activeLevelsSettings.inputBlack}
                      onChange={(event) =>
                        handleLevelsBlackChange(event.target.valueAsNumber)
                      }
                    />
                  </label>
                  <label>
                    Gamma
                    <input
                      type="number"
                      min={0.1}
                      max={9.99}
                      step={0.01}
                      value={Number(activeLevelsSettings.gamma.toFixed(2))}
                      onChange={(event) =>
                        handleLevelsGammaChange(event.target.valueAsNumber)
                      }
                    />
                  </label>
                  <label>
                    White
                    <input
                      type="number"
                      min={activeLevelsSettings.inputBlack + 2}
                      max={255}
                      step={1}
                      value={activeLevelsSettings.inputWhite}
                      onChange={(event) =>
                        handleLevelsWhiteChange(event.target.valueAsNumber)
                      }
                    />
                  </label>
                </div>

                <div className="Levels-actions">
                  <button className="Nav-buttons" type="button" onClick={handleApplyLevels}>
                    Применить
                  </button>
                  <button
                    className="Nav-buttons"
                    type="button"
                    onClick={handleResetLevels}
                  >
                    Сброс
                  </button>
                  <button className="Nav-buttons" type="button" onClick={handleCancelLevels}>
                    Отмена
                  </button>
                </div>
              </div>

              <div className="Levels-preview-column">
                <label className="Levels-preview-toggle">
                  <input
                    type="checkbox"
                    checked={levelsPreviewEnabled}
                    onChange={(event) => setLevelsPreviewEnabled(event.target.checked)}
                  />
                  Предпросмотр
                </label>

                <div className="Levels-preview-mini">
                  <canvas
                    ref={levelsPreviewCanvasRef}
                    width={320}
                    height={180}
                    aria-label="Миниатюра предпросмотра уровней"
                  />
                </div>
              </div>
            </div>
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
                <button type="button" className="Tool-tile" onClick={openLevelsDialog}>
                  Уровни
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
