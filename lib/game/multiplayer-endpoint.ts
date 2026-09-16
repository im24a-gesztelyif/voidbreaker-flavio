/**
 * The Vercel build exposes this public value to the browser. It deliberately
 * has no default: local development and old deployments keep using PeerJS
 * until the Cloudflare room client is enabled.
 */
export const cloudflareMultiplayerUrl = () => {
  const value = process.env.NEXT_PUBLIC_MULTIPLAYER_URL?.trim() || '';
  return /^wss:\/\/[^/]+(?:\/.*)?$/i.test(value) ? value.replace(/\/$/, '') : '';
};
