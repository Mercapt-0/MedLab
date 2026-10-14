class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (msg, details) => new AppError(400, 'BAD_REQUEST', msg, details);
const unauthorized = (msg = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', msg);
const forbidden = (msg = 'You do not have access to this resource') => new AppError(403, 'FORBIDDEN', msg);
const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
const conflict = (msg, details) => new AppError(409, 'CONFLICT', msg, details);

class InvalidTransitionError extends AppError {
  constructor(entity, from, to, reason) {
    super(
      409,
      'INVALID_TRANSITION',
      reason || `Invalid ${entity} transition: ${from} -> ${to}`,
      { entity, from, to }
    );
  }
}

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict, InvalidTransitionError };
