
create type public.imei_status as enum ('IN_STOCK','RESERVED','SOLD','RETURNED','WARRANTY');
create type public.payment_method as enum ('cash','bank','bkash','nagad','rocket','card','cheque','other');

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  supplier_id uuid not null references public.suppliers(id),
  invoice_no text not null,
  supplier_invoice_no text,
  purchase_date date not null default current_date,
  subtotal numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0 check (discount >= 0),
  tax numeric(14,2) not null default 0 check (tax >= 0),
  transport_cost numeric(14,2) not null default 0 check (transport_cost >= 0),
  loading_cost numeric(14,2) not null default 0 check (loading_cost >= 0),
  courier_cost numeric(14,2) not null default 0 check (courier_cost >= 0),
  insurance_cost numeric(14,2) not null default 0 check (insurance_cost >= 0),
  other_cost numeric(14,2) not null default 0 check (other_cost >= 0),
  total numeric(14,2) not null default 0,
  paid numeric(14,2) not null default 0 check (paid >= 0),
  due numeric(14,2) not null default 0 check (due >= 0),
  status text not null default 'posted' check (status in ('posted','cancelled')),
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (business_id, invoice_no)
);
create index on public.purchases(business_id, purchase_date desc);
create index on public.purchases(supplier_id);

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id),
  qty integer not null check (qty > 0),
  rate numeric(14,2) not null check (rate >= 0),
  line_total numeric(14,2) not null,
  landed_unit_cost numeric(14,2) not null
);
create index on public.purchase_items(purchase_id);

create table public.product_imeis (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id),
  imei1 text not null check (imei1 ~ '^[0-9]{15}$'),
  imei2 text check (imei2 is null or imei2 ~ '^[0-9]{15}$'),
  serial_no text,
  status public.imei_status not null default 'IN_STOCK',
  branch_id uuid not null references public.branches(id),
  purchase_item_id uuid references public.purchase_items(id),
  cost numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (business_id, imei1)
);
create unique index product_imeis_imei2_uniq on public.product_imeis(business_id, imei2) where imei2 is not null;
create index product_imeis_imei2_idx on public.product_imeis(imei2);
create index on public.product_imeis(variant_id, status);

create table public.stock (
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  variant_id uuid not null references public.product_variants(id),
  qty integer not null default 0 check (qty >= 0),
  avg_cost numeric(14,2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (branch_id, variant_id)
);
create index on public.stock(business_id);

create table public.stock_movements (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  variant_id uuid not null references public.product_variants(id),
  imei_id uuid references public.product_imeis(id),
  qty_change integer not null,
  unit_cost numeric(14,2) not null default 0,
  ref_type text not null,
  ref_id uuid not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.stock_movements(business_id, created_at desc);
create index on public.stock_movements(imei_id);

create table public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id),
  purchase_id uuid references public.purchases(id),
  branch_id uuid references public.branches(id),
  amount numeric(14,2) not null check (amount > 0),
  method public.payment_method not null default 'cash',
  txn_ref text,
  paid_on date not null default current_date,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.supplier_payments(supplier_id);

grant select on public.purchases, public.purchase_items, public.product_imeis, public.stock, public.stock_movements, public.supplier_payments to authenticated;
grant all on public.purchases, public.purchase_items, public.product_imeis, public.stock, public.stock_movements, public.supplier_payments to service_role;

alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.product_imeis enable row level security;
alter table public.stock enable row level security;
alter table public.stock_movements enable row level security;
alter table public.supplier_payments enable row level security;

-- read-only through Data API; all writes go through create_purchase()
create policy "members read purchases" on public.purchases for select to authenticated using (public.is_member(business_id));
create policy "members read purchase_items" on public.purchase_items for select to authenticated using (public.is_member(business_id));
create policy "members read imeis" on public.product_imeis for select to authenticated using (public.is_member(business_id));
create policy "members read stock" on public.stock for select to authenticated using (public.is_member(business_id));
create policy "members read movements" on public.stock_movements for select to authenticated using (public.is_member(business_id));
create policy "members read supplier payments" on public.supplier_payments for select to authenticated using (public.is_member(business_id));

create trigger audit_purchases after insert or update or delete on public.purchases for each row execute function public.audit_row();
create trigger audit_supplier_payments after insert or update or delete on public.supplier_payments for each row execute function public.audit_row();

-- Atomic purchase posting
create or replace function public.create_purchase(_biz uuid, _data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_pid uuid; v_branch uuid := (_data->>'branch_id')::uuid; v_supplier uuid := (_data->>'supplier_id')::uuid;
  v_sub numeric(14,2) := 0; v_disc numeric(14,2) := coalesce((_data->>'discount')::numeric,0);
  v_tax numeric(14,2) := coalesce((_data->>'tax')::numeric,0);
  v_tr numeric(14,2) := coalesce((_data->>'transport_cost')::numeric,0);
  v_ld numeric(14,2) := coalesce((_data->>'loading_cost')::numeric,0);
  v_cr numeric(14,2) := coalesce((_data->>'courier_cost')::numeric,0);
  v_in numeric(14,2) := coalesce((_data->>'insurance_cost')::numeric,0);
  v_ot numeric(14,2) := coalesce((_data->>'other_cost')::numeric,0);
  v_paid numeric(14,2) := coalesce((_data->>'paid')::numeric,0);
  v_total numeric(14,2); v_extra numeric; v_factor numeric;
  v_no text; v_seq int; it jsonb; im jsonb; v_item uuid; v_var uuid; v_qty int; v_rate numeric(14,2);
  v_line numeric(14,2); v_unit numeric(14,2); v_serial boolean; v_imeis jsonb; v_imei_id uuid; v_n int; v_cnt int := 0;
begin
  if not has_biz_role(_biz, array['owner','manager','purchase_officer','store_keeper']::member_role[]) then
    raise exception 'You do not have permission to create purchases.'; end if;
  if not exists(select 1 from suppliers where id=v_supplier and business_id=_biz) then raise exception 'Invalid supplier.'; end if;
  if exists(select 1 from suppliers where id=v_supplier and status='inactive') then raise exception 'Supplier is inactive.'; end if;
  if not exists(select 1 from branches where id=v_branch and business_id=_biz and status='active') then raise exception 'Invalid branch.'; end if;
  if jsonb_array_length(coalesce(_data->'items','[]'::jsonb)) = 0 then raise exception 'Add at least one product.'; end if;
  if least(v_disc,v_tax,v_tr,v_ld,v_cr,v_in,v_ot,v_paid) < 0 then raise exception 'Amounts cannot be negative.'; end if;

  for it in select * from jsonb_array_elements(_data->'items') loop
    v_qty := (it->>'qty')::int; v_rate := (it->>'rate')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantity must be at least 1.'; end if;
    if v_rate is null or v_rate < 0 then raise exception 'Invalid purchase rate.'; end if;
    v_sub := v_sub + round(v_qty * v_rate, 2);
  end loop;

  v_total := v_sub - v_disc + v_tax + v_tr + v_ld + v_cr + v_in + v_ot;
  if v_total < 0 then raise exception 'Discount is larger than the purchase amount.'; end if;
  if v_paid > v_total then raise exception 'Paid amount cannot exceed total (৳%).', v_total; end if;
  -- landed cost: extra costs + tax - discount spread by line value
  v_extra := v_total - v_sub;
  v_factor := case when v_sub > 0 then v_extra / v_sub else 0 end;

  perform pg_advisory_xact_lock(hashtext('purchase_no_' || _biz::text));
  select coalesce(max(nullif(regexp_replace(invoice_no,'\D','','g'),'')::int),0)+1 into v_seq from purchases where business_id=_biz;
  v_no := 'PUR-' || lpad(v_seq::text, 6, '0');

  insert into purchases(business_id,branch_id,supplier_id,invoice_no,supplier_invoice_no,purchase_date,subtotal,discount,tax,
    transport_cost,loading_cost,courier_cost,insurance_cost,other_cost,total,paid,due,notes)
  values (_biz,v_branch,v_supplier,v_no,nullif(_data->>'supplier_invoice_no',''),coalesce((_data->>'purchase_date')::date,current_date),
    v_sub,v_disc,v_tax,v_tr,v_ld,v_cr,v_in,v_ot,v_total,v_paid,v_total - v_paid,nullif(_data->>'notes',''))
  returning id into v_pid;

  for it in select * from jsonb_array_elements(_data->'items') loop
    v_var := (it->>'variant_id')::uuid; v_qty := (it->>'qty')::int; v_rate := (it->>'rate')::numeric;
    select c.is_serialized into v_serial from product_variants pv join products p on p.id=pv.product_id
      join categories c on c.id=p.category_id where pv.id=v_var and pv.business_id=_biz;
    if not found then raise exception 'Invalid product.'; end if;
    v_line := round(v_qty * v_rate, 2);
    v_unit := round(v_rate * (1 + v_factor), 2);
    insert into purchase_items(business_id,purchase_id,variant_id,qty,rate,line_total,landed_unit_cost)
      values (_biz,v_pid,v_var,v_qty,v_rate,v_line,v_unit) returning id into v_item;

    v_imeis := coalesce(it->'imeis','[]'::jsonb);
    if v_serial then
      if jsonb_array_length(v_imeis) <> v_qty then
        raise exception 'IMEI count (%) must match quantity (%) for serialized products.', jsonb_array_length(v_imeis), v_qty; end if;
      for im in select * from jsonb_array_elements(v_imeis) loop
        if exists(select 1 from product_imeis where business_id=_biz and (imei1 = im->>'imei1' or imei2 = im->>'imei1'
             or (nullif(im->>'imei2','') is not null and (imei1 = im->>'imei2' or imei2 = im->>'imei2')))) then
          raise exception 'IMEI already exists: %', im->>'imei1'; end if;
        if (im->>'imei1') !~ '^[0-9]{15}$' then raise exception 'Invalid IMEI (must be 15 digits): %', im->>'imei1'; end if;
        insert into product_imeis(business_id,variant_id,imei1,imei2,serial_no,branch_id,purchase_item_id,cost)
          values (_biz,v_var,im->>'imei1',nullif(im->>'imei2',''),nullif(im->>'serial_no',''),v_branch,v_item,v_unit)
          returning id into v_imei_id;
        insert into stock_movements(business_id,branch_id,variant_id,imei_id,qty_change,unit_cost,ref_type,ref_id)
          values (_biz,v_branch,v_var,v_imei_id,1,v_unit,'purchase',v_pid);
      end loop;
    else
      if jsonb_array_length(v_imeis) > 0 then raise exception 'This product is not IMEI-tracked; remove the IMEIs.'; end if;
      insert into stock_movements(business_id,branch_id,variant_id,qty_change,unit_cost,ref_type,ref_id)
        values (_biz,v_branch,v_var,v_qty,v_unit,'purchase',v_pid);
    end if;

    insert into stock(business_id,branch_id,variant_id,qty,avg_cost) values (_biz,v_branch,v_var,v_qty,v_unit)
    on conflict (branch_id,variant_id) do update set
      avg_cost = round((stock.qty * stock.avg_cost + excluded.qty * excluded.avg_cost) / nullif(stock.qty + excluded.qty,0), 2),
      qty = stock.qty + excluded.qty, updated_at = now();
    v_cnt := v_cnt + 1;
  end loop;

  if v_paid > 0 then
    insert into supplier_payments(business_id,supplier_id,purchase_id,branch_id,amount,method,txn_ref,paid_on)
      values (_biz,v_supplier,v_pid,v_branch,v_paid,coalesce((_data->>'payment_method')::payment_method,'cash'),
              nullif(_data->>'txn_ref',''),coalesce((_data->>'purchase_date')::date,current_date));
  end if;
  return v_pid;
end $$;
revoke all on function public.create_purchase from public, anon;
grant execute on function public.create_purchase to authenticated;

-- Supplier balances view (security invoker so RLS applies)
create view public.supplier_balances with (security_invoker = true) as
select s.id as supplier_id, s.business_id, s.name, s.opening_payable,
  coalesce((select sum(total) from purchases p where p.supplier_id=s.id and p.status='posted'),0) as purchases_total,
  coalesce((select sum(amount) from supplier_payments sp where sp.supplier_id=s.id),0) as payments_total,
  s.opening_payable
   + coalesce((select sum(total) from purchases p where p.supplier_id=s.id and p.status='posted'),0)
   - coalesce((select sum(amount) from supplier_payments sp where sp.supplier_id=s.id),0) as current_payable
from suppliers s;
grant select on public.supplier_balances to authenticated;
