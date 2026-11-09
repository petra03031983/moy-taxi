create or replace function public.astana_guide_delete_manual_object(
  p_access_key text,
  p_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted_id uuid;
begin
  if not public.astana_guide_check_key(coalesce(p_access_key, '')) then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;

  if p_id is null then
    raise exception 'Manual road object ID is required' using errcode = '22023';
  end if;

  delete from public.road_manual_objects m
  where m.id = p_id
    and m.source = 'manual-user'
  returning m.id into v_deleted_id;

  if v_deleted_id is null then
    return jsonb_build_object(
      'ok', false,
      'deleted', false,
      'message', 'Manual road object was not found.'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'deleted', true,
    'id', v_deleted_id
  );
end;
$$;

revoke all on function public.astana_guide_delete_manual_object(text, uuid) from public;
grant execute on function public.astana_guide_delete_manual_object(text, uuid) to anon, authenticated;
