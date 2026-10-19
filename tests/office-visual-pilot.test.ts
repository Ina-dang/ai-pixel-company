import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { OFFICE_BUBBLE_STYLES, OFFICE_FURNITURE_SWAPS, officeActivityExcerpt } from '../apps/web/app/ui/office-presentation';
import { pickDiversePalette } from '../apps/web/app/ui/vendor/pixel-agents-palette';

test('reused palette selection remains diverse across rounds and repeatable with a supplied source', () => {
  const counts = [0, 0, 0];
  const picks = Array.from({ length: 9 }, () => {
    const result = pickDiversePalette(3, counts, () => 0.75); counts[result.palette] += 1; return result;
  });
  expect(new Set(picks.slice(0, 3).map(pick => pick.palette)).size).toBe(3);
  expect(counts).toEqual([3, 3, 3]);
  expect(picks.slice(0, 3).every(pick => pick.hueShift === 0)).toBe(true);
  expect(picks.slice(3).every(pick => pick.hueShift >= 45 && pick.hueShift <= 315)).toBe(true);
  expect(() => pickDiversePalette(0, [], () => 0)).toThrow();
  expect(() => pickDiversePalette(3, [0, 0, 0], () => 1)).toThrow();
});
test('visual furniture replacements occupy existing blocked furniture, never a path or staff anchor', () => {
  const map = JSON.parse(readFileSync(new URL('../apps/web/public/office-map.json', import.meta.url), 'utf8'));
  const collision = map.layers.find((layer: { name: string }) => layer.name === 'collision').data;
  const furniture = map.layers.find((layer: { name: string }) => layer.name === 'furniture').data;
  const points = map.layers.find((layer: { name: string }) => layer.name === 'interactionPoints').objects;
  for (const replacement of OFFICE_FURNITURE_SWAPS) {
    const cell = replacement.y * map.width + replacement.x;
    expect(collision[cell]).toBeGreaterThan(0); expect(furniture[cell]).toBeGreaterThan(0);
    expect(points.some((point: { x: number; y: number }) => Math.floor(point.x / 32) === replacement.x && Math.floor(point.y / 32) === replacement.y)).toBe(false);
  }
});
test('speech preserves Unicode and server-state distinctions without inventing completion', () => {
  const text = '한글 😀 개발 작업 상태를 확인하고 승인 결과를 기다리는 중입니다';
  const excerpt = officeActivityExcerpt(text);
  expect(Array.from(excerpt)).toHaveLength(26); expect(excerpt).not.toContain('\ufffd');
  expect(OFFICE_BUBBLE_STYLES.WAITING.label).not.toMatch(/완료|성공/);
  expect(OFFICE_BUBBLE_STYLES.BLOCKED.label).not.toBe(OFFICE_BUBBLE_STYLES.WAITING.label);
  expect(OFFICE_BUBBLE_STYLES.REVIEWING.label).not.toMatch(/통과|완료/);
});
