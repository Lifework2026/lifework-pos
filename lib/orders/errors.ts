/** Business-rule failure with an HTTP status and a stable error code for the client. */
export class OrderError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "OrderError";
  }
}
