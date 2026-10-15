
create type public.business_type as enum ('retail','wholesale','both');
create type public.member_role as enum ('owner','manager','accountant','salesman','store_keeper','purchase_officer','branch_manager','viewer');
create type public.branch_kind as enum ('head','branch','warehouse');
create type public.customer_type as enum ('retail','retail_shop','wholesale_dealer','sub_dealer','corporate','vip');
create type public.price_level as enum ('retail','wholesale','dealer','special');
create type public.record_status as enum ('active','inactive');

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 120),
  type public.business_type not null,
  phone text, address text, trade_license text,
  currency text not null default 'BDT',
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create table public.business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null,
  role public.member_role not null,
  display_name text,
  created_at timestamptz not null default now(),
  unique (business_id, user_id)
);
create index on public.business_members(user_id);

create or replace function public.is_member(_biz uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from business_members where business_id=_biz and user_id=auth.uid()) $$;
create or replace function public.has_biz_role(_biz uuid, _roles public.member_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from business_members where business_id=_biz and user_id=auth.uid() and role = any(_roles)) $$;

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null, kind public.branch_kind not null default 'branch',
  address text, phone text,
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  unique (business_id, name)
);
create table public.brands (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null, created_at timestamptz not null default now(),
  unique (business_id, name)
);
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null, is_serialized boolean not null default false,
  created_at timestamptz not null default now(),
  unique (business_id, name)
);
create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete restrict,
  category_id uuid not null references public.categories(id) on delete restrict,
  model text not null,
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  unique (business_id, brand_id, model)
);
create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  sku text not null,
  ram text, storage text, color text,
  purchase_price numeric(14,2) not null default 0 check (purchase_price >= 0),
  wholesale_price numeric(14,2) not null default 0 check (wholesale_price >= 0),
  dealer_price numeric(14,2) not null default 0 check (dealer_price >= 0),
  retail_price numeric(14,2) not null default 0 check (retail_price >= 0),
  min_price numeric(14,2) not null default 0 check (min_price >= 0),
  reorder_level integer not null default 0 check (reorder_level >= 0),
  warranty_months integer not null default 0 check (warranty_months >= 0),
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  unique (business_id, sku)
);
create index on public.product_variants(product_id);
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null, business_name text,
  mobile text not null check (mobile ~ '^01[3-9][0-9]{8}$'),
  alt_mobile text, address text, nid text, trade_license text,
  type public.customer_type not null default 'retail',
  price_level public.price_level not null default 'retail',
  credit_limit numeric(14,2) not null default 0 check (credit_limit >= 0),
  payment_terms_days integer not null default 0,
  opening_balance numeric(14,2) not null default 0,
  status public.record_status not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  unique (business_id, mobile)
);
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null, company text, contact_person text,
  mobile text not null check (mobile ~ '^01[3-9][0-9]{8}$'),
  address text, bank_info text,
  opening_payable numeric(14,2) not null default 0,
  credit_terms_days integer not null default 0,
  status public.record_status not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  unique (business_id, mobile)
);
create table public.audit_logs (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid, module text not null, action text not null,
  record_id uuid, old_value jsonb, new_value jsonb,
  created_at timestamptz not null default now()
);
create index on public.audit_logs(business_id, created_at desc);

grant select, insert, update, delete on public.businesses, public.business_members, public.branches, public.brands, public.categories, public.products, public.product_variants, public.customers, public.suppliers to authenticated;
grant select on public.audit_logs to authenticated;
grant all on public.businesses, public.business_members, public.branches, public.brands, public.categories, public.products, public.product_variants, public.customers, public.suppliers, public.audit_logs to service_role;

alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.branches enable row level security;
alter table public.brands enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.customers enable row level security;
alter table public.suppliers enable row level security;
alter table public.audit_logs enable row level security;

create policy "members read business" on public.businesses for select to authenticated using (public.is_member(id));
create policy "owner updates business" on public.businesses for update to authenticated using (public.has_biz_role(id, array['owner']::public.member_role[]));

create policy "members read members" on public.business_members for select to authenticated using (public.is_member(business_id));
create policy "owner manages members" on public.business_members for all to authenticated
  using (public.has_biz_role(business_id, array['owner']::public.member_role[]))
  with check (public.has_biz_role(business_id, array['owner']::public.member_role[]));

create policy "members read branches" on public.branches for select to authenticated using (public.is_member(business_id));
create policy "admins write branches" on public.branches for all to authenticated
  using (public.has_biz_role(business_id, array['owner','manager']::public.member_role[]))
  with check (public.has_biz_role(business_id, array['owner','manager']::public.member_role[]));

do $$ declare t text; begin
  foreach t in array array['brands','categories','products','product_variants'] loop
    execute format('create policy "members read %1$s" on public.%1$s for select to authenticated using (public.is_member(business_id))', t);
    execute format('create policy "catalog write %1$s" on public.%1$s for all to authenticated using (public.has_biz_role(business_id, array[''owner'',''manager'',''store_keeper'',''purchase_officer'']::public.member_role[])) with check (public.has_biz_role(business_id, array[''owner'',''manager'',''store_keeper'',''purchase_officer'']::public.member_role[]))', t);
  end loop;
end $$;

create policy "members read customers" on public.customers for select to authenticated using (public.is_member(business_id));
create policy "sales staff write customers" on public.customers for insert to authenticated
  with check (public.has_biz_role(business_id, array['owner','manager','salesman','branch_manager','accountant']::public.member_role[]));
create policy "sales staff update customers" on public.customers for update to authenticated
  using (public.has_biz_role(business_id, array['owner','manager','salesman','branch_manager','accountant']::public.member_role[]));
create policy "admins delete customers" on public.customers for delete to authenticated
  using (public.has_biz_role(business_id, array['owner','manager']::public.member_role[]));

create policy "members read suppliers" on public.suppliers for select to authenticated using (public.is_member(business_id));
create policy "purchase staff write suppliers" on public.suppliers for insert to authenticated
  with check (public.has_biz_role(business_id, array['owner','manager','purchase_officer','accountant']::public.member_role[]));
create policy "purchase staff update suppliers" on public.suppliers for update to authenticated
  using (public.has_biz_role(business_id, array['owner','manager','purchase_officer','accountant']::public.member_role[]));
create policy "admins delete suppliers" on public.suppliers for delete to authenticated
  using (public.has_biz_role(business_id, array['owner','manager']::public.member_role[]));

create policy "admins read audit" on public.audit_logs for select to authenticated
  using (public.has_biz_role(business_id, array['owner','manager','accountant']::public.member_role[]));

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb := to_jsonb(coalesce(new, old));
begin
  insert into audit_logs(business_id, user_id, module, action, record_id, old_value, new_value)
  values ((r->>'business_id')::uuid, auth.uid(), tg_table_name, lower(tg_op), (r->>'id')::uuid,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
do $$ declare t text; begin
  foreach t in array array['branches','brands','categories','products','product_variants','customers','suppliers'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.audit_row()', t);
  end loop;
end $$;

create or replace function public.create_business(_name text, _type public.business_type, _phone text default null, _address text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare biz uuid; begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into businesses(name, type, phone, address, created_by) values (_name, _type, _phone, _address, auth.uid()) returning id into biz;
  insert into business_members(business_id, user_id, role, display_name) values (biz, auth.uid(), 'owner', 'Owner');
  insert into branches(business_id, name, kind) values (biz, 'Head Office', 'head');
  insert into categories(business_id, name, is_serialized) values
    (biz,'Smartphone',true),(biz,'Feature Phone',true),(biz,'Tablet',true),(biz,'Smart Watch',true),
    (biz,'Charger',false),(biz,'Cable',false),(biz,'Earphone',false),(biz,'Power Bank',false),
    (biz,'Cover',false),(biz,'Tempered Glass',false),(biz,'Other Accessory',false);
  return biz;
end $$;
revoke all on function public.create_business from public, anon;
grant execute on function public.create_business to authenticated;

create or replace function public.load_demo_data(_biz uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b text; bid uuid; phone uuid; acc uuid; pid uuid; i int := 0;
begin
  if not has_biz_role(_biz, array['owner']::member_role[]) then raise exception 'Only the owner can load demo data'; end if;
  select id into phone from categories where business_id=_biz and name='Smartphone';
  select id into acc from categories where business_id=_biz and name='Charger';
  insert into branches(business_id,name,kind) values (_biz,'Branch 01 - Bashundhara','branch'),(_biz,'Warehouse 01','warehouse') on conflict do nothing;
  foreach b in array array['Samsung','Apple','Xiaomi','Redmi','Realme','Oppo','Vivo','OnePlus','Tecno','Infinix'] loop
    i := i + 1; pid := null;
    insert into brands(business_id,name) values (_biz,b) on conflict (business_id,name) do update set name=excluded.name returning id into bid;
    insert into products(business_id,brand_id,category_id,model) values (_biz,bid,phone, b || ' Model ' || (10+i)) on conflict do nothing returning id into pid;
    if pid is not null then
      insert into product_variants(business_id,product_id,sku,ram,storage,color,purchase_price,wholesale_price,dealer_price,retail_price,min_price,reorder_level,warranty_months)
      values (_biz,pid,upper(left(b,3))||'-'||(10+i)||'-8-128','8GB','128GB','Black', 18000+i*2500, 19000+i*2500, 19500+i*2500, 21000+i*2500, 19200+i*2500, 3, 12),
             (_biz,pid,upper(left(b,3))||'-'||(10+i)||'-8-256','8GB','256GB','Blue', 21000+i*2500, 22000+i*2500, 22500+i*2500, 24500+i*2500, 22200+i*2500, 2, 12);
    end if;
  end loop;
  pid := null;
  select id into bid from brands where business_id=_biz and name='Samsung';
  insert into products(business_id,brand_id,category_id,model) values (_biz,bid,acc,'25W Fast Charger') on conflict do nothing returning id into pid;
  if pid is not null then
    insert into product_variants(business_id,product_id,sku,color,purchase_price,wholesale_price,dealer_price,retail_price,min_price,reorder_level,warranty_months)
    values (_biz,pid,'SAM-CHG-25W','White',650,750,780,950,800,20,6);
  end if;
  insert into customers(business_id,name,business_name,mobile,address,type,price_level,credit_limit,payment_terms_days) values
    (_biz,'Demo Customer A',null,'01710000001','Mirpur, Dhaka','retail','retail',0,0),
    (_biz,'Demo Dealer Rahman','Rahman Mobile (demo)','01810000002','Chawkbazar, Chattogram','wholesale_dealer','dealer',500000,30),
    (_biz,'Demo Shop Karim','Karim Telecom (demo)','01910000003','Sylhet Sadar','retail_shop','wholesale',200000,15),
    (_biz,'Demo Sub Dealer','Nobo Phone (demo)','01610000004','Bogura','sub_dealer','dealer',150000,15),
    (_biz,'Demo Corporate Ltd','Demo Corp (demo)','01510000005','Gulshan, Dhaka','corporate','special',300000,30)
  on conflict do nothing;
  insert into suppliers(business_id,name,company,contact_person,mobile,address,opening_payable,credit_terms_days) values
    (_biz,'Demo Distributor One','Alpha Distribution (demo)','Mr. Demo','01720000011','Motijheel, Dhaka',0,30),
    (_biz,'Demo Importer Two','Beta Imports (demo)','Ms. Sample','01820000012','Agrabad, Chattogram',0,15),
    (_biz,'Demo Accessories Hub','Gamma Accessories (demo)','Mr. Test','01920000013','Bashundhara City, Dhaka',0,7)
  on conflict do nothing;
end $$;
revoke all on function public.load_demo_data from public, anon;
grant execute on function public.load_demo_data to authenticated;
