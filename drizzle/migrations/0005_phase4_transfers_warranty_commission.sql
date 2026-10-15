create table public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  transfer_no text not null,
  from_branch_id uuid not null references public.branches(id),
  to_branch_id uuid not null references public.branches(id),
  transfer_date date not null default current_date,
  status text not null default 'dispatched' check (status in ('dispatched','received')),
  notes text,
  created_by uuid default auth.uid(),
  received_by uuid,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, transfer_no)
);
create table public.stock_transfer_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  transfer_id uuid not null references public.stock_transfers(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id),
  imei_id uuid references public.product_imeis(id),
  qty integer not null check (qty > 0),
  unit_cost numeric(14,2) not null
);
create table public.warranty_claims (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  claim_no text not null,
  imei_id uuid not null references public.product_imeis(id),
  sale_item_id uuid references public.sale_items(id),
  customer_id uuid references public.customers(id),
  claim_date date not null default current_date,
  warranty_end date,
  issue text not null,
  status text not null default 'open' check (status in ('open','in_service','replaced','resolved','rejected')),
  resolution text,
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (business_id, claim_no)
);
create table public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null,
  percent numeric(6,3) not null default 0 check (percent >= 0 and percent <= 100),
  per_device numeric(14,2) not null default 0 check (per_device >= 0),
  created_at timestamptz not null default now(),
  unique (business_id, user_id)
);
grant select on public.stock_transfers, public.stock_transfer_items, public.warranty_claims, public.commission_rules to authenticated;
grant insert, update, delete on public.commission_rules to authenticated;
grant all on public.stock_transfers, public.stock_transfer_items, public.warranty_claims, public.commission_rules to service_role;
alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_items enable row level security;
alter table public.warranty_claims enable row level security;
alter table public.commission_rules enable row level security;
create policy "members read transfers" on public.stock_transfers for select to authenticated using (public.is_member(business_id));
create policy "members read transfer items" on public.stock_transfer_items for select to authenticated using (public.is_member(business_id));
create policy "members read claims" on public.warranty_claims for select to authenticated using (public.is_member(business_id));
create policy "members read commission" on public.commission_rules for select to authenticated using (public.is_member(business_id));
create policy "owners manage commission" on public.commission_rules for all to authenticated
  using (public.has_biz_role(business_id, array['owner','manager']::member_role[]))
  with check (public.has_biz_role(business_id, array['owner','manager']::member_role[]));
create index on public.stock_transfer_items(transfer_id);
create index on public.warranty_claims(imei_id);
create trigger audit_stock_transfers after insert or update or delete on public.stock_transfers for each row execute function public.audit_row();
create trigger audit_warranty_claims after insert or update or delete on public.warranty_claims for each row execute function public.audit_row();
create trigger audit_commission_rules after insert or update or delete on public.commission_rules for each row execute function public.audit_row();

-- _data: { from_branch_id, to_branch_id, transfer_date, notes, items: [{variant_id, qty, imei_ids: []}] }
create or replace function public.create_stock_transfer(_biz uuid, _data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_from uuid := (_data->>'from_branch_id')::uuid; v_to uuid := (_data->>'to_branch_id')::uuid;
  it jsonb; v_var uuid; v_qty int; v_stock int; v_avg numeric(14,2); v_serial boolean; v_ids jsonb; v_imei uuid; v_cost numeric(14,2);
  v_seq int; v_no text; v_n int := 0;
begin
  if not has_biz_role(_biz, array['owner','manager','store_keeper','branch_manager']::member_role[]) then
    raise exception 'You do not have permission to transfer stock.'; end if;
  if v_from = v_to then raise exception 'Choose two different locations.'; end if;
  if (select count(*) from branches where id in (v_from, v_to) and business_id=_biz and status='active') <> 2 then raise exception 'Invalid branch.'; end if;
  perform pg_advisory_xact_lock(hashtext('trf_no_' || _biz::text));
  select coalesce(max(nullif(regexp_replace(transfer_no,'\D','','g'),'')::int),0)+1 into v_seq from stock_transfers where business_id=_biz;
  v_no := 'TRF-' || lpad(v_seq::text, 6, '0');
  insert into stock_transfers(business_id, transfer_no, from_branch_id, to_branch_id, transfer_date, notes)
    values (_biz, v_no, v_from, v_to, coalesce((_data->>'transfer_date')::date, current_date), nullif(_data->>'notes','')) returning id into v_id;
  for it in select * from jsonb_array_elements(coalesce(_data->'items','[]'::jsonb)) loop
    v_var := (it->>'variant_id')::uuid; v_qty := coalesce((it->>'qty')::int,0);
    continue when v_qty = 0;
    if v_qty < 0 then raise exception 'Invalid quantity.'; end if;
    select c.is_serialized into v_serial from product_variants pv join products p on p.id=pv.product_id join categories c on c.id=p.category_id where pv.id=v_var and pv.business_id=_biz;
    if not found then raise exception 'Invalid product.'; end if;
    select qty, avg_cost into v_stock, v_avg from stock where branch_id=v_from and variant_id=v_var for update;
    if coalesce(v_stock,0) < v_qty then raise exception 'Insufficient stock (available %).', coalesce(v_stock,0); end if;
    v_ids := coalesce(it->'imei_ids','[]'::jsonb);
    if v_serial then
      if jsonb_array_length(v_ids) <> v_qty then raise exception 'Select % IMEI(s) to transfer.', v_qty; end if;
      for v_imei in select (x #>> '{}')::uuid from jsonb_array_elements(v_ids) x loop
        select cost into v_cost from product_imeis where id=v_imei and variant_id=v_var and branch_id=v_from and status='IN_STOCK' for update;
        if not found then raise exception 'An IMEI is not in stock at the sending location.'; end if;
        update product_imeis set status='RESERVED' where id=v_imei;
        insert into stock_transfer_items(business_id, transfer_id, variant_id, imei_id, qty, unit_cost) values (_biz, v_id, v_var, v_imei, 1, v_cost);
        insert into stock_movements(business_id,branch_id,variant_id,imei_id,qty_change,unit_cost,ref_type,ref_id)
          values (_biz, v_from, v_var, v_imei, -1, v_cost, 'transfer_out', v_id);
      end loop;
    else
      insert into stock_transfer_items(business_id, transfer_id, variant_id, qty, unit_cost) values (_biz, v_id, v_var, v_qty, v_avg);
      insert into stock_movements(business_id,branch_id,variant_id,qty_change,unit_cost,ref_type,ref_id)
        values (_biz, v_from, v_var, -v_qty, v_avg, 'transfer_out', v_id);
    end if;
    update stock set qty = qty - v_qty, updated_at = now() where branch_id=v_from and variant_id=v_var;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Add at least one product.'; end if;
  return v_id;
end $$;

create or replace function public.receive_stock_transfer(_biz uuid, _id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t record; it record;
begin
  if not has_biz_role(_biz, array['owner','manager','store_keeper','branch_manager']::member_role[]) then
    raise exception 'You do not have permission to receive stock.'; end if;
  select * into t from stock_transfers where id=_id and business_id=_biz for update;
  if not found then raise exception 'Invalid transfer.'; end if;
  if t.status <> 'dispatched' then raise exception 'Transfer already received.'; end if;
  for it in select * from stock_transfer_items where transfer_id=_id loop
    insert into stock(business_id, branch_id, variant_id, qty, avg_cost) values (_biz, t.to_branch_id, it.variant_id, 0, it.unit_cost)
      on conflict (branch_id, variant_id) do nothing;
    update stock set avg_cost = case when qty + it.qty > 0 then round((qty*avg_cost + it.qty*it.unit_cost)/(qty+it.qty),2) else avg_cost end,
      qty = qty + it.qty, updated_at = now() where branch_id=t.to_branch_id and variant_id=it.variant_id;
    if it.imei_id is not null then update product_imeis set status='IN_STOCK', branch_id=t.to_branch_id where id=it.imei_id; end if;
    insert into stock_movements(business_id,branch_id,variant_id,imei_id,qty_change,unit_cost,ref_type,ref_id)
      values (_biz, t.to_branch_id, it.variant_id, it.imei_id, it.qty, it.unit_cost, 'transfer_in', _id);
  end loop;
  update stock_transfers set status='received', received_by=auth.uid(), received_at=now() where id=_id;
end $$;

create or replace function public.create_warranty_claim(_biz uuid, _imei text, _issue text)
returns uuid language plpgsql security definer set search_path = public as $$
declare im record; si record; v_cust uuid; v_date date; v_end date; v_seq int; v_id uuid;
begin
  if not has_biz_role(_biz, array['owner','manager','salesman','branch_manager','store_keeper']::member_role[]) then
    raise exception 'You do not have permission.'; end if;
  if coalesce(trim(_issue),'') = '' then raise exception 'Describe the problem.'; end if;
  select * into im from product_imeis where business_id=_biz and (imei1=trim(_imei) or imei2=trim(_imei)) for update;
  if not found then raise exception 'IMEI not found.'; end if;
  if im.status <> 'SOLD' then raise exception 'This device is not sold (status %). Only sold devices can be claimed.', im.status; end if;
  select s.* , x.sale_date, x.customer_id into si from sale_items s join sales x on x.id=s.sale_id where s.id=im.sale_item_id;
  v_end := (si.sale_date + make_interval(months => si.warranty_months))::date;
  if si.warranty_months = 0 or v_end < current_date then raise exception 'Warranty expired or not covered (ended %).', v_end; end if;
  perform pg_advisory_xact_lock(hashtext('wc_no_' || _biz::text));
  select coalesce(max(nullif(regexp_replace(claim_no,'\D','','g'),'')::int),0)+1 into v_seq from warranty_claims where business_id=_biz;
  insert into warranty_claims(business_id, claim_no, imei_id, sale_item_id, customer_id, warranty_end, issue)
    values (_biz, 'WC-' || lpad(v_seq::text,6,'0'), im.id, si.id, si.customer_id, v_end, trim(_issue)) returning id into v_id;
  update product_imeis set status='WARRANTY' where id=im.id;
  return v_id;
end $$;

create or replace function public.update_warranty_claim(_biz uuid, _id uuid, _status text, _resolution text)
returns void language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if not has_biz_role(_biz, array['owner','manager','branch_manager','store_keeper']::member_role[]) then
    raise exception 'You do not have permission.'; end if;
  select * into c from warranty_claims where id=_id and business_id=_biz for update;
  if not found then raise exception 'Invalid claim.'; end if;
  if c.status in ('replaced','resolved','rejected') then raise exception 'Claim already closed.'; end if;
  if _status not in ('in_service','replaced','resolved','rejected') then raise exception 'Invalid status.'; end if;
  update warranty_claims set status=_status, resolution=nullif(_resolution,''), updated_at=now() where id=_id;
  if _status in ('replaced','resolved','rejected') then
    update product_imeis set status='SOLD' where id=c.imei_id; -- device returns to customer
  end if;
end $$;

revoke all on function public.create_stock_transfer, public.receive_stock_transfer, public.create_warranty_claim, public.update_warranty_claim from public, anon;
grant execute on function public.create_stock_transfer, public.receive_stock_transfer, public.create_warranty_claim, public.update_warranty_claim to authenticated;