import { iceResponse } from '../lib/server/ice.mjs';

const handler = { fetch: (request) => iceResponse(request) };
export default handler;
