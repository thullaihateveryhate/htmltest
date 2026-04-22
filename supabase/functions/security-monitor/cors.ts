export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function buildCorsHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({
    ...corsHeaders,
    ...extra,
  });
}
