/**
 * Structured JSON logger. Fields follow the observability contract:
 * research_run_id, connector, agent, duration_ms, result_count, token_count,
 * cost_usd, error, retry_count, status.
 */
export type LogFields = {
  research_run_id?: string;
  organization_id?: string;
  connector?: string;
  agent?: string;
  duration_ms?: number;
  result_count?: number;
  token_count?: number;
  cost_usd?: number;
  error?: string;
  retry_count?: number;
  status?: string;
  [key: string]: unknown;
};

export type Logger = {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
};

const REDACT = /(key|secret|token|password|authorization)/i;

function redact(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = REDACT.test(k) && k !== "token_count" ? "[redacted]" : v;
  }
  return out;
}

export function createLogger(base: LogFields = {}, sink: (line: string) => void = (l) => console.log(l)): Logger {
  const emit = (level: string, msg: string, fields?: LogFields) => {
    if (process.env.NODE_ENV === "test" && !process.env.MRO_LOG_IN_TESTS) return;
    sink(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...redact({ ...base, ...fields }) }));
  };
  return {
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (f) => createLogger({ ...base, ...f }, sink),
  };
}

export const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};
