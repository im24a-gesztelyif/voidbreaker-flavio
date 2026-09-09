export const STUN_SERVERS = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
];

function validIceUrl(url) {
  if (typeof url !== 'string' || url.length > 512) return false;
  const match =
    /^(stun|stuns|turn|turns):(\[[a-fA-F0-9:.]+\]|[a-zA-Z0-9.-]+)(?::([0-9]{1,5}))?(?:\?transport=(udp|tcp))?$/.exec(
      url,
    );
  if (!match || (match[3] && (+match[3] < 1 || +match[3] > 65535)))
    return false;
  return !(match[1].endsWith('s') && match[4] === 'udp');
}

/** Only accept browser ICE configuration, never arbitrary provider response fields. */
export function normalizeIceServers(value) {
  if (!Array.isArray(value) || value.length > 16) return [];
  return value.flatMap((server) => {
    if (!server || typeof server !== 'object') return [];
    const urls = (Array.isArray(server.urls) ? server.urls : [server.urls])
      .slice(0, 16)
      .filter(validIceUrl);
    if (!urls.length) return [];
    const relay = urls.some((url) => /^turns?:/.test(url));
    if (
      relay &&
      (typeof server.username !== 'string' ||
        !server.username ||
        typeof server.credential !== 'string' ||
        !server.credential)
    )
      return [];
    return [
      {
        urls,
        ...(relay
          ? { username: server.username, credential: server.credential }
          : {}),
      },
    ];
  });
}

export function hasRelay(servers) {
  return servers.some((server) =>
    (Array.isArray(server.urls) ? server.urls : [server.urls]).some((url) =>
      /^turns?:/.test(url),
    ),
  );
}
