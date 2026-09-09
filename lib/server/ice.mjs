import {
  STUN_SERVERS,
  normalizeIceServers,
  hasRelay,
} from '../network/ice.mjs';

// Vercel calls this only when a pilot creates/joins a room. Gameplay stays WebRTC.
export async function iceResponse(
  request,
  env = process.env,
  providerFetch = fetch,
) {
  const headers = {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (request.method !== 'GET')
    return new Response(null, {
      status: 405,
      headers: { ...headers, Allow: 'GET' },
    });
  const origin = request.headers.get('origin');
  if (
    request.headers.get('sec-fetch-site') === 'cross-site' ||
    (origin && origin !== new URL(request.url).origin)
  )
    return new Response(null, { status: 403, headers });

  let issue = 'not-configured';
  try {
    let value;
    if (env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN) {
      const response = await providerFetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ttl: 7200 }),
          signal: AbortSignal.timeout(7000),
        },
      );
      if (!response.ok) throw new Error('Relay provider unavailable');
      value = (await response.json()).iceServers;
    } else if (env.TURN_CREDENTIALS_URL) {
      // Metered/OpenRelay credential URL, stored only in server environment.
      const url = new URL(env.TURN_CREDENTIALS_URL);
      if (url.protocol !== 'https:') throw new Error('HTTPS required');
      const response = await providerFetch(url, {
        signal: AbortSignal.timeout(7000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error('Relay provider unavailable');
      const body = await response.json();
      value = Array.isArray(body) ? body : body.iceServers;
    } else if (env.TURN_ICE_SERVERS) {
      // For a self-managed TURN server; use limited client credentials, not its admin secret.
      value = JSON.parse(env.TURN_ICE_SERVERS);
    } else if (env.TURN_KEY_ID || env.TURN_KEY_API_TOKEN) {
      throw new Error('Incomplete relay configuration');
    }
    if (value !== undefined) {
      const servers = normalizeIceServers(value);
      if (!hasRelay(servers)) throw new Error('No usable relay');
      return Response.json(
        { iceServers: [...STUN_SERVERS, ...servers], relayAvailable: true },
        { headers },
      );
    }
  } catch {
    // Never return/log provider URLs, admin tokens, or raw provider error bodies.
    issue = 'unavailable';
  }
  return Response.json(
    { iceServers: STUN_SERVERS, relayAvailable: false, issue },
    { headers },
  );
}
