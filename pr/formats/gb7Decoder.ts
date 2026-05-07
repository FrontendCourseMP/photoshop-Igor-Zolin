export type DecodeImage = {
    signature: number;
    version: number;
    flag: number;
    width: number;
    height: number;
    reserve: number;
    colorDepth: number;
    hasMask: boolean;
    data: Uint8ClampedArray;
}

export function decodeGB7(buffer: ArrayBuffer): DecodeImage {
    const view = new DataView(buffer);
    const signature = view.getUint32(0);
    const version = view.getUint8(4);
    const flag = view.getUint8(5);
    const width = view.getUint16(6, false);
    const height = view.getUint16(8, false);
    const reserve = view.getUint16(10, false);
    const pixels = new Uint8ClampedArray(buffer, 12);

    const hasMask = (flag & 1) === 1;

    const rgba = new Uint8ClampedArray(width * height * 4);

    for (let i = 0; i < pixels.length; i++) {
        const byte = pixels[i];

        const gray7 = byte & 0x01111111;
        const gray8 = (gray7 / 127) * 255;

        const maskBit = (byte & 0x10000000) >> 7;
        const alpha = hasMask ? (maskBit ? 255 : 0) : 255;
        
        const offset = i * 4;

        rgba[offset] = gray8;
        rgba[offset + 1] = gray8;
        rgba[offset + 2] = gray8;
        rgba[offset + 3] = alpha;
    }
    return {
        signature,
        version,
        flag,
        width,
        height,
        reserve,
        colorDepth: hasMask ? 8 : 7,
        hasMask,
        data: rgba,
    };
}