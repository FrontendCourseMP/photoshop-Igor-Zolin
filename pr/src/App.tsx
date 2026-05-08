import { useState, useEffect, useRef } from "react";
import "./App.css";
import { DecodedImage } from "./formats/gb7Decoder";
import { EncodedImage } from "./formats/gb7Encoder";
import { decodeGB7 } from "./formats/gb7Decoder";
import { encodeGB7 } from "./formats/gb7Encoder";

const CANVAS_WIDTH = 1500;
const CANVAS_HEIGHT = 1000;
const CANVAS_BG = "#282c34";

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  type AppImage = {
    width: number;
    height: number;
    data: Uint8ClampedArray;
    hasMask?: boolean;
  };
  const [currentImage, setCurrentImage] = useState<EncodedImage | null>(null);
    
  const getContext = (): CanvasRenderingContext2D | null => {
    const canvas = canvasRef.current;

    if (!canvas || process.env.NODE_ENV === "test") {
      return null;
    }

    try {
      return canvas.getContext("2d");
    } catch {
      return null;
    }
  };

  const resetCanvasBackground = (
    context: CanvasRenderingContext2D | null
  ): void => {
    if (!context) {
      return;
    }

    context.fillStyle = CANVAS_BG;
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  };

  useEffect(() => {
    const context = getContext();
    resetCanvasBackground(context);
  }, []);

  const handleUpload = (): void => {
    fileInputRef.current?.click();
  };

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    const file = event.target.files?.[0];
    const canvas = canvasRef.current;
    const context = getContext();

    if (!file || !canvas || !context) {
      return;
    }

    const fileName = file.name.toLowerCase();

    if (fileName.endsWith(".gb7")) {
      const buffer = await file.arrayBuffer();

      const decoded = decodeGB7(buffer);

      canvas.width = decoded.width;
      canvas.height = decoded.height;

      const imageData = new ImageData(
        new Uint8ClampedArray(decoded.data),
        decoded.width,
        decoded.height
      );

      context.putImageData(imageData, 0, 0);

      setCurrentImage({
        width: canvas.width,
        height: canvas.height,
        data: imageData.data,
        hasMask: true,
      });
      
      return;
    }

    if (
      file.type === "image/png" ||
      file.type === "image/jpeg" ||
      fileName.endsWith(".png") ||
      fileName.endsWith(".jpg") ||
      fileName.endsWith(".jpeg")
    ) {
      const imageUrl = URL.createObjectURL(file);
      const image = new Image();

      image.onload = (): void => {
        const ratio = Math.min(
          CANVAS_WIDTH / image.width,
          CANVAS_HEIGHT / image.height
        );

        const width = image.width * ratio;
        const height = image.height * ratio;
        const x = (CANVAS_WIDTH - width) / 2;
        const y = (CANVAS_HEIGHT - height) / 2;

        resetCanvasBackground(context);
        context.drawImage(image, x, y, width, height);
        
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

        URL.revokeObjectURL(imageUrl);
      };

      image.src = imageUrl;

      return;
    }

    alert("Неподдерживаемый формат файла");
  };

  const saveImage = (): void => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const link = document.createElement("a");
    link.download = "edited_image.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const handleDownloadJPG = (): void => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const link = document.createElement("a");
    link.download = "image.jpg";
    link.href = canvas.toDataURL("image/jpeg", 0.92);
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
        </section>
      </main>
    </div>
  );
}

export default App;