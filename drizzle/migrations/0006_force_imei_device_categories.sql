create or replace function public.force_device_serialized() returns trigger language plpgsql set search_path=public as $$
begin
  if new.name ~* '(mobile|phone|smartphone|tab|tablet|ipad|watch|মোবাইল|ফোন|ট্যাব)' then new.is_serialized := true; end if;
  return new;
end $$;
drop trigger if exists trg_force_device_serialized on public.categories;
create trigger trg_force_device_serialized before insert or update on public.categories
for each row execute function public.force_device_serialized();
update public.categories set is_serialized = true where name ~* '(mobile|phone|smartphone|tab|tablet|ipad|watch|মোবাইল|ফোন|ট্যাব)' and not is_serialized;