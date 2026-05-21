import { useState, useEffect, useRef } from "react";
import "./App.css";
import { DecodedImage } from "./formats/gb7Decoder";
import { EncodedImage } from "./formats/gb7Encoder";
import { decodeGB7 } from "./formats/gb7Decoder";
import { encodeGB7 } from "./formats/gb7Encoder";
import { CANVAS_BG, CANVAS_HEIGHT, CANVAS_WIDTH } from "./core/constants";
import { LoadedImageInfo } from "./core/imageModel";
import { detectImageColorDepthBits } from "./core/colorDepth";
import {
  createCanvasFromImageData,
  drawPreviewToWorkspace,
  resetCanvasBackground,
  setCanvasResolution,
} from "./canvas/canvasUtils";
import { drawImageToCanvas } from "./canvas/drawImageToCanvas";

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [currentImage, setCurrentImage] = useState<EncodedImage | null>(null);
  const [pendingGb7Image, setPendingGb7Image] = useState<DecodedImage | null>(null);
  const [loadedImageInfo, setLoadedImageInfo] = useState<LoadedImageInfo | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = setCanvasResolution(canvas, CANVAS_WIDTH, CANVAS_HEIGHT);
    resetCanvasBackground(context, CANVAS_WIDTH, CANVAS_HEIGHT, CANVAS_BG);
  }, []);

  const handleUpload = (): void => {
    fileInputRef.current?.click();
  };

  const loadGb7AsNative = (decoded: DecodedImage): void => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    drawImageToCanvas(canvas, decoded);

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
  };

  const loadGb7AsRgba = (decoded: DecodedImage): void => {
    const sourceCanvas = createCanvasFromImageData(
      decoded.width,
      decoded.height,
      decoded.data
    );
    if (!sourceCanvas) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    drawPreviewToWorkspace(
      canvas,
      sourceCanvas,
      decoded.width,
      decoded.height,
      CANVAS_WIDTH,
      CANVAS_HEIGHT,
      CANVAS_BG
    );

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
      const detectedColorDepthBits = await detectImageColorDepthBits(file, fileName);
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

        const canvas = canvasRef.current;
        if (!canvas) {
          URL.revokeObjectURL(imageUrl);
          return;
        }

        drawPreviewToWorkspace(
          canvas,
          sourceCanvas,
          image.width,
          image.height,
          CANVAS_WIDTH,
          CANVAS_HEIGHT,
          CANVAS_BG
        );

        const originalData = sourceContext.getImageData(
          0,
          0,
          image.width,
          image.height
        );
        const isPng = file.type === "image/png" || fileName.endsWith(".png");

        setLoadedImageInfo({
          width: image.width,
          height: image.height,
          colorDepthBits: detectedColorDepthBits,
        });
        setCurrentImage({
          width: image.width,
          height: image.height,
          data: originalData.data,
          hasMask: isPng,
        });

        URL.revokeObjectURL(imageUrl);
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

    setCurrentImage({
      width: decoded.width,
      height: decoded.height,
      data: decoded.data,
      hasMask: decoded.hasMask,
    });
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

          <dialog ref={dialogRef} onClick={handleDialogClick}>
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
            <h3>Инструменты</h3>
            {/* <div className="Future-tools-body">
              Будущие элементы управления будут добавлены сюда
            </div> */}
          </section>
        </aside>

        <section className="Canvas-workspace">
          <div className="canvas-container">
            <canvas
              ref={canvasRef}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              id="myCanvas"
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
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
