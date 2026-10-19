/**
 * Adapted from pixel-agents core/src/paletteUtils.ts at
 * b1bafd02896d90d83457266575a1e8e5011ce997.
 * https://github.com/pixel-agents-hq/pixel-agents
 * Changes: injectable randomness for repeatable office appearance, input guards.
 *
 * MIT License
 * Copyright (c) 2026 Pablo De Lucca
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
export function pickDiversePalette(paletteCount: number, paletteCounts: number[], random: () => number = Math.random): { palette: number; hueShift: number } {
  if (!Number.isSafeInteger(paletteCount) || paletteCount < 1 || paletteCounts.length !== paletteCount
    || paletteCounts.some(count => !Number.isSafeInteger(count) || count < 0)) throw new Error('Invalid palette distribution');
  const minimum = Math.min(...paletteCounts);
  const available: number[] = [];
  for (let index = 0; index < paletteCount; index++) if (paletteCounts[index] === minimum) available.push(index);
  const pick = random();
  if (!Number.isFinite(pick) || pick < 0 || pick >= 1) throw new Error('Invalid palette randomness');
  const palette = available[Math.floor(pick * available.length)];
  let hueShift = 0;
  if (minimum > 0) {
    const hue = random();
    if (!Number.isFinite(hue) || hue < 0 || hue >= 1) throw new Error('Invalid palette randomness');
    hueShift = 45 + Math.floor(hue * 271);
  }
  return { palette, hueShift };
}
