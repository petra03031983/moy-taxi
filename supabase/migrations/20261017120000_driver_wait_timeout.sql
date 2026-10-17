ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS arrived_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

-- Give orders already waiting at migration time a fresh ten-minute window.
UPDATE public.orders
SET arrived_at = now()
WHERE status IN ('arrived', 'client_ready')
  AND arrived_at IS NULL;

CREATE INDEX IF NOT EXISTS orders_driver_waiting_idx
  ON public.orders (driver_id, arrived_at)
  WHERE status IN ('arrived', 'client_ready') AND driver_id IS NOT NULL;
