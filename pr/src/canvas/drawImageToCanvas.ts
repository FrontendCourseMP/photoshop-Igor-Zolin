import { DecodedImage } from "../formats/gb7Decoder";

export function drawImageToCanvas(
    canvas: HTMLCanvasElement,
    image: DecodedImage
): void {
        const ctx = canvas.getContext('2d');

        if (!ctx) {
            throw new Error('Не удалось получить контекст рисования');
        }

        canvas.
    }