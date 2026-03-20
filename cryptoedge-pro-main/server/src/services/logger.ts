interface LogMeta { [key: string]: any; }

const LOG_LEVELS: Record<string, number> = { error: 0, warn: 1, info: 2, debug: 3 };
const LEVEL: number = LOG_LEVELS[process.env.LOG_LEVEL || "info"] ?? 2;

function fmt(level: string, msg: string, meta: LogMeta = {}): string {
  const ts = new Date().toISOString();
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  return `[${ts}] ${level.toUpperCase()} ${msg}${metaStr}`;
}

const logger = {
  error: (msg: string, meta?: LogMeta): void => { if (LEVEL >= 0) console.error(fmt("error", msg, meta)); },
  warn:  (msg: string, meta?: LogMeta): void => { if (LEVEL >= 1) console.warn(fmt("warn", msg, meta)); },
  info:  (msg: string, meta?: LogMeta): void => { if (LEVEL >= 2) console.log(fmt("info", msg, meta)); },
  debug: (msg: string, meta?: LogMeta): void => { if (LEVEL >= 3) console.log(fmt("debug", msg, meta)); },
};

export default logger;
