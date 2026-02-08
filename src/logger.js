function toErrorMeta(error) {
  if (!error) {
    return null;
  }

  return {
    name: error.name,
    message: error.message,
    stack: error.stack
  };
}

export function createLogger(scope) {
  function write(level, message, meta) {
    const payload = {
      ts: new Date().toISOString(),
      level,
      scope,
      message
    };

    if (meta !== undefined) {
      payload.meta = meta instanceof Error ? toErrorMeta(meta) : meta;
    }

    const line = JSON.stringify(payload);
    if (level === 'error') {
      console.error(line);
      return;
    }

    if (level === 'warn') {
      console.warn(line);
      return;
    }

    console.log(line);
  }

  return {
    info(message, meta) {
      write('info', message, meta);
    },
    warn(message, meta) {
      write('warn', message, meta);
    },
    error(message, meta) {
      write('error', message, meta);
    }
  };
}
