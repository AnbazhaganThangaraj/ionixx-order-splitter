import { type DomainError, OrderNotExecutableError, OrderNotFoundError } from '../domain/errors';
import { AppError } from './app-error';

/** Presents a domain error as an API error. Unknown domain errors fall through to a 500. */
export const toAppError = (error: DomainError): AppError | undefined => {
  if (error instanceof OrderNotFoundError) {
    return new AppError(404, 'NOT_FOUND', error.message);
  }
  if (error instanceof OrderNotExecutableError) {
    return new AppError(
      422,
      'ORDER_NOT_EXECUTABLE',
      error.message,
      error.lineProblems.map(({ index, message }) => ({ path: `portfolio[${index}]`, message })),
    );
  }
  return undefined;
};
