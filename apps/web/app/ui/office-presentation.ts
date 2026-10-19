import type { OfficeAgent } from '@ai-pixel/contracts';

// Presentation only. Never infer workflow completion from an animation or timer.
export const OFFICE_BUBBLE_STYLES: Record<OfficeAgent['state'], { label: string; symbol: string; color: number; text: string }> = {
  IDLE: { label: '대기 중', symbol: '·', color: 0x69816e, text: '#526b59' },
  RUNNING: { label: '작업 중', symbol: '…', color: 0x6862a6, text: '#59538e' },
  REVIEWING: { label: '검토 중', symbol: '≡', color: 0x438875, text: '#337361' },
  WAITING: { label: '응답 대기', symbol: '?', color: 0xb18445, text: '#886029' },
  BLOCKED: { label: '진행 차단', symbol: 'Ⅱ', color: 0xb18445, text: '#886029' },
  ERROR: { label: '오류 확인', symbol: '!', color: 0xb96368, text: '#a44c52' },
};

export function officeActivityExcerpt(value: string): string {
  const characters = Array.from(value.replace(/\s+/g, ' ').trim());
  return characters.length > 26 ? `${characters.slice(0, 25).join('')}…` : characters.join('');
}

// All decoration stays inside existing rooms and on top of occupied furniture.
// Collision tiles and server-owned interaction points remain authoritative.
export const OFFICE_VISUAL_ZONES = [
  { x: 344, y: 151, width: 230, height: 78, color: 0xadc4bb, border: 0xe6e8d8 },
  { x: 703, y: 151, width: 106, height: 78, color: 0xa9bcc6, border: 0xe5eadf },
  { x: 145, y: 345, width: 159, height: 104, color: 0xc8ae8c, border: 0xeee0c2 },
  { x: 533, y: 371, width: 283, height: 94, color: 0xb4c5ad, border: 0xe5e5cf },
] as const;
export const OFFICE_FURNITURE_SWAPS = [
  { x: 18, y: 2, tile: 14, name: '서버 선반' },
  { x: 25, y: 11, tile: 10, name: '커피 코너' },
] as const;
