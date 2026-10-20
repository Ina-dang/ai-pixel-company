// Original HTML labels on the existing floor plan. Resizing the artwork does
// not resample glyphs. Server state and collision coordinates are unchanged.
export const OFFICE_ROOM_LABELS = [
  { name: '대표실', x: 48, y: 44 },
  { name: '개발실', x: 336, y: 44 },
  { name: 'QA 검토실', x: 656, y: 44 },
  { name: '회의실', x: 48, y: 328 },
  { name: '라운지', x: 464, y: 328 },
] as const;
// Reuse only the project's own furniture, on already occupied cells.
export const OFFICE_FURNITURE_SWAPS = [
  { x: 18, y: 2, tile: 14, name: '서버 선반' },
  { x: 25, y: 11, tile: 10, name: '커피 코너' },
] as const;
