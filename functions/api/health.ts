/**
 * GET /api/health — simple health check (no auth required)
 */
export const onRequestGet: PagesFunction = async () => {
  return new Response(JSON.stringify({ status: 'ok', service: 'relay.cocy.io' }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
