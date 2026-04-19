/**
 * Standardized error envelope emitted by the API Gateway (RFC 7807-inspired).
 */
export interface ProblemDetails {
  type: string;         // URN or URL identifying the error class
  title: string;        // short summary
  status: number;       // HTTP status code
  detail?: string;      // human-readable details
  instance?: string;    // URI of the occurrence (request id / path)
  errors?: Array<{ path: string; message: string }>; // field-level errors
  correlationId?: string;
}

export const ErrorCodes = {
  VALIDATION: 'urn:netx:error:validation',
  UNAUTHORIZED: 'urn:netx:error:unauthorized',
  FORBIDDEN: 'urn:netx:error:forbidden',
  NOT_FOUND: 'urn:netx:error:not-found',
  CONFLICT: 'urn:netx:error:conflict',
  RATE_LIMITED: 'urn:netx:error:rate-limited',
  TENANT_NOT_RESOLVED: 'urn:netx:error:tenant-not-resolved',
  MFA_REQUIRED: 'urn:netx:error:mfa-required',
  INTERNAL: 'urn:netx:error:internal',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
