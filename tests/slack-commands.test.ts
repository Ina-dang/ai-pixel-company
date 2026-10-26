import { expect, test } from 'vitest';
import { parseSlackCommand } from '../apps/api/src/slack-commands';

test.each(['', ' ', '\t\n'])('empty Slack arguments use a marked read-only status default: %j', text => {
  expect(parseSlackCommand(text)).toEqual({ kind: 'STATUS', defaulted: true });
});

test.each(['상태', 'status', 'STATUS '])('explicit status arguments stay status without a default marker: %j', text => {
  expect(parseSlackCommand(text)).toEqual({ kind: 'STATUS' });
});

test('help remains explicit, task originals are preserved, and unsupported input is rejected', () => {
  for (const text of ['도움말', 'help']) expect(parseSlackCommand(text)).toEqual({ kind: 'HELP' });
  expect(parseSlackCommand('업무 제목  두 칸\n경로 확인')).toEqual({ kind: 'TASK', original: '제목  두 칸\n경로 확인' });
  for (const text of [undefined, 'merge approve all', `업무 xoxb-${'a'.repeat(30)}`]) expect(() => parseSlackCommand(text)).toThrow();
});
