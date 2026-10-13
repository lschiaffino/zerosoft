/**
 * Error de un paso de Flow: `code` es lo que se muestra (y se traduce en el
 * editor si existe flow.stepErrors.<code>); `retryable` habilita los
 * reintentos del nodo; `output` queda como salida del paso fallido.
 */
export class StepError extends Error {
  constructor(
    public code: string,
    public retryable = false,
    public output?: unknown,
  ) {
    super(code);
  }
}
