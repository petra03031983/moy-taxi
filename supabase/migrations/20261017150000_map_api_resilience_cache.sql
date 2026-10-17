CREATE TABLE IF NOT EXISTS public.map_api_cache (
  cache_key text PRIMARY KEY,
  cache_kind text NOT NULL,
  response jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.map_api_cache ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.map_api_cache FROM anon, authenticated;
GRANT ALL ON TABLE public.map_api_cache TO service_role;

CREATE INDEX IF NOT EXISTS map_api_cache_expires_at_idx
  ON public.map_api_cache (expires_at);

CREATE INDEX IF NOT EXISTS map_api_cache_kind_expires_at_idx
  ON public.map_api_cache (cache_kind, expires_at);