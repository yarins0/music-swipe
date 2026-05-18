import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth';

jest.mock('../../db/client', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
    },
  },
}));

const mockGetUser = (
  jest.requireMock('../../db/client') as { supabase: { auth: { getUser: jest.Mock } } }
).supabase.auth.getUser;

const makeReq = (authHeader?: string): Request =>
  ({
    headers: authHeader ? { authorization: authHeader } : {},
    userId: undefined,
  }) as unknown as Request;

const makeRes = (): Response => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const next: NextFunction = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('requireAuth', () => {
  it('returns 401 when Authorization header is absent', async () => {
    const req = makeReq();
    const res = makeRes();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing authorization token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when token is invalid or expired', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: new Error('Invalid JWT'),
    });
    const req = makeReq('Bearer bad-token');
    const res = makeRes();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() and sets req.userId when token is valid', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'supabase-user-123' } },
      error: null,
    });
    const req = makeReq('Bearer valid-token');
    const res = makeRes();

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((req as Request & { userId: string }).userId).toBe('supabase-user-123');
    expect(res.status).not.toHaveBeenCalled();
  });

  it('strips the Bearer prefix before passing token to supabase', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'uid' } },
      error: null,
    });
    const req = makeReq('Bearer my-token-value');
    const res = makeRes();

    await requireAuth(req, res, next);

    expect(mockGetUser).toHaveBeenCalledWith('my-token-value');
  });
});
