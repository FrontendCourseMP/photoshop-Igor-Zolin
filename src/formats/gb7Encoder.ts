export type EncodedImage = {
    width: number;
    height: number;
    data: Uint8ClampedArray;
    hasMask: boolean;
}

export function encodeGB7(image: EncodedImage): ArrayBuffer {
    const {width, height, data} = image;
    const hasMask = image.hasMask ?? true;

    const buffer = new ArrayBuffer(12 + width * height);
    const view = new DataView(buffer);
    const pixels = new Uint8ClampedArray(buffer, 12);

    view.setUint32(0, 0x4742371d, false);
    view.setUint8(4, 1);
    view.setUint8(5, hasMask ? 1 : 0);
    view.setUint16(6, width, false);
    view.setUint16(8, height, false);
    view.setUint16(10, 0, false);

    for (let i = 0; i < width * height; i++) {
        const offset = i * 4;

        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        const a = data[offset + 3];

        const gray8 = (r + g + b) / 3;
        const gray7 = Math.round((gray8 / 255) * 127);

        const maskBit = hasMask && a > 0 ? 1 : 0;

        const byte = hasMask ? (maskBit << 7) | gray7 : gray7;

        pixels[i] = byte;
    }
    return buffer;
}
