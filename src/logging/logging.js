/** Emit JSON strings without letting diagnostics interrupt tracker operations. */
export function createLogger(
  operation,
  {
    now = () => Date.now(),
    executionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    sink = (record) => console.log(record),
  } = {},
) {
  return (event, details = {}, level = 'info') => {
    try {
      sink(
        JSON.stringify({
          timestamp: new Date(now()).toISOString(),
          executionId,
          operation,
          level,
          event,
          details,
        }),
      );
    } catch {
      // Execution logs are best effort; sheet writes and lock release must still run.
    }
  };
}

export function observeOperation(operation, action) {
  const log = createLogger(operation);
  const started = Date.now();
  log('operation.started');
  try {
    const result = action(log);
    log('operation.completed', { durationMs: Date.now() - started, ...result });
    return result;
  } catch (error) {
    log('operation.failed', { durationMs: Date.now() - started, error: error.message }, 'error');
    throw error;
  }
}

export function emit(io, event, details = {}, level = 'info') {
  try {
    io.log?.(event, details, level);
  } catch {
    /* Optional observers cannot change results. */
  }
}
