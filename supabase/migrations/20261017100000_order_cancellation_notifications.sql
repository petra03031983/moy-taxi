ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

CREATE INDEX IF NOT EXISTS orders_driver_recent_cancellations_idx
  ON public.orders (driver_id, cancelled_at DESC)
  WHERE status = 'cancelled' AND driver_id IS NOT NULL;
