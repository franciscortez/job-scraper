export function locked(
  action,
  busy = () => {
    throw new Error('Another tracker operation is running. Try again shortly.');
  },
) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return busy();
  try {
    return action();
  } finally {
    lock.releaseLock();
  }
}

export function createIo(log) {
  return {
    log,
    now: () => Date.now(),
    sleep: (ms) => Utilities.sleep(ms),
    fetch: (url) => {
      const response = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        followRedirects: false,
      });
      return { status: response.getResponseCode(), body: response.getContentText() };
    },
  };
}
