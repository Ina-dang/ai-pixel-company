import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { OFFICE_FURNITURE_SWAPS, OFFICE_ROOM_LABELS } from '../apps/web/app/ui/office-presentation';

test('room labels stay inside the plan and away from staff anchors', () => {
  const map = JSON.parse(readFileSync(new URL('../apps/web/public/office-map.json', import.meta.url), 'utf8'));
  const points = map.layers.find((layer: { name: string }) => layer.name === 'interactionPoints').objects;
  for (const label of OFFICE_ROOM_LABELS) {
    expect(label.x).toBeGreaterThan(32); expect(label.x + 120).toBeLessThan(map.width * 32);
    expect(label.y).toBeGreaterThan(32); expect(label.y + 28).toBeLessThan(map.height * 32);
    expect(points.some((point: { x: number; y: number }) => Math.abs(point.x - label.x) < 80 && Math.abs(point.y - label.y) < 28)).toBe(false);
  }
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
