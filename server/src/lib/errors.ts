export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'error', public details?: unknown) {
    super(message);
  }
}
export const badRequest = (m: string, d?: unknown) => new HttpError(400, m, 'bad_request', d);
export const notFound = (m = 'Not found') => new HttpError(404, m, 'not_found');
export const conflict = (m: string) => new HttpError(409, m, 'conflict');
export const forbidden = (m = 'Forbidden') => new HttpError(403, m, 'forbidden');
export const unauthorized = (m = 'Not signed in') => new HttpError(401, m, 'unauthorized');
