import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { GitHubAdapter, IntegrationError, LocalSecretStore, SlackAdapter, githubConfig, slackConfig } from '@ai-pixel/integrations';

// Explicit live credential probe. No message, Issue, PR, push or paid job is sent.
const secrets = new LocalSecretStore(process.cwd());
type Connection = { projectId: string; provider: 'GITHUB' | 'SLACK'; config: unknown; secretRefs: Record<string, string> };
let failures = 0;
try {
  const content = await readFile(resolve('.local/integrations.json'), 'utf8');
  if (content.length > 65_536) throw new IntegrationError('CONFIGURATION_INVALID');
  const parsed = JSON.parse(content) as { connections?: Connection[] };
  if (!Array.isArray(parsed.connections) || parsed.connections.length === 0) throw new IntegrationError('CREDENTIAL_UNCONFIGURED');
  for (const connection of parsed.connections) {
    try {
      if (connection.provider === 'GITHUB') {
        const config = githubConfig(connection.config);
        const adapter = new GitHubAdapter(config, await secrets.read(connection.secretRefs.privateKey));
        const repository = await adapter.repository();
        const headSha = await adapter.head(config.baseBranch);
        console.log(JSON.stringify({ provider: 'GITHUB', projectId: connection.projectId, verified: true, readOnly: true, repository, headSha }));
      } else if (connection.provider === 'SLACK') {
        const config = slackConfig(connection.config);
        const adapter = new SlackAdapter(config, await secrets.read(connection.secretRefs.botToken));
        const identity = await adapter.identity();
        console.log(JSON.stringify({ provider: 'SLACK', projectId: connection.projectId, verified: true, readOnly: true, identity, channelId: config.channelId, messageSent: false }));
      } else throw new IntegrationError('CONFIGURATION_INVALID');
    } catch (error) {
      failures += 1;
      console.log(JSON.stringify({ provider: connection.provider, projectId: connection.projectId, verified: false, code: error instanceof IntegrationError ? error.code : 'VERIFICATION_UNAVAILABLE' }));
    }
  }
} catch (error) {
  failures += 1;
  console.log(JSON.stringify({ verified: false, code: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'CREDENTIAL_UNCONFIGURED' : error instanceof IntegrationError ? error.code : 'CONFIGURATION_INVALID' }));
}
if (failures) process.exitCode = 2;
