import { describe, expect, test } from "vitest";
import {
  applyKernelFilterAsync,
  applyMedianFilterAsync,
  getKernelPreset,
} from "./kernelFilter";

const image3x3 = new Uint8ClampedArray([
  10, 1, 1, 255, 20, 2, 2, 255, 30, 3, 3, 255,
  40, 4, 4, 255, 50, 5, 5, 255, 60, 6, 6, 255,
  70, 7, 7, 255, 80, 8, 8, 255, 90, 9, 9, 255,
]);

describe("applyKernelFilterAsync", () => {
  test("keeps image unchanged with identity kernel", async () => {
    const output = await applyKernelFilterAsync(
      image3x3,
      3,
      3,
      getKernelPreset("identity").values,
      { channels: ["r", "g", "b"], padding: "copy", rowsPerChunk: 1 }
    );

    expect(Array.from(output)).toEqual(Array.from(image3x3));
  });

  test("applies kernel only to selected channels", async () => {
    const output = await applyKernelFilterAsync(
      image3x3,
      3,
      3,
      [0, 0, 0, 0, 2, 0, 0, 0, 0],
      { channels: ["r"], padding: "copy" }
    );

    expect(output[(1 * 3 + 1) * 4]).toBe(100);
    expect(output[(1 * 3 + 1) * 4 + 1]).toBe(5);
    expect(output[(1 * 3 + 1) * 4 + 2]).toBe(5);
  });

  test("supports white padding at edges", async () => {
    const output = await applyKernelFilterAsync(
      image3x3,
      3,
      3,
      [1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9],
      { channels: ["r"], padding: "white" }
    );

    expect(output[0]).toBe(155);
  });

  test("applies median filtering to selected channels", async () => {
    const noisy = new Uint8ClampedArray(image3x3);
    noisy[(1 * 3 + 1) * 4] = 255;

    const output = await applyMedianFilterAsync(noisy, 3, 3, {
      channels: ["r"],
      padding: "copy",
    });

    expect(output[(1 * 3 + 1) * 4]).toBe(60);
    expect(output[(1 * 3 + 1) * 4 + 1]).toBe(5);
  });
});
