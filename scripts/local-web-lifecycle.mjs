// Preload for the official Next CLI: keep its server in the supervisor's
// private IPC lifetime without exposing any HTTP shutdown endpoint.
if (process.connected) {
  let stopping = false;
  const stop = () => {
    if (stopping) return; stopping = true;
    setTimeout(() => process.exit(0), 5000).unref();
    if (process.listenerCount('SIGTERM') > 0) process.emit('SIGTERM');
    else process.exit(0);
  };
  process.on('disconnect', stop);
  process.on('message', message => { if (message && typeof message === 'object' && message.type === 'ai-pixel.shutdown') stop(); });
}
