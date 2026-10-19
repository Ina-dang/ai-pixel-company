import { createServer } from 'node:http';
import { webhookRelay } from '../packages/integrations/src/ingress.js';

// Starting this server binds loopback only. A public tunnel requires separate Owner approval.
const [githubId, slackId] = process.argv.slice(2);
if (!githubId || !slackId) throw new Error('Usage: webhook-relay.ts <githubConnectionId> <slackConnectionId>');
const paths = new Set([`/api/webhooks/github/${githubId}`, `/api/webhooks/slack/${slackId}`]);
const server = createServer({ maxHeaderSize: 8192, headersTimeout: 5000, requestTimeout: 10_000 }, webhookRelay(paths));
server.maxConnections = 32;
server.listen(3002, '127.0.0.1', () => console.log(JSON.stringify({ loopback: 'http://127.0.0.1:3002', allowedPostPaths: [...paths], publicTunnelStarted: false })));
function stop() { server.close(); server.closeAllConnections(); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
