-- Restrict direct API execution of trigger-only functions.
-- These functions remain attached to their database triggers.
-- The application server uses service_role for privileged backend operations.

REVOKE EXECUTE ON FUNCTION public.assign_driver_account_number()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_driver_account_number()
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.sync_screen_evidence_to_road_object()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_screen_evidence_to_road_object()
  TO service_role;
