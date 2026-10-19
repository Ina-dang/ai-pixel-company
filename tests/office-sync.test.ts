import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { OfficeAgent } from '@ai-pixel/contracts';
import { chooseSnapshot, ProjectEventGate, validOfficeAgents } from '../apps/web/app/ui/office-model';
import type { CompanyEvent, Snapshot } from '../apps/web/app/ui/api';

const projectId = '33333333-3333-4333-8333-333333333333';
const otherProject = '44444444-4444-4444-8444-444444444444';
const runId = '55555555-5555-4555-8555-555555555555';
function agents(version = 1): OfficeAgent[] {
  return (['PM', 'DEVELOPER', 'QA'] as const).map(role => ({ id: role, role, nameKo: role, state: 'IDLE', activityKo: '대기 중', location: 'lounge',
    taskId: null, taskTitle: null, taskStatus: null, runId, runStatus: 'SUCCEEDED', stage: 'QA', blockedReason: null,
    version, evidenceSha: null, lastCompletedAt: null, usage: null, activeAssignments: 0 }));
}
const snapshot = (cursor: string, version = 1): Snapshot => ({ projectId, cursor, agents: agents(version), tasks: [], approvals: [], syncedAt: '2026-10-19T01:00:00.000Z' });
function event(sequence: string, id = `event-${sequence}`): CompanyEvent { return { eventId: id, projectId, sequence, timestamp: '2026-10-19T01:00:00.000Z', type: 'workflow.run.updated', payload: {} }; }

describe('read-only office projection ordering', () => {
  test('requires all three distinct verified staff roles and preserves canonical order', () => {
    expect(validOfficeAgents(agents().reverse()).map(agent => agent.id)).toEqual(['PM', 'DEVELOPER', 'QA']);
    expect(validOfficeAgents([])).toEqual([]);
    const duplicated = agents(); duplicated[2] = duplicated[0];
    expect(validOfficeAgents(duplicated)).toEqual([]);
    expect(validOfficeAgents(agents().map(agent => ({ ...agent, state: 'FAKE_SUCCESS' })))).toEqual([]);
  });
  test('a stale, equal-cursor or foreign-project response cannot replace current state', () => {
    const current = snapshot('9007199254740994', 4);
    expect(chooseSnapshot(current, snapshot('9007199254740993', 3), projectId)).toBe(current);
    expect(chooseSnapshot(current, snapshot(current.cursor, 5), projectId)).toBe(current);
    expect(chooseSnapshot(current, { ...snapshot('9007199254740995', 5), projectId: otherProject }, projectId)).toBe(current);
  });
  test('same-run versions cannot regress even with a higher organization cursor', () => {
    const current = snapshot('30', 8);
    expect(chooseSnapshot(current, snapshot('31', 7), projectId)).toBe(current);
    const newer = snapshot('31', 9);
    expect(chooseSnapshot(current, newer, projectId)).toBe(newer);
  });
  test('a new run may start at version one; explicit server reset restores its truth', () => {
    const current = snapshot('30', 8);
    const next = snapshot('31'); next.agents = next.agents.map(agent => ({ ...agent, runId: '66666666-6666-4666-8666-666666666666' }));
    expect(chooseSnapshot(current, next, projectId)).toBe(next);
    const restored = snapshot('2'); expect(chooseSnapshot(current, restored, projectId, true)).toBe(restored);
  });
  test('invalid sequence data is rejected before bigint arithmetic', () => {
    const current = snapshot('30');
    for (const value of ['-1', '1.5', 'not-a-number', '9223372036854775808']) expect(chooseSnapshot(current, snapshot(value), projectId)).toBe(current);
  });
  test('deduplicates replay and out-of-order events while scoping the project', () => {
    const gate = new ProjectEventGate(projectId, '10');
    expect(gate.receive(event('12'))).toBe(true);
    expect(gate.receive(event('11'))).toBe(false);
    expect(gate.receive(event('13', 'event-12'))).toBe(false);
    expect(gate.receive({ ...event('13'), projectId: otherProject })).toBe(false);
    expect(gate.receive(event('13'))).toBe(true);
    gate.advance('20'); expect(gate.receive(event('19'))).toBe(false);
    gate.reset('2'); expect(gate.receive(event('3'))).toBe(true);
  });
});

describe('original Tiled office asset contract', () => {
  const map = JSON.parse(readFileSync(new URL('../apps/web/public/office-map.json', import.meta.url), 'utf8'));
  test('all required layers and stable destinations exist with local procedural assets', () => {
    expect(map.orientation).toBe('orthogonal'); expect(map.tilewidth).toBe(32); expect(map.tileheight).toBe(32);
    const names = map.layers.map((layer: { name: string }) => layer.name);
    for (const name of ['floor', 'walls', 'furniture', 'collision', 'interactionPoints']) expect(names).toContain(name);
    const points = map.layers.find((layer: { name: string }) => layer.name === 'interactionPoints').objects;
    for (const name of ['desk:pm', 'desk:developer', 'desk:qa', 'owner', 'meeting', 'lounge:PM', 'lounge:DEVELOPER', 'lounge:QA']) expect(points.some((point: { name: string }) => point.name === name)).toBe(true);
    expect(map.tilesets.every((tileset: { image: string }) => !/^https?:\/\//.test(tileset.image))).toBe(true);
  });
  test('every staff destination is reachable without crossing collision furniture', () => {
    const blocked: number[] = map.layers.find((layer: { name: string }) => layer.name === 'collision').data;
    const points: { x: number; y: number }[] = map.layers.find((layer: { name: string }) => layer.name === 'interactionPoints').objects;
    const cell = (point: { x: number; y: number }) => Math.floor(point.y / map.tileheight) * map.width + Math.floor(point.x / map.tilewidth);
    const destinations = points.map(cell);
    expect(destinations.every(index => blocked[index] === 0)).toBe(true);
    const reached = new Set<number>([destinations[0]]), queue = [destinations[0]];
    for (let offset = 0; offset < queue.length; offset++) {
      const index = queue[offset], x = index % map.width, y = Math.floor(index / map.width);
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nextX = x + dx, nextY = y + dy, next = nextY * map.width + nextX;
        if (nextX >= 0 && nextX < map.width && nextY >= 0 && nextY < map.height && blocked[next] === 0 && !reached.has(next)) { reached.add(next); queue.push(next); }
      }
    }
    expect(destinations.every(index => reached.has(index))).toBe(true);
  });
});
