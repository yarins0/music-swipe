import { PlatformError, PlatformErrorCode, LIKED_SONGS_PLAYLIST_ID } from '../interface';

describe('PlatformError', () => {
  it('sets code as a readable property', () => {
    const err = new PlatformError(PlatformErrorCode.AUTH_EXPIRED);
    expect(err.code).toBe(PlatformErrorCode.AUTH_EXPIRED);
  });

  it('extends Error', () => {
    const err = new PlatformError(PlatformErrorCode.NOT_FOUND);
    expect(err).toBeInstanceOf(Error);
  });

  it('sets name to PlatformError', () => {
    const err = new PlatformError(PlatformErrorCode.RATE_LIMITED);
    expect(err.name).toBe('PlatformError');
  });

  it('uses code as message when no message provided', () => {
    const err = new PlatformError(PlatformErrorCode.UNKNOWN);
    expect(err.message).toBe('UNKNOWN');
  });

  it('uses provided message when given', () => {
    const err = new PlatformError(PlatformErrorCode.RATE_LIMITED, 'Too many requests');
    expect(err.message).toBe('Too many requests');
  });
});

describe('LIKED_SONGS_PLAYLIST_ID', () => {
  it('is the correct Spotify collection tracks URI', () => {
    expect(LIKED_SONGS_PLAYLIST_ID).toBe('spotify:collection:tracks');
  });
});
