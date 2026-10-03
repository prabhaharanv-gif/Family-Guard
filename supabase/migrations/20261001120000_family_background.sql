-- Family background: the picture shown behind the Family page.
--
-- A family describes who is in it (a type and an optional age for each person) and picks
-- a scene; the app draws the picture from that. Only that description is stored, no
-- names. It sits on the family row, so every member's phone draws the same picture, and
-- only a family admin can change it (the same rule as renaming the family).

alter table public.families add column if not exists background jsonb;

create or replace function public.set_family_background(p_family_id uuid, p_background jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid     uuid := auth.uid();
  v_scene   text;
  v_members jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;
  if not is_family_admin(p_family_id) then
    raise exception 'Only admins can change the family background' using errcode = 'PGRST301';
  end if;

  -- null (or JSON null) clears it: the Family page goes back to its plain look.
  if p_background is null or jsonb_typeof(p_background) <> 'object' then
    update families set background = null where id = p_family_id;
    return;
  end if;

  v_scene := p_background->>'scene';
  if v_scene is null or v_scene not in ('sunset', 'home', 'garden', 'park') then
    raise exception 'Unknown scene' using errcode = '22023';
  end if;

  if jsonb_typeof(p_background->'members') <> 'array'
     or jsonb_array_length(p_background->'members') not between 1 and 10 then
    raise exception 'Between 1 and 10 family members are needed' using errcode = '22023';
  end if;

  -- Rebuild the list from known fields only, so nothing else can be stored through here.
  select jsonb_agg(
           jsonb_build_object(
             'type', m->>'type',
             'age',  case when m->>'age' is null then null else (m->>'age')::int end
           )
         )
    into v_members
    from jsonb_array_elements(p_background->'members') as m
   where m->>'type' in ('father', 'mother', 'adultMale', 'adultFemale', 'boy', 'girl')
     and (m->>'age' is null or (m->>'age' ~ '^[0-9]{1,2}$'));

  if v_members is null or jsonb_array_length(v_members) <> jsonb_array_length(p_background->'members') then
    raise exception 'Invalid family member' using errcode = '22023';
  end if;

  update families
     set background = jsonb_build_object('v', 1, 'scene', v_scene, 'members', v_members)
   where id = p_family_id;
end;
$function$;

revoke execute on function public.set_family_background(uuid, jsonb) from public, anon;
grant  execute on function public.set_family_background(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
