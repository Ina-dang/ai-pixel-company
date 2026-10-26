import { expect, test, vi } from 'vitest';
import { IntegrationError, containsSecret, slackConfig } from '../packages/integrations/src/index';
import { SlackSocketReceiver, type SocketClient } from '../apps/api/src/slack-socket';

class Client implements SocketClient {
  handlers = new Map<string, (value: unknown) => void>();
  start = vi.fn(async () => { this.emit('connected'); });
  disconnect = vi.fn(async () => { this.emit('disconnected'); });
  on(event: string, handler: (value: unknown) => void) { this.handlers.set(event, handler); }
  emit(event: string, value?: unknown) { this.handlers.get(event)?.(value); }
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const event = (ack: (payload?: unknown) => Promise<void> = vi.fn(async () => undefined), type = 'slash_commands') => ({ envelope_id: 'envelope-12345678', type, body: { command: '/ai-pixel', text: '상태' }, ack });

test('empty arguments are acknowledged as the default status query after persistence', async () => {
  const client = new Client(), ack = vi.fn(async (_payload?: unknown) => undefined);
  const receiver = new SlackSocketReceiver('secret', async () => undefined, undefined, () => client);
  client.emit('slack_event', { ...event(ack), body: { command: '/ai-pixel', text: '' } }); await settle();
  expect(ack).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('추가 인수가 없어 기본 상태 조회') }));
  await receiver.stop();
});
test('ACK follows durable intake; receiver exposes only safe health and reconnects', async () => {
  const client = new Client(), order: string[] = [], receive = vi.fn(async () => { order.push('persist'); });
  const receiver = new SlackSocketReceiver('never-log-token', receive, undefined, () => client); receiver.start(); await settle();
  expect(receiver.health().state).toBe('CONNECTED'); const ack = vi.fn(async () => { order.push('ack'); });
  client.emit('slack_event', event(ack)); await settle(); expect(order).toEqual(['persist', 'ack']); expect(receive).toHaveBeenCalledWith('envelope-12345678', { command: '/ai-pixel', text: '상태' });
  expect(receiver.health().lastReceivedAt).not.toBeNull(); expect(JSON.stringify(receiver.health())).not.toContain('never-log-token');
  client.emit('reconnecting'); expect(receiver.health()).toMatchObject({ state: 'RECONNECTING', reconnects: 1 });
  client.emit('connected'); expect(receiver.health().state).toBe('CONNECTED'); await receiver.stop();
  expect(receiver.health().state).toBe('STOPPED'); client.emit('slack_event', event()); await settle(); expect(receive).toHaveBeenCalledTimes(1);
});
test('failed database persistence is not ACKed; invalid scope is rejected without intake success', async () => {
  for (const error of [new Error('private database detail'), new IntegrationError('SLACK_MAPPING_DENIED', 403)]) {
    const client = new Client(), ack = vi.fn(async () => undefined);
    const receiver = new SlackSocketReceiver('secret', async () => { throw error; }, undefined, () => client);
    client.emit('slack_event', event(ack)); await settle();
    expect(ack).toHaveBeenCalledTimes(error instanceof IntegrationError ? 1 : 0);
    expect(receiver.health().lastReceivedAt).toBeNull(); expect(JSON.stringify(receiver.health())).not.toContain('private database'); await receiver.stop();
  }
});
test('unsupported payload types never become commands and oversized payloads are denied', async () => {
  const client = new Client(), receive = vi.fn(async () => undefined), ack = vi.fn(async () => undefined);
  const receiver = new SlackSocketReceiver('secret', receive, undefined, () => client);
  client.emit('slack_event', event(ack, 'interactive')); await settle(); expect(ack).toHaveBeenCalledOnce(); expect(receive).not.toHaveBeenCalled();
  client.emit('slack_event', { ...event(ack), body: { text: 'x'.repeat(262_145) } }); await settle(); expect(receive).not.toHaveBeenCalled(); await receiver.stop();
});
test('late connect after stop cannot reopen intake and failed start reports no raw error', async () => {
  const client = new Client(); client.start.mockImplementationOnce(async () => { throw new Error('xapp-sensitive'); });
  const receiver = new SlackSocketReceiver('secret', async () => undefined, undefined, () => client); receiver.start(); await settle();
  expect(receiver.health()).toMatchObject({ state: 'ERROR', errorCode: 'SOCKET_START_FAILED' }); await receiver.stop(); client.emit('connected'); expect(receiver.health().state).toBe('STOPPED');
});
test('app tokens are secrets and Socket configuration requires a pinned app', () => {
  expect(containsSecret(`xapp-${'a'.repeat(30)}`)).toBe(true);
  const config = { teamId: 'T123', channelId: 'C123', userMappings: {}, mode: 'SOCKET', appId: 'A123' };
  expect(slackConfig(config).mode).toBe('SOCKET'); expect(() => slackConfig({ ...config, appId: undefined })).toThrow(); expect(() => slackConfig({ ...config, mode: 'unknown' })).toThrow();
});

test('reconnect request rejection is caught, backed off and cancelled on stop', async () => {
  vi.useFakeTimers();
  try {
    const client = new Client(), receiver = new SlackSocketReceiver('secret', async () => undefined, undefined, () => client);
    receiver.start(); await vi.advanceTimersByTimeAsync(0);
    client.start.mockImplementationOnce(async () => { throw new Error('private fetch failed'); });
    client.emit('disconnected'); client.emit('disconnected');
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.start).toHaveBeenCalledTimes(2); expect(receiver.health()).toMatchObject({ state: 'RECONNECTING', errorCode: 'SOCKET_RECONNECT_FAILED' });
    expect(JSON.stringify(receiver.health())).not.toContain('private fetch');
    await vi.advanceTimersByTimeAsync(1999); expect(client.start).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect(client.start).toHaveBeenCalledTimes(3); expect(receiver.health().state).toBe('CONNECTED');
    client.emit('disconnected'); await receiver.stop(); await vi.advanceTimersByTimeAsync(60_000);
    expect(client.start).toHaveBeenCalledTimes(3); expect(receiver.health().state).toBe('STOPPED');
  } finally { vi.useRealTimers(); }
});
