/** Defines safe application errors and the single JSON error-response boundary. */
import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: Record<string, string>) {
    super(message);
  }
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  let failure: AppError;
  if (error instanceof AppError) failure = error;
  else if (error instanceof ZodError) {
    failure = new AppError(400, 'INVALID_INPUT', 'Check the submitted fields.',
      Object.fromEntries(error.issues.map(issue => [issue.path.join('.'), issue.message])));
  } else if (error?.code === 'SQLITE_BUSY') {
    failure = new AppError(503, 'DATABASE_BUSY', 'The database is busy. Retry this request.');
  } else if (error?.type === 'entity.parse.failed') {
    failure = new AppError(400, 'INVALID_INPUT', 'Send a valid JSON request.');
  } else if (error?.type === 'entity.too.large') {
    failure = new AppError(413, 'INVALID_INPUT', 'The request is too large.');
  } else {
    failure = new AppError(500, 'INTERNAL_ERROR', 'The request could not be completed.');
  }
  res.locals.errorCode = failure.code;
  res.status(failure.status).json({ error: {
    code: failure.code, message: failure.message, requestId: res.locals.requestId,
    ...(failure.fields ? { fields: failure.fields } : {}),
  } });
};
