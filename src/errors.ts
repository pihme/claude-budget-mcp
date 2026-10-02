/**
 * Error codes map 1:1 to the error table in the spec. Messages are meant to be
 * shown to the agent / user verbatim and must never contain tokens.
 */
export type BudgetErrorCode =
  | "NOT_LOGGED_IN"
  | "AUTH_SHAPE_UNEXPECTED"
  | "SESSION_EXPIRED"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "REQUEST_FAILED"
  | "SHAPE_CHANGED";

export class BudgetError extends Error {
  readonly code: BudgetErrorCode;
  readonly status: number | null;

  constructor(code: BudgetErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = "BudgetError";
    this.code = code;
    this.status = status;
  }
}

export const LOGIN_HINT = "Run `claude` and sign in with `/login` (claude.ai subscription).";
export const REFRESH_HINT =
  "Use Claude Code once (it refreshes its own token) or run `/login`, then try again. This server never refreshes tokens.";
