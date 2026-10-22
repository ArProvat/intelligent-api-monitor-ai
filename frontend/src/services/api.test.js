import { afterEach, expect, test, vi } from 'vitest';
import { api } from './api.js';

afterEach(() => vi.restoreAllMocks());

test('a non-JSON proxy failure clearly reports backend unavailability', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 502, headers: { 'Content-Type': 'text/plain' } }));
  await expect(api.health()).rejects.toMatchObject({
    message: 'Backend unavailable. Check that the server is running and try Refresh.',
    status: 502
  });
});
