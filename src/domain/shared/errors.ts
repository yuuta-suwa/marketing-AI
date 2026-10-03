export type DomainErrorCode =
  | "VALIDATION"
  | "ILLEGAL_TRANSITION"
  | "EVIDENCE_INTEGRITY"
  | "BUDGET_EXCEEDED"
  | "COMPLIANCE_BLOCKED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: DomainErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
