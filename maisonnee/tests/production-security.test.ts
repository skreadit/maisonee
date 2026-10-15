import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertSameOrigin, rateLimit, requestAddress, sessionCookie } from '../src/lib/auth';
import { query } from '../src/lib/db';
import { POST as paymentPost } from '../src/app/api/payments/[...path]/route';

afterEach(() => vi.unstubAllEnvs());

function production() {
  vi.stubEnv('APP_MODE', 'production');
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('APP_URL', 'https://maisonnee.example');
}

describe('production security boundaries', () => {
  it('accepts only the configured origin, independently of the request Host', () => {
    production();
    expect(() => assertSameOrigin(new Request('https://maisonnee.example/api', { headers: { origin: 'https://maisonnee.example' } }))).not.toThrow();
    for (const origin of ['https://attacker.example', 'http://localhost:3000', 'null', 'https://maisonnee.example.attacker.example']) {
      expect(() => assertSameOrigin(new Request(`${origin === 'null' ? 'https://attacker.example' : origin}/api`, { headers: { origin } }))).toThrow();
    }
    expect(() => assertSameOrigin(new Request('https://maisonnee.example/api', { headers: { origin: 'https://maisonnee.example', 'sec-fetch-site': 'cross-site' } }))).toThrow();
    expect(() => assertSameOrigin(new Request('https://maisonnee.example/api'))).toThrow();
  });

  it('secures login and deletion cookies in production', () => {
    production();
    expect(sessionCookie('opaque-session')).toContain('HttpOnly; SameSite=Lax; Max-Age=604800; Secure');
    expect(sessionCookie('')).toContain('Max-Age=0; Secure');
    vi.stubEnv('APP_URL', undefined);
    expect(sessionCookie('opaque-session')).toContain('; Secure');
  });

  it('requires a strong production rate-limit secret before accessing the database', async () => {
    production();
    for (const secret of [undefined, '', 'short-secret']) {
      vi.stubEnv('AUTH_SECRET', secret);
      await expect(rateLimit('login:test', 10, 60)).rejects.toMatchObject({ status: 503 });
    }
  });

  it('never falls back to an embedded demo database in production', async () => {
    production();
    vi.stubEnv('DATABASE_URL', undefined);
    await expect(query('SELECT 1')).rejects.toThrow('DATABASE_URL obligatoire');
  });

  it('ignores forwarded client identity unless the reverse proxy is trusted', () => {
    const request = new Request('https://maisonnee.example/api', { headers: { 'x-forwarded-for': '198.51.100.12, 192.0.2.7' } });
    vi.stubEnv('TRUST_PROXY', undefined);
    expect(requestAddress(request)).toBe('shared');
    vi.stubEnv('TRUST_PROXY', 'true');
    expect(requestAddress(request)).toBe('198.51.100.12');
  });

  it('rejects payment mutations without same-origin authenticated sessions', async () => {
    production();
    for (const route of ['checkout', 'connect', 'refund']) {
      const context = { params: Promise.resolve({ path: [route] }) };
      const unauthenticated = await paymentPost(new Request('https://maisonnee.example/api/payments/' + route, { method: 'POST', headers: { origin: 'https://maisonnee.example', 'content-type': 'application/json' }, body: '{}' }), context);
      expect(unauthenticated.status).toBe(401);
      const crossSite = await paymentPost(new Request('https://maisonnee.example/api/payments/' + route, { method: 'POST', headers: { origin: 'https://attacker.example', 'content-type': 'application/json' }, body: '{}' }), context);
      expect(crossSite.status).toBe(403);
    }
  });
});
