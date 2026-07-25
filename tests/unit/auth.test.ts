import { describe, expect, it } from 'vitest';
import { credentialsSchema, OAUTH_PROVIDERS } from '@/lib/auth/schema';

describe('credentialsSchema', () => {
  it('accepts a valid email and 8+ char password', () => {
    const result = credentialsSchema.safeParse({ email: 'a@b.com', password: 'password1' });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid email', () => {
    const result = credentialsSchema.safeParse({ email: 'nope', password: 'password1' });
    expect(result.success).toBe(false);
  });

  it('rejects a short password', () => {
    const result = credentialsSchema.safeParse({ email: 'a@b.com', password: 'short' });
    expect(result.success).toBe(false);
  });
});

describe('OAUTH_PROVIDERS', () => {
  it('offers google and github', () => {
    expect([...OAUTH_PROVIDERS]).toEqual(['google', 'github']);
  });
});
