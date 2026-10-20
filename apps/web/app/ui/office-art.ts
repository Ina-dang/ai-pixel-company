import type Phaser from 'phaser';

// Original, code-drawn artwork and layout dedicated to CC0-1.0. No downloaded art.
export const OFFICE_ART_PROVENANCE = {
  id: 'ai-pixel-office-original-v3',
  license: 'CC0-1.0',
  source: 'Original AI Pixel Company procedural Canvas2D pixel art',
  thirdPartyImages: false,
} as const;

export const STAFF_STATES = ['idle', 'walk', 'type', 'review', 'wait', 'error', 'complete'] as const;
export type StaffAnimation = typeof STAFF_STATES[number];
export const STAFF_ROLES = ['PM', 'DEVELOPER', 'QA'] as const;
const roleClothes = { PM: '#7585a9', DEVELOPER: '#4b9185', QA: '#bd926d' } as const;

function rectangle(context: CanvasRenderingContext2D, color: string, x: number, y: number, width: number, height: number) {
  context.fillStyle = color;
  context.fillRect(x, y, width, height);
}

function tile(context: CanvasRenderingContext2D, id: number) {
  const r = (color: string, x: number, y: number, width: number, height: number) => rectangle(context, color, x, y, width, height);
  const wood = (base: string, line: string) => {
    r(base, 0, 0, 32, 32);
    r(line, 0, 0, 32, 1); r(line, 0, 16, 32, 1);
    r(line, id % 2 ? 9 : 23, 0, 1, 16); r(line, id % 2 ? 24 : 8, 16, 1, 16);
    r('#ffffff0c', 2, 3, 19, 1); r('#ffffff0c', 14, 20, 15, 1);
  };
  if (id === 1 || id === 2) { wood(id === 1 ? '#dfc2a0' : '#e3c7a5', '#c9a783'); return; }
  if (id === 3 || id === 4) {
    r(id === 3 ? '#e7e6d9' : '#c5d9cf', 0, 0, 32, 32);
    r(id === 3 ? '#d9d8ca' : '#b7ccc1', 0, 31, 32, 1);
    r(id === 3 ? '#d9d8ca' : '#b7ccc1', 31, 0, 1, 32);
    r('#ffffff18', 0, 0, 32, 1); return;
  }
  if (id === 5) { wood('#c9a585', '#b38e70'); return; }
  if (id === 7) {
    // A continuous vertical wall, rather than a horizontal skirting tile repeated down a column.
    r('#ece8df', 0, 0, 32, 32);
    r('#faf8f1', 0, 0, 4, 32); r('#cbc9bf', 28, 0, 4, 32);
    return;
  }
  if ([6, 8, 29, 30].includes(id)) {
    r('#ece8df', 0, 0, 32, 32); r('#faf8f1', 0, 0, 32, 4);
    r('#cbc9bf', 0, 28, 32, 4);
    if (id === 29) {
      r('#878f92', 1, 3, 30, 19); r('#d0e6e6', 3, 4, 26, 15);
      r('#b5d8db', 4, 5, 10, 12); r('#a0c8c9', 17, 5, 10, 12);
      r('#f7fbef', 14, 4, 3, 15); r('#f7fbef', 3, 11, 26, 2);
      r('#fff9ee', 0, 20, 32, 3);
    }
    return;
  }
  if (id === 9) {
    r('#b5c7bd', 0, 0, 32, 32); r('#adbdaf', 0, 0, 32, 2);
    r('#c8d6c9', 3, 4, 2, 2); r('#c8d6c9', 19, 20, 2, 2); return;
  }
  if (id === 28) {
    r('#e7e6d9', 0, 0, 32, 32); r('#8f9e96', 1, 5, 30, 22);
    for (let y = 8; y < 26; y += 4) r('#c1c8b6', 3, y, 26, 1);
    return;
  }
  if (id === 10) {
    r('#28333e24', 1, 28, 30, 4); r('#b4916c', 2, 20, 28, 10); r('#e5c59c', 1, 18, 30, 3);
    r('#384d4a', 4, 2, 17, 16); r('#6b8880', 6, 4, 13, 5); r('#bfd3bd', 8, 5, 5, 2);
    r('#253b38', 8, 11, 10, 4); r('#e9dfc4', 11, 13, 5, 5); r('#a9baa2', 23, 12, 6, 6);
    r('#f1e8ce', 24, 13, 4, 3); r('#846e50', 8, 24, 4, 2); r('#846e50', 20, 24, 4, 2); return;
  }
  if (id === 14) {
    r('#23353b24', 2, 29, 28, 3); r('#48565c', 3, 1, 26, 29); r('#71817e', 5, 2, 22, 2);
    for (let row = 0; row < 3; row++) {
      const y = 6 + row * 8;
      r('#27393e', 6, y, 20, 6); r('#718783', 8, y + 2, 10, 1);
      r('#b3ce9d', 21, y + 2, 2, 2); r('#c5b984', 24, y + 2, 1, 2);
    }
    return;
  }
  if ([11, 12, 13].includes(id)) {
    r('#232a4022', 1, 26, 30, 6); r('#956947', 4, 25, 4, 5); r('#956947', 24, 25, 4, 5);
    r('#a6734d', 0, 15, 32, 13); r('#c99466', 0, 12, 32, 13); r('#edc396', 1, 12, 30, 2);
    r('#dcae7e', 0, 14, 32, 2); r('#986e51', 0, 25, 32, 2);
    if (id === 12) {
      r('#424858', 7, 1, 19, 13); r('#1d2937', 9, 3, 15, 9);
      r('#8cb9a8', 11, 5, 9, 1); r('#d9dcbe', 11, 7, 5, 1); r('#677c94', 11, 9, 10, 1);
      r('#454c58', 15, 14, 3, 3); r('#777a77', 11, 17, 11, 2);
      r('#e9e5d5', 7, 20, 17, 3); r('#b7b8b1', 9, 21, 12, 1);
    } else if (id === 11) {
      r('#eae9dc', 5, 15, 10, 8); r('#a8b8ab', 6, 16, 8, 1); r('#adbbad', 7, 19, 5, 1);
      r('#c47c78', 22, 16, 5, 5); r('#f2d6ac', 23, 16, 3, 2);
    } else {
      r('#657f74', 20, 15, 5, 7); r('#e5dbbe', 21, 15, 3, 3); r('#e8e2ce', 27, 17, 2, 3);
    }
    return;
  }
  if (id === 15) {
    r('#283748', 8, 4, 17, 21); r('#4e706b', 10, 6, 13, 11); r('#668b7d', 10, 19, 13, 6);
    r('#283748', 6, 19, 3, 8); r('#283748', 25, 19, 3, 8);
    r('#45525c', 15, 26, 3, 5); r('#45525c', 7, 29, 20, 2); return;
  }
  if (id === 16 || id === 31) {
    r('#233c3222', 5, 27, 24, 4); r('#b7765a', 11, 21, 13, 9); r('#d89c7b', 10, 20, 15, 3);
    r('#779769', 16, 6, 3, 17); r('#597d62', 4, 9, 13, 6); r('#91ac7d', 7, 5, 9, 5);
    r('#355c4d', 17, 11, 12, 7); r('#739870', 18, 6, 9, 6); r('#b1bd85', 13, 2, 7, 6);
    if (id === 31) { r('#d09f84', 9, 12, 4, 4); r('#e4c89e', 23, 10, 3, 3); }
    return;
  }
  if (id === 17 || id === 18) {
    r('#8c6e55', 2, 2, 28, 29); r('#d0ad82', 3, 2, 26, 3);
    r('#615849', 5, 6, 22, 10); r('#615849', 5, 19, 22, 9);
    if (id === 17) {
      const colors = ['#99b8a2', '#bc7e72', '#dac38c', '#7d90a5', '#e3d9c1'];
      for (let i = 0; i < 5; i++) { r(colors[i], 6 + i * 4, 7 + i % 2, 3, 8 - i % 2); r(colors[(i + 2) % 5], 6 + i * 4, 20, 3, 7); }
    } else { r('#b8c0ac', 5, 6, 22, 10); r('#b8c0ac', 5, 19, 22, 9); r('#596a67', 13, 10, 7, 2); r('#596a67', 13, 23, 7, 2); }
    return;
  }
  if (id === 19) {
    r('#303c4930', 2, 27, 28, 4); r('#9a8f7b', 3, 2, 26, 24); r('#f1eee1', 5, 4, 22, 19);
    r('#78978b', 8, 8, 10, 2); r('#ceb58d', 8, 12, 15, 2); r('#ba8d86', 8, 17, 6, 2);
    r('#7a7e76', 8, 26, 2, 6); r('#7a7e76', 23, 26, 2, 6); return;
  }
  if ([20, 21, 22].includes(id)) {
    r('#4e473c22', 0, 27, 32, 5); r('#8d6650', 3, 24, 4, 5); r('#8d6650', 25, 24, 4, 5);
    r('#a47857', 0, 4, 32, 24); r('#d3aa7b', 0, 1, 32, 25); r('#e7c497', 0, 1, 32, 2);
    if (id === 21) { r('#e9e7d4', 9, 9, 12, 9); r('#9ead9e', 11, 11, 7, 1); r('#babcab', 11, 14, 8, 1); }
    if (id === 22) { r('#758c79', 12, 11, 7, 7); r('#d9d0ab', 13, 12, 5, 2); }
    return;
  }
  if ([23, 24, 25].includes(id)) {
    r('#28333e22', 0, 28, 32, 4); r('#507569', 0, 2, 32, 26); r('#7a9f88', 2, 4, 28, 12);
    r('#94b098', 2, 5, 28, 2); r('#9bb59b', 2, 18, 28, 8); r('#406353', 0, 27, 32, 3);
    if (id === 23) { r('#628779', 0, 9, 6, 18); r('#d6b59e', 10, 7, 11, 10); r('#e2c8ab', 11, 8, 9, 1); }
    if (id === 25) { r('#628779', 26, 9, 6, 18); r('#cfab93', 11, 8, 10, 9); }
    return;
  }
  if (id === 26) {
    r('#303a3922', 0, 25, 32, 5); r('#a57c58', 3, 8, 27, 20); r('#d5b184', 2, 6, 28, 20);
    r('#e8d3a8', 4, 7, 24, 2); r('#f0e9d4', 7, 11, 9, 8); r('#bdc8b3', 8, 12, 7, 1);
    r('#7a9a86', 21, 13, 5, 6); r('#e9dfc3', 22, 13, 3, 2); return;
  }
  if (id === 32) {
    r('#626453', 16, 9, 2, 20); r('#dad0a1', 6, 4, 22, 8); r('#eee5bd', 9, 1, 16, 7);
    r('#f8f0cc', 9, 4, 16, 2); r('#626453', 10, 29, 14, 2);
  }
}

function staff(context: CanvasRenderingContext2D, role: typeof STAFF_ROLES[number], state: StaffAnimation, frame: number) {
  const r = (color: string, x: number, y: number, width: number, height: number) => rectangle(context, color, x, y, width, height);
  const skin = role === 'PM' ? '#c18d70' : role === 'DEVELOPER' ? '#edb799' : '#dab08b';
  const hair = role === 'PM' ? '#674b48' : role === 'DEVELOPER' ? '#253d48' : '#3d3948';
  const shirt = roleClothes[role];
  const movement = state === 'walk' ? frame % 2 * 2 : 0;
  const bob = state === 'walk' && frame % 2 ? -1 : state === 'idle' && frame === 2 ? -1 : 0;
  const complete = state === 'complete' && frame % 2 === 1;
  context.translate(0, bob);
  r('#333c4e', 10, 28, 6, 8 - movement); r('#333c4e', 18, 28, 5, 6 + movement);
  r('#252a36', 9, 34 - movement, 7, 3); r('#252a36', 18, 34 + movement, 7, 3);
  r(shirt, 9, 17, 16, 14); r('#ffffff16', 10, 18, 2, 11); r('#272b3d22', 23, 19, 2, 11);
  r('#ffffff28', 11, 18, 3, 2); r('#26343e20', 10, 29, 14, 2);
  r(skin, 14, 14, 6, 5); r('#eadcc6', 14, 19, 6, 2);
  if (role === 'DEVELOPER') { r('#70ad96', 12, 19, 2, 7); r('#70ad96', 21, 19, 2, 7); r('#396c65', 13, 28, 8, 2); }
  if (role === 'QA') { r('#e5bf88', 13, 18, 4, 8); r('#ebca94', 17, 18, 4, 3); }
  if (role === 'PM') { r('#675d94', 16, 22, 2, 9); r('#e8d5b8', 19, 25, 3, 3); }
  const handsUp = state === 'type' || state === 'review';
  r(shirt, 6, complete ? 11 : 19 + movement, 4, 8);
  r(skin, complete ? 5 : 6, complete ? 7 : handsUp ? 23 : 26 + movement, complete ? 4 : handsUp ? 8 : 4, 4);
  r(shirt, 25, complete ? 12 : 19 - movement, 4, 8);
  r(skin, 25, complete ? 8 : handsUp ? 23 + frame % 2 : 26 - movement, 4, 4);
  r(hair, 10, 5, 15, 11); r(skin, 11, 8, 13, 9); r('#b8856c', 12, 16, 10, 1);
  r(hair, 11, 4, 13, 5); r(hair, 9, 8, 3, 6); r(hair, 23, 7, 3, 6);
  if (role === 'PM') { r(hair, 19, 0, 7, 6); r('#bf8c8b', 19, 3, 6, 2); r(hair, 12, 8, 4, 2); }
  if (role === 'DEVELOPER') { r(hair, 9, 3, 11, 4); r('#87989a', 7, 10, 3, 6); r('#87989a', 25, 10, 3, 6); r('#a9b5ac', 9, 5, 1, 7); }
  if (role === 'DEVELOPER') { r('#75858b', 26, 14, 2, 4); r('#384b52', 23, 17, 4, 1); }
  if (role === 'QA') { r(hair, 24, 7, 4, 12); r('#be8d7c', 25, 8, 4, 3); r('#59616c', 11, 10, 6, 4); r('#59616c', 19, 10, 6, 4); r('#dfd6c5', 12, 11, 4, 2); r('#dfd6c5', 20, 11, 4, 2); }
  if (state !== 'wait' || frame % 2 === 0) { r('#30323e', 14, 11, 2, 2); r('#30323e', 21, 11, 2, 2); }
  else { r('#7f5e58', 14, 12, 2, 1); r('#7f5e58', 21, 12, 2, 1); }
  r(state === 'error' ? '#895c5a' : '#ad7665', 17, 15, 3, 1);
  if (state === 'review') { r('#e9e3c9', 7, 23, 13, 8); r('#8f9b8f', 9, 25, 8, 1); r('#8f9b8f', 9, 28, 6, 1); }
  if (state === 'type') { r('#d9ddd0', 8, 26, 15, 4); r('#7e9590', 10 + frame % 2, 27, 9, 1); }
  context.translate(0, -bob);
}

export function createOfficeArt(scene: Phaser.Scene) {
  const tiles = scene.textures.createCanvas('office-tiles', 256, 128);
  const atlas = scene.textures.createCanvas('office-staff', STAFF_STATES.length * 4 * 32, 3 * 40);
  if (!tiles || !atlas) throw new Error('픽셀 텍스처를 만들 수 없습니다.');
  const tilesContext = tiles.getContext();
  tilesContext.imageSmoothingEnabled = false;
  for (let id = 1; id <= 32; id++) {
    tilesContext.save(); tilesContext.translate((id - 1) % 8 * 32, Math.floor((id - 1) / 8) * 32);
    tile(tilesContext, id); tilesContext.restore();
  }
  tiles.refresh();
  const context = atlas.getContext();
  context.imageSmoothingEnabled = false;
  const frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }> = {};
  STAFF_ROLES.forEach((role, row) => {
    STAFF_STATES.forEach((state, column) => {
      for (let frame = 0; frame < 4; frame++) {
        const x = (column * 4 + frame) * 32;
        const y = row * 40;
        context.save(); context.translate(x, y); staff(context, role, state, frame); context.restore();
        frames[`${role}:${state}:${frame}`] = { frame: { x, y, w: 32, h: 40 } };
      }
    });
  });
  atlas.refresh();
  scene.textures.addAtlas('office-staff', atlas, { frames, meta: { app: OFFICE_ART_PROVENANCE.id, license: OFFICE_ART_PROVENANCE.license } });
}
