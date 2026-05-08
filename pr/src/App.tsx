import { useEffect, useRef } from "react";
import "./App.css";
import { DecodedImage } from "./formats/gb7Decoder";
import { decodeGB7 } from "./formats/gb7Decoder";

const CANVAS_WIDTH = 1500;
const CANVAS_HEIGHT = 1000;
const CANVAS_BG = "#282c34";

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
                      onClick={saveImage}
                    >
                      Сохранить изображение
                    </button>
                  </div>
                </details>
              </li>
            </ul>
          </nav>

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