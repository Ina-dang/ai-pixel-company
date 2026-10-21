import { LogLevel, SocketModeClient, type Logger } from '@slack/socket-mode';
import { IntegrationError } from '@ai-pixel/integrations';

export type SocketHealth = { state: 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'STOPPED' | 'ERROR'; connectedAt: string | null; lastReceivedAt: string | null; errorCode: string | null; reconnects: number };
export type SocketClient = { on(event: string, listener: (value: unknown) => void): unknown; start(): Promise<unknown>; disconnect(): Promise<void> };
export type SocketFactory = (token: string) => SocketClient;
// SDK debug messages can contain credentials, WebSocket URLs and raw payloads.
const quietLogger: Logger = { debug() {}, info() {}, warn() {}, error() {}, getLevel: () => LogLevel.ERROR, setLevel() {}, setName() {} };
// Own the retry promise: SDK 3.1.0's automatic close handler does not catch a
// rejected apps.connections.open request during reconnect.
export const socketFactory: SocketFactory = token => new SocketModeClient({ appToken: token, logger: quietLogger, autoReconnectEnabled: false,
  clientOptions: { retryConfig: { retries: 2 }, timeout: 10_000, rejectRateLimitedCalls: true }, pingPongLoggingEnabled: false });

export class SlackSocketReceiver {
  private client: SocketClient;
  private stopped = false;
  private active = 0;
  private starting = false;
  private connectedOnce = false;
  private retryAttempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private state: SocketHealth = { state: 'CONNECTING', connectedAt: null, lastReceivedAt: null, errorCode: null, reconnects: 0 };
  constructor(token: string, private receive: (envelope: string, body: Record<string, unknown>) => Promise<unknown>, private changed: () => void = () => undefined, factory: SocketFactory = socketFactory) {
    this.client = factory(token);
    this.client.on('connecting', () => this.update({ state: 'CONNECTING' }));
    this.client.on('connected', () => { if (this.stopped) return; this.connectedOnce = true; this.retryAttempt = 0; this.update({ state: 'CONNECTED', connectedAt: new Date().toISOString(), errorCode: null }); });
    this.client.on('reconnecting', () => this.update({ state: 'RECONNECTING', reconnects: this.state.reconnects + 1 }));
    this.client.on('disconnected', () => { this.update({ state: this.stopped ? 'STOPPED' : 'RECONNECTING' }); if (this.connectedOnce) this.retry(); });
    this.client.on('error', () => this.update({ errorCode: 'SOCKET_CONNECTION_ERROR' }));
    this.client.on('slack_event', value => { void this.envelope(value); });
  }
  health() { return { ...this.state }; }
  private update(change: Partial<SocketHealth>) { if (this.stopped && change.state !== 'STOPPED') return; this.state = { ...this.state, ...change }; this.changed(); }
  private retry() {
    if (this.stopped || this.retryTimer) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.retryAttempt++, 5));
    this.retryTimer = setTimeout(() => { this.retryTimer = null; this.update({ state: 'RECONNECTING', reconnects: this.state.reconnects + 1 }); this.start(); }, delay);
    this.retryTimer.unref();
  }
  start() {
    if (this.stopped || this.starting) return; this.starting = true;
    void this.client.start().then(async () => { if (this.stopped) await this.client.disconnect(); }).catch(() => {
      this.update({ state: this.connectedOnce ? 'RECONNECTING' : 'ERROR', errorCode: this.connectedOnce ? 'SOCKET_RECONNECT_FAILED' : 'SOCKET_START_FAILED' });
      if (this.connectedOnce) this.retry();
    }).finally(() => { this.starting = false; });
  }
  async stop() { this.stopped = true; if (this.retryTimer) clearTimeout(this.retryTimer); this.retryTimer = null; await this.client.disconnect().catch(() => undefined); this.update({ state: 'STOPPED' }); }
  private async envelope(value: unknown) {
    if (this.stopped || !value || typeof value !== 'object') return;
    const event = value as { envelope_id?: unknown; type?: unknown; body?: unknown; ack?: unknown };
    if (typeof event.ack !== 'function' || typeof event.envelope_id !== 'string' || !/^[A-Za-z0-9-]{8,100}$/.test(event.envelope_id)) return;
    const ack = event.ack as (payload?: unknown) => Promise<void>;
    if (event.type !== 'slash_commands') { await ack().catch(() => undefined); return; }
    if (this.active >= 16) return; // No ACK: Slack may retry; no unbounded local queue.
    this.active += 1;
    try {
      if (!event.body || typeof event.body !== 'object' || Array.isArray(event.body) || Buffer.byteLength(JSON.stringify(event.body)) > 262_144) throw new IntegrationError('PAYLOAD_INVALID');
      await this.receive(event.envelope_id, event.body as Record<string, unknown>);
      // Receipt is durable before ACK. Task creation and channel reply are queued.
      await ack({ response_type: 'ephemeral', text: '접수했습니다. 처리 결과와 업무 상세 링크를 지정 채널로 보냅니다. 자동 실행·수락·merge·배포는 하지 않습니다.' });
      this.update({ lastReceivedAt: new Date().toISOString(), errorCode: null });
    } catch (error) {
      const denied = error instanceof IntegrationError && error.status < 500;
      this.update({ errorCode: denied ? (error as IntegrationError).code : 'SOCKET_INBOX_UNAVAILABLE' });
      // Reject invalid scopes explicitly; do not ACK failed database persistence.
      if (denied) await ack({ response_type: 'ephemeral', text: '명령을 거부했습니다. 지정 채널·연결된 Owner·지원 명령을 확인하세요. 업무는 자동 실행하지 않습니다.' }).catch(() => undefined);
    } finally { this.active -= 1; }
  }
}
