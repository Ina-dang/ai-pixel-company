import type { OfficeAgent } from '@ai-pixel/contracts';
import * as Phaser from 'phaser';
import { createOfficeArt, type StaffAnimation } from './office-art';
import { OFFICE_FURNITURE_SWAPS } from './office-presentation';

const TILE = 32;
const WIDTH = 896;
const HEIGHT = 512;
type AgentId = OfficeAgent['id'];
type Point = { x: number; y: number };
type Options = { selectedId: AgentId | null; reducedMotion: boolean; visible: boolean; snap?: boolean };
type Callbacks = { onSelect: (id: AgentId) => void; onReady: () => void; onError: (message: string) => void };
export type OfficeSceneController = { update: (agents: OfficeAgent[], options: Options) => void; destroy: () => void };

const STATE_COLORS: Record<OfficeAgent['state'], number> = {
  IDLE: 0x819286, RUNNING: 0x5750cb, WAITING: 0xb98b4e,
  REVIEWING: 0x28735b, BLOCKED: 0xb98b4e, ERROR: 0xb85d63,
};
const ANIMATIONS: Record<OfficeAgent['state'], StaffAnimation> = {
  IDLE: 'idle', RUNNING: 'type', WAITING: 'wait', REVIEWING: 'review', BLOCKED: 'wait', ERROR: 'error',
};
const LOCATION_IDS: Record<OfficeAgent['location'], string> = {
  pmDesk: 'desk:pm', developerDesk: 'desk:developer', qaDesk: 'desk:qa',
  owner: 'owner', lounge: 'lounge', meeting: 'meeting',
};

type Visual = {
  data: OfficeAgent;
  body: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  marker: Phaser.GameObjects.Ellipse;
  label: HTMLDivElement;
  stateDot: Phaser.GameObjects.Arc;
  path: Point[];
  target: Point;
  completeUntil: number;
};

// Four-neighbor tile centers keep each movement segment inside walkable cells.
function walkPath(start: Point, target: Point, blocked: Set<string>, columns: number, rows: number): Point[] {
  const key = (point: Point) => `${point.x},${point.y}`;
  const allowed = (point: Point) => point.x >= 0 && point.y >= 0 && point.x < columns && point.y < rows && !blocked.has(key(point));
  if (!allowed(start) || !allowed(target)) return [];
  const queue = [start];
  const previous = new Map<string, Point | null>([[key(start), null]]);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const point = queue[cursor];
    if (key(point) === key(target)) {
      const result: Point[] = [];
      let current: Point | null = point;
      while (current) { result.unshift(current); current = previous.get(key(current)) ?? null; }
      return result.map(cell => ({ x: cell.x * TILE + TILE / 2, y: cell.y * TILE + TILE / 2 }));
    }
    for (const next of [{ x: point.x + 1, y: point.y }, { x: point.x, y: point.y + 1 }, { x: point.x - 1, y: point.y }, { x: point.x, y: point.y - 1 }]) {
      if (allowed(next) && !previous.has(key(next))) { previous.set(key(next), point); queue.push(next); }
    }
  }
  return [];
}

export function createOfficeScene(parent: HTMLElement, callbacks: Callbacks): OfficeSceneController {
  const labels = document.createElement('div');
  labels.className = 'office-agent-labels';
  labels.setAttribute('aria-hidden', 'true');
  parent.append(labels);
  let destroyed = false;
  let failed = false;
  let ready = false;
  let destructionRequested = false;
  let game: Phaser.Game | null = null;
  let scene: OfficeScene | null = null;
  let pending: { agents: OfficeAgent[]; options: Options } = {
    agents: [], options: { selectedId: null, reducedMotion: false, visible: true, snap: true },
  };
  const disposeGame = (instance = game) => {
    labels.remove();
    if (!instance || destructionRequested) return;
    destructionRequested = true;
    instance.destroy(true);
    if (instance.isBooted) instance.loop.wake();
  };
  const reportError = () => {
    if (destroyed || failed) return;
    failed = true;
    disposeGame();
    callbacks.onError('픽셀 사무실을 불러오지 못했습니다. 아래 직원 목록에서 상태를 확인할 수 있습니다.');
  };

  class OfficeScene extends Phaser.Scene {
    private tilemap: Phaser.Tilemaps.Tilemap | null = null;
    private blocked = new Set<string>();
    private points = new Map<string, Point>();
    private staff = new Map<AgentId, Visual>();
    private options = pending.options;
    private loadFailure = () => reportError();

    constructor() { super({ key: 'pixel-office' }); }

    preload() {
      if (destroyed) return;
      this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, this.loadFailure);
      const cleanup = () => {
        this.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, this.loadFailure);
        this.input.removeAllListeners();
        labels.replaceChildren();
        this.staff.clear(); this.points.clear(); this.blocked.clear();
        this.tilemap?.destroy(); this.tilemap = null;
      };
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
      this.events.once(Phaser.Scenes.Events.DESTROY, cleanup);
      this.load.tilemapTiledJSON('office-map', '/office-map.json');
    }

    create() {
      if (destroyed || failed) return;
      try {
        createOfficeArt(this);
        this.tilemap = this.make.tilemap({ key: 'office-map' });
        const tileset = this.tilemap.addTilesetImage('office-tiles', 'office-tiles', TILE, TILE, 0, 0);
        if (!tileset || this.tilemap.widthInPixels !== WIDTH || this.tilemap.heightInPixels !== HEIGHT) throw new Error('Invalid office map');
        for (const name of ['floor', 'walls', 'furniture', 'collision']) {
          const layer = this.tilemap.createLayer(name, tileset);
          if (!layer) throw new Error('Missing office layer');
          if (name === 'collision') {
            layer.setVisible(false);
            layer.setCollision(1);
            layer.forEachTile(cell => { if (cell.index > 0) this.blocked.add(`${cell.x},${cell.y}`); });
          } else layer.setDepth(name === 'floor' ? 0 : name === 'walls' ? 2 : 3);
        }
        const interactions = this.tilemap.getObjectLayer('interactionPoints');
        if (!interactions) throw new Error('Missing interaction points');
        for (const point of interactions.objects) {
          if (point.name && typeof point.x === 'number' && typeof point.y === 'number') this.points.set(point.name, { x: point.x, y: point.y });
        }
        for (const required of ['desk:pm', 'desk:developer', 'desk:qa', 'owner', 'meeting', 'lounge:PM', 'lounge:DEVELOPER', 'lounge:QA']) {
          const point = this.points.get(required);
          if (!point || this.blocked.has(`${Math.floor(point.x / TILE)},${Math.floor(point.y / TILE)}`)) throw new Error('Invalid interaction point');
        }
        this.decorate();
        ready = true;
        this.apply(pending.agents, { ...pending.options, snap: true });
        callbacks.onReady();
        if (!pending.options.visible) this.game.loop.sleep();
      } catch { reportError(); }
    }

    private decorate() {
      // Keep the original furniture and walkable plan. Room names and activity
      // text use HTML, so resizing the pixel artwork never resamples glyphs.
      const furniture = this.tilemap?.getLayer('furniture')?.tilemapLayer;
      for (const item of OFFICE_FURNITURE_SWAPS) furniture?.putTileAt(item.tile, item.x, item.y);
    }

    private target(agent: OfficeAgent): Point {
      const id = agent.location === 'lounge' ? `lounge:${agent.id}` : LOCATION_IDS[agent.location];
      const base = this.points.get(id) ?? this.points.get(`lounge:${agent.id}`);
      if (!base) throw new Error('Unknown office location');
      const offset = agent.location === 'owner' || agent.location === 'meeting'
        ? agent.id === 'PM' ? -TILE : agent.id === 'QA' ? TILE : 0 : 0;
      const point = { x: base.x + offset, y: base.y };
      return this.blocked.has(`${Math.floor(point.x / TILE)},${Math.floor(point.y / TILE)}`) ? base : point;
    }

    private addStaff(agent: OfficeAgent): Visual {
      const point = this.target(agent);
      const body = this.add.container(point.x, point.y).setDepth(point.y + 10);
      const shadow = this.add.ellipse(0, 3, 27, 9, 0x263735, 0.16);
      const marker = this.add.ellipse(0, 2, 36, 15).setStrokeStyle(2, 0x5750cb).setVisible(false);
      const sprite = this.add.sprite(0, 0, 'office-staff', `${agent.id}:idle:0`).setOrigin(0.5, 0.95).setScale(1.25);
      const label = document.createElement('div');
      label.className = 'office-agent-label';
      label.dataset.role = agent.role === 'DEVELOPER' ? 'DEV' : agent.role;
      labels.append(label);
      const stateDot = this.add.circle(0, -55, 3, STATE_COLORS[agent.state]);
      const target = this.add.rectangle(0, -18, 54, 82, 0xffffff, 0).setInteractive({ useHandCursor: true });
      const visual: Visual = { data: agent, body, sprite, marker, label, stateDot, path: [], target: point, completeUntil: 0 };
      target.on('pointerdown', () => { if (!destroyed) callbacks.onSelect(agent.id); });
      body.add([shadow, marker, sprite, stateDot, target]);
      this.staff.set(agent.id, visual);
      return visual;
    }

    apply(agents: OfficeAgent[], options: Options) {
      if (!ready || destroyed || failed) return;
      const wasVisible = this.options.visible;
      this.options = options;
      const present = new Set(agents.map(agent => agent.id));
      for (const [id, visual] of this.staff) if (!present.has(id)) { visual.body.destroy(true); visual.label.remove(); this.staff.delete(id); }
      for (const agent of agents) {
        const existing = this.staff.get(agent.id);
        const visual = existing ?? this.addStaff(agent);
        const point = this.target(agent);
        const snap = !existing || options.snap || options.reducedMotion || !options.visible || !wasVisible;
        const completed = existing && agent.lastCompletedAt && existing.data.lastCompletedAt !== agent.lastCompletedAt;
        if (snap) {
          visual.body.setPosition(point.x, point.y); visual.path = []; visual.completeUntil = 0;
        } else if (point.x !== visual.target.x || point.y !== visual.target.y) {
          visual.path = walkPath({ x: Math.floor(visual.body.x / TILE), y: Math.floor(visual.body.y / TILE) },
            { x: Math.floor(point.x / TILE), y: Math.floor(point.y / TILE) }, this.blocked, 28, 16);
          if (!visual.path.length) throw new Error('Office path is unavailable');
        }
        if (completed && !snap && agent.state === 'IDLE') visual.completeUntil = this.time.now + 1500;
        visual.target = point; visual.data = agent;
        visual.label.textContent = agent.nameKo;
        visual.stateDot.setFillStyle(STATE_COLORS[agent.state]);
        this.paint(visual, this.time.now);
      }
    }

    private paint(visual: Visual, time: number) {
      const selected = this.options.selectedId === visual.data.id;
      visual.marker.setVisible(selected);
      visual.label.classList.toggle('is-selected', selected);
      visual.label.style.left = `${visual.body.x / WIDTH * 100}%`;
      visual.label.style.top = `${(visual.body.y + 10) / HEIGHT * 100}%`;
      const animation: StaffAnimation = visual.path.length ? 'walk' : visual.completeUntil > time ? 'complete' : ANIMATIONS[visual.data.state];
      const frame = this.options.reducedMotion || !this.options.visible ? 0 : Math.floor(time / (animation === 'walk' ? 130 : animation === 'type' ? 220 : 420)) % 4;
      const key = `${visual.data.id}:${animation}:${frame}`;
      if (visual.sprite.frame.name !== key) visual.sprite.setFrame(key);
      visual.body.setDepth(visual.body.y + 10);
    }

    update(_time: number, delta: number) {
      if (destroyed || failed || !this.options.visible) return;
      for (const visual of this.staff.values()) {
        const next = visual.path[0];
        if (next && !this.options.reducedMotion) {
          const dx = next.x - visual.body.x;
          const dy = next.y - visual.body.y;
          const distance = Math.hypot(dx, dy);
          const step = Math.min(delta, 48) * 0.095;
          if (distance <= step) { visual.body.setPosition(next.x, next.y); visual.path.shift(); }
          else { visual.body.x += dx / distance * step; visual.body.y += dy / distance * step; }
          if (Math.abs(dx) > 1) visual.sprite.setFlipX(dx < 0);
        }
        this.paint(visual, this.time.now);
      }
    }
  }

  try {
    if (!document.createElement('canvas').getContext('2d')) throw new Error('Canvas is unavailable');
    scene = new OfficeScene();
    game = new Phaser.Game({
      type: Phaser.CANVAS, parent, width: WIDTH, height: HEIGHT, backgroundColor: '#ece8da',
      pixelArt: true, roundPixels: true, antialias: false,
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      fps: { target: 30, forceSetTimeOut: false },
      audio: { noAudio: true }, input: { keyboard: false, gamepad: false },
      scene, banner: false,
      callbacks: { postBoot: (instance) => {
        instance.canvas.setAttribute('aria-hidden', 'true');
        instance.canvas.style.imageRendering = 'pixelated';
        if (destroyed || failed) disposeGame(instance);
      } },
    });
  } catch { reportError(); }

  return {
    update(agents, options) {
      if (destroyed || failed) return;
      pending = { agents, options };
      if (!ready || !scene || !game) return;
      try {
        scene.apply(agents, options);
        if (options.visible) game.loop.wake(); else game.loop.sleep();
      } catch { reportError(); }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; ready = false; pending = { agents: [], options: pending.options };
      // Phaser queues destruction for its next step; wake a hidden game so that
      // scene/input/texture/RAF cleanup still runs after a background-tab unmount.
      disposeGame();
      scene = null; game = null;
    },
  };
}
