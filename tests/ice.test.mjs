import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from '../api/ice.mjs';
import { iceResponse } from '../lib/server/ice.mjs';
import { normalizeIceServers } from '../lib/network/ice.mjs';

const request = () => new Request('https://voidbreaker.example/api/ice');
const server = {
  urls: ['turns:relay.example:443?transport=tcp'],
  username: 'short-lived-user',
  credential: 'short-lived-password',
};

void test('unconfigured deployments report the missing relay explicitly without broken public TURN defaults', async () => {
  const response = await iceResponse(request(), {});
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  const body = await response.json();
  assert.equal(body.relayAvailable, false);
  assert.equal(body.issue, 'not-configured');
  assert.ok(body.iceServers.every((s) => s.urls.startsWith('stun:')));
  assert.equal(typeof handler.fetch, 'function');
});

void test('Cloudflare credentials are minted server-side and admin tokens never enter the response', async () => {
  const response = await iceResponse(
    request(),
    { TURN_KEY_ID: 'key/id', TURN_KEY_API_TOKEN: 'admin-secret' },
    async (url, options) => {
      assert.match(url, /key%2Fid\/credentials\/generate-ice-servers$/);
      assert.equal(options.headers.Authorization, 'Bearer admin-secret');
      assert.equal(options.method, 'POST');
      assert.equal(JSON.parse(options.body).ttl, 7200);
      return Response.json({ iceServers: [server], token: 'must-not-leak' });
    },
  );
  const text = await response.text();
  assert.ok(!text.includes('admin-secret'));
  assert.ok(!text.includes('must-not-leak'));
  assert.equal(JSON.parse(text).relayAvailable, true);
  assert.deepEqual(JSON.parse(text).iceServers.at(-1), server);
});

void test('Metered and self-managed ICE configurations pass only validated client credentials', async () => {
  const response = await iceResponse(
    request(),
    {
      TURN_CREDENTIALS_URL:
        'https://app.metered.live/api/v1/turn/credentials?apiKey=secret',
    },
    async () => Response.json([server]),
  );
  assert.equal((await response.json()).relayAvailable, true);
  const own = await iceResponse(request(), {
    TURN_ICE_SERVERS: JSON.stringify([server]),
  });
  assert.deepEqual((await own.json()).iceServers.at(-1), server);
  assert.deepEqual(
    normalizeIceServers([
      { urls: 'https://evil.example' },
      { urls: 'turn:relay.example' },
    ]),
    [],
  );
  for (const url of [
    'turn:host:garbage',
    'turns:host:443?transport=udp',
    'turn:host:99999',
    'turn:host:0',
  ])
    assert.deepEqual(normalizeIceServers([{ ...server, urls: url }]), []);
});

void test('provider errors, malformed data and partial configuration remain actionable without leaking secrets', async () => {
  for (const [env, fetcher] of [
    [{ TURN_KEY_ID: 'id' }, fetch],
    [{ TURN_ICE_SERVERS: 'broken' }, fetch],
    [{ TURN_CREDENTIALS_URL: 'http://insecure.example?apiKey=secret' }, fetch],
    [
      { TURN_CREDENTIALS_URL: 'https://provider.example?apiKey=secret' },
      async () => new Response('private diagnostic', { status: 401 }),
    ],
    [
      { TURN_CREDENTIALS_URL: 'https://provider.example' },
      async () => Response.json([]),
    ],
  ]) {
    const body = await (await iceResponse(request(), env, fetcher)).json();
    assert.equal(body.relayAvailable, false);
    assert.equal(body.issue, 'unavailable');
    assert.ok(!JSON.stringify(body).includes('secret'));
  }
});

void test('credential endpoint rejects cross-site requests and unsupported methods before calling the provider', async () => {
  const fetcher = () => {
    throw new Error('Provider must not run');
  };
  for (const [options, code] of [
    [{ method: 'POST' }, 405],
    [{ headers: { origin: 'https://other.example' } }, 403],
    [{ headers: { 'sec-fetch-site': 'cross-site' } }, 403],
  ])
    assert.equal(
      (await iceResponse(new Request(request(), options), {}, fetcher)).status,
      code,
    );
});
