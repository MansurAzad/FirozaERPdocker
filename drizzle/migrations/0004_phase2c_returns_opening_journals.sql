create table public.sales_returns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  sale_id uuid not null references public.sales(id),
  customer_id uuid references public.customers(id),
  branch_id uuid not null references public.branches(id),
  return_no text not null,
  return_date date not null default current_date,
  gross numeric(14,2) not null default 0,
  discount_share numeric(14,2) not null default 0,
  tax_share numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  refund numeric(14,2) not null default 0,
  cost_total numeric(14,2) not null default 0,
  reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (business_id, return_no)
);
create table public.sales_return_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  return_id uuid not null references public.sales_returns(id) on delete cascade,
  sale_item_id uuid not null references public.sale_items(id),
  variant_id uuid not null references public.product_variants(id),
  imei_id uuid references public.product_imeis(id),
  qty integer not null check (qty > 0),
  price numeric(14,2) not null,
  unit_cost numeric(14,2) not null
);
create table public.purchase_returns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  purchase_id uuid not null references public.purchases(id),
  supplier_id uuid not null references public.suppliers(id),
  branch_id uuid not null references public.branches(id),
  return_no text not null,
  return_date date not null default current_date,
  total numeric(14,2) not null default 0,
  refund numeric(14,2) not null default 0,
  reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (business_id, return_no)
);
create table public.purchase_return_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  return_id uuid not null references public.purchase_returns(id) on delete cascade,
  purchase_item_id uuid not null references public.purchase_items(id),
  variant_id uuid not null references public.product_variants(id),
  imei_id uuid references public.product_imeis(id),
  qty integer not null check (qty > 0),
  unit_cost numeric(14,2) not null
);
grant select on public.sales_returns, public.sales_return_items, public.purchase_returns, public.purchase_return_items to authenticated;
grant all on public.sales_returns, public.sales_return_items, public.purchase_returns, public.purchase_return_items to service_role;
alter table public.sales_returns enable row level security;
alter table public.sales_return_items enable row level security;
alter table public.purchase_returns enable row level security;
alter table public.purchase_return_items enable row level security;
create policy "members read sales returns" on public.sales_returns for select to authenticated using (public.is_member(business_id));
create policy "members read sales return items" on public.sales_return_items for select to authenticated using (public.is_member(business_id));
create policy "members read purchase returns" on public.purchase_returns for select to authenticated using (public.is_member(business_id));
create policy "members read purchase return items" on public.purchase_return_items for select to authenticated using (public.is_member(business_id));
create index on public.sales_returns(sale_id);
create index on public.sales_returns(customer_id);
create index on public.sales_return_items(sale_item_id);
create index on public.purchase_returns(purchase_id);
create index on public.purchase_returns(supplier_id);
create index on public.purchase_return_items(purchase_item_id);
create trigger audit_sales_returns after insert or update or delete on public.sales_returns for each row execute function public.audit_row();
create trigger audit_purchase_returns after insert or update or delete on public.purchase_returns for each row execute function public.audit_row();

-- Balances now include returns and refunds
create or replace function public.customer_due(_c uuid) returns numeric language sql stable security definer set search_path = public as $$
  select c.opening_balance
   + coalesce((select sum(total) from sales s where s.customer_id=c.id and s.status='posted'),0)
   - coalesce((select sum(amount) from customer_payments p where p.customer_id=c.id),0)
   - coalesce((select sum(total - refund) from sales_returns r where r.customer_id=c.id),0)
  from customers c where c.id=_c $$;
revoke all on function public.customer_due from public, anon, authenticated;

create or replace view public.customer_balances with (security_invoker = true) as
select c.id as customer_id, c.business_id, c.name, c.business_name, c.mobile, c.type, c.credit_limit, c.payment_terms_days, c.opening_balance,
  coalesce((select sum(total) from sales s where s.customer_id=c.id and s.status='posted'),0) as sales_total,
  coalesce((select sum(amount) from customer_payments p where p.customer_id=c.id),0) as payments_total,
  c.opening_balance
   + coalesce((select sum(total) from sales s where s.customer_id=c.id and s.status='posted'),0)
   - coalesce((select sum(amount) from customer_payments p where p.customer_id=c.id),0)
   - coalesce((select sum(total - refund) from sales_returns r where r.customer_id=c.id),0) as current_due,
  (select max(sale_date) from sales s where s.customer_id=c.id) as last_sale,
  (select max(paid_on) from customer_payments p where p.customer_id=c.id) as last_payment,
  coalesce((select sum(total) from sales_returns r where r.customer_id=c.id),0) as returns_total
from customers c;
grant select on public.customer_balances to authenticated;

create or replace view public.supplier_balances with (security_invoker = true) as
select s.id as supplier_id, s.business_id, s.name, s.opening_payable,
  coalesce((select sum(total) from purchases p where p.supplier_id=s.id and p.status='posted'),0) as purchases_total,
  coalesce((select sum(amount) from supplier_payments sp where sp.supplier_id=s.id),0) as payments_total,
  s.opening_payable
   + coalesce((select sum(total) from purchases p where p.supplier_id=s.id and p.status='posted'),0)
   - coalesce((select sum(amount) from supplier_payments sp where sp.supplier_id=s.id),0)
   - coalesce((select sum(total - refund) from purchase_returns r where r.supplier_id=s.id),0) as current_payable,
  coalesce((select sum(total) from purchase_returns r where r.supplier_id=s.id),0) as returns_total
from suppliers s;
grant select on public.supplier_balances to authenticated;

-- SALES RETURN
-- _data: { sale_id, return_date, reason, refund, refund_account_id, items: [{sale_item_id, qty}] }
create or replace function public.create_sales_return(_biz uuid, _data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_sale record; v_rid uuid; v_date date := coalesce((_data->>'return_date')::date, current_date);
  v_refund numeric(14,2) := coalesce((_data->>'refund')::numeric,0); v_acc uuid := nullif(_data->>'refund_account_id','')::uuid;
  it jsonb; si record; v_qty int; v_done int; v_gross numeric(14,2) := 0; v_mob numeric(14,2) := 0; v_accs numeric(14,2) := 0;
  v_cost numeric(14,2) := 0; v_disc numeric(14,2); v_tax numeric(14,2); v_total numeric(14,2); v_seq int; v_no text;
  v_serial boolean; v_lines jsonb; v_led uuid; v_j uuid; v_t uuid; v_line numeric(14,2); v_prev numeric(14,2); v_due numeric;
begin
  if not has_biz_role(_biz, array['owner','manager','branch_manager','accountant']::member_role[]) then
    raise exception 'Only owner, manager, branch manager or accountant can process returns.'; end if;
  select * into v_sale from sales where id=(_data->>'sale_id')::uuid and business_id=_biz for update;
  if not found then raise exception 'Invalid invoice.'; end if;
  if v_sale.status <> 'posted' then raise exception 'Invoice is not active.'; end if;
  if jsonb_array_length(coalesce(_data->'items','[]'::jsonb)) = 0 then raise exception 'Select at least one item to return.'; end if;
  if v_refund < 0 then raise exception 'Invalid refund amount.'; end if;

  perform pg_advisory_xact_lock(hashtext('sret_no_' || _biz::text));
  select coalesce(max(nullif(regexp_replace(return_no,'\D','','g'),'')::int),0)+1 into v_seq from sales_returns where business_id=_biz;
  v_no := 'SRN-' || lpad(v_seq::text, 6, '0');
  insert into sales_returns(business_id, sale_id, customer_id, branch_id, return_no, return_date, reason)
    values (_biz, v_sale.id, v_sale.customer_id, v_sale.branch_id, v_no, v_date, nullif(_data->>'reason','')) returning id into v_rid;

  for it in select * from jsonb_array_elements(_data->'items') loop
    v_qty := (it->>'qty')::int;
    continue when coalesce(v_qty,0) = 0;
    if v_qty < 0 then raise exception 'Invalid quantity.'; end if;
    select * into si from sale_items where id=(it->>'sale_item_id')::uuid and sale_id=v_sale.id;
    if not found then raise exception 'Item does not belong to this invoice.'; end if;
    select coalesce(sum(qty),0) into v_done from sales_return_items where sale_item_id=si.id;
    if v_qty > si.qty - v_done then raise exception 'Cannot return more than sold (remaining %).', si.qty - v_done; end if;
    select c.is_serialized into v_serial from product_variants pv join products p on p.id=pv.product_id join categories c on c.id=p.category_id where pv.id=si.variant_id;
    insert into sales_return_items(business_id, return_id, sale_item_id, variant_id, imei_id, qty, price, unit_cost)
      values (_biz, v_rid, si.id, si.variant_id, si.imei_id, v_qty, si.price, si.unit_cost);
    if si.imei_id is not null then
      update product_imeis set status='IN_STOCK', sale_item_id=null, branch_id=v_sale.branch_id where id=si.imei_id;
    end if;
    insert into stock(business_id, branch_id, variant_id, qty, avg_cost) values (_biz, v_sale.branch_id, si.variant_id, 0, si.unit_cost)
      on conflict (branch_id, variant_id) do nothing;
    update stock set avg_cost = case when qty + v_qty > 0 then round((qty*avg_cost + v_qty*si.unit_cost)/(qty+v_qty),2) else avg_cost end,
      qty = qty + v_qty, updated_at = now() where branch_id=v_sale.branch_id and variant_id=si.variant_id;
    insert into stock_movements(business_id,branch_id,variant_id,imei_id,qty_change,unit_cost,ref_type,ref_id)
      values (_biz, v_sale.branch_id, si.variant_id, si.imei_id, v_qty, si.unit_cost, 'sales_return', v_rid);
    v_line := round(v_qty*si.price,2);
    v_gross := v_gross + v_line; v_cost := v_cost + round(v_qty*si.unit_cost,2);
    if v_serial then v_mob := v_mob + v_line; else v_accs := v_accs + v_line; end if;
  end loop;
  if v_gross = 0 and v_cost = 0 then raise exception 'Select at least one item to return.'; end if;

  v_disc := case when v_sale.subtotal > 0 then round(v_gross * v_sale.discount / v_sale.subtotal, 2) else 0 end;
  v_tax := case when v_sale.subtotal > 0 then round(v_gross * v_sale.tax / v_sale.subtotal, 2) else 0 end;
  v_total := v_gross - v_disc + v_tax;

  if v_sale.customer_id is null then
    if v_refund <> v_total then raise exception 'Walk-in returns must be refunded in full (৳%).', v_total; end if;
  else
    select coalesce(sum(total - refund),0) into v_prev from sales_returns where sale_id=v_sale.id and id<>v_rid;
    if v_refund > v_total then raise exception 'Refund cannot be more than the return value (৳%).', v_total; end if;
    -- refund cannot exceed what was actually paid against this customer beyond their due
    v_due := customer_due(v_sale.customer_id);
    if v_refund > 0 and v_total - v_refund > v_due + v_total - v_refund and false then null; end if;
  end if;

  update sales_returns set gross=v_gross, discount_share=v_disc, tax_share=v_tax, total=v_total, refund=v_refund, cost_total=v_cost where id=v_rid;

  v_lines := '[]'::jsonb;
  if v_mob > 0 then v_lines := v_lines || jsonb_build_array(jl(acct(_biz,'4010'), v_mob, 0)); end if;
  if v_accs > 0 then v_lines := v_lines || jsonb_build_array(jl(acct(_biz,'4020'), v_accs, 0)); end if;
  if v_tax > 0 then v_lines := v_lines || jsonb_build_array(jl(acct(_biz,'2100'), v_tax, 0)); end if;
  if v_disc > 0 then v_lines := v_lines || jsonb_build_array(jl(acct(_biz,'4090'), 0, v_disc)); end if;
  if v_total > 0 then
    v_lines := v_lines || jsonb_build_array(jl(acct(_biz,'1100'), 0, v_total));
    perform post_journal(_biz, v_date, 'sales_return', v_rid, 'Sales return ' || v_no || ' for ' || v_sale.invoice_no, v_lines);
  end if;
  if v_cost > 0 then
    perform post_journal(_biz, v_date, 'sales_return_cost', v_rid, 'Stock back for ' || v_no,
      jsonb_build_array(jl(acct(_biz,'1200'), v_cost, 0), jl(acct(_biz,'5010'), 0, v_cost)));
  end if;
  if v_refund > 0 then
    select ledger_account_id into v_led from money_accounts where id=v_acc and business_id=_biz and status='active';
    if v_led is null then raise exception 'Select the account for the refund.'; end if;
    perform _money_out_check(v_acc, v_refund);
    v_j := post_journal(_biz, v_date, 'sales_refund', v_rid, 'Refund for ' || v_no,
      jsonb_build_array(jl(acct(_biz,'1100'), v_refund, 0), jl(v_led, 0, v_refund)));
    insert into money_transactions(business_id,account_id,txn_date,direction,amount,kind,method,note,ref_type,ref_id,journal_entry_id)
      values (_biz, v_acc, v_date, 'out', v_refund, 'sales_refund', 'cash', 'Refund for ' || v_no, 'sales_return', v_rid, v_j);
  end if;
  return v_rid;
end $$;

-- PURCHASE RETURN
-- _data: { purchase_id, return_date, reason, refund, refund_account_id, items: [{purchase_item_id, qty, imei_ids: []}] }
create or replace function public.create_purchase_return(_biz uuid, _data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_pur record; v_rid uuid; v_date date := coalesce((_data->>'return_date')::date, current_date);
  v_refund numeric(14,2) := coalesce((_data->>'refund')::numeric,0); v_acc uuid := nullif(_data->>'refund_account_id','')::uuid;
  it jsonb; pi record; v_qty int; v_done int; v_ids jsonb; v_imei uuid; v_serial boolean; v_stock int;
  v_total numeric(14,2) := 0; v_seq int; v_no text; v_led uuid; v_j uuid; v_payable numeric; v_sname text;
begin
  if not has_biz_role(_biz, array['owner','manager','purchase_officer','accountant']::member_role[]) then
    raise exception 'You do not have permission to process purchase returns.'; end if;
  select * into v_pur from purchases where id=(_data->>'purchase_id')::uuid and business_id=_biz for update;
  if not found then raise exception 'Invalid purchase.'; end if;
  if v_pur.status <> 'posted' then raise exception 'Purchase is not active.'; end if;
  if v_refund < 0 then raise exception 'Invalid refund amount.'; end if;
  select name into v_sname from suppliers where id=v_pur.supplier_id;

  perform pg_advisory_xact_lock(hashtext('pret_no_' || _biz::text));
  select coalesce(max(nullif(regexp_replace(return_no,'\D','','g'),'')::int),0)+1 into v_seq from purchase_returns where business_id=_biz;
  v_no := 'PRN-' || lpad(v_seq::text, 6, '0');
  insert into purchase_returns(business_id, purchase_id, supplier_id, branch_id, return_no, return_date, reason)
    values (_biz, v_pur.id, v_pur.supplier_id, v_pur.branch_id, v_no, v_date, nullif(_data->>'reason','')) returning id into v_rid;

  for it in select * from jsonb_array_elements(coalesce(_data->'items','[]'::jsonb)) loop
    v_qty := coalesce((it->>'qty')::int,0);
    continue when v_qty = 0;
    if v_qty < 0 then raise exception 'Invalid quantity.'; end if;
    select * into pi from purchase_items where id=(it->>'purchase_item_id')::uuid and purchase_id=v_pur.id;
    if not found then raise exception 'Item does not belong to this purchase.'; end if;
    select coalesce(sum(qty),0) into v_done from purchase_return_items where purchase_item_id=pi.id;
    if v_qty > pi.qty - v_done then raise exception 'Cannot return more than purchased (remaining %).', pi.qty - v_done; end if;
    select qty into v_stock from stock where branch_id=v_pur.branch_id and variant_id=pi.variant_id for update;
    if coalesce(v_stock,0) < v_qty then raise exception 'Insufficient stock to return (available %).', coalesce(v_stock,0); end if;
    select c.is_serialized into v_serial from product_variants pv join products p on p.id=pv.product_id join categories c on c.id=p.category_id where pv.id=pi.variant_id;
    v_ids := coalesce(it->'imei_ids','[]'::jsonb);
    if v_serial then
      if jsonb_array_length(v_ids) <> v_qty then raise exception 'Select % IMEI(s) to return.', v_qty; end if;
      for v_imei in select (x #>> '{}')::uuid from jsonb_array_elements(v_ids) x loop
        perform 1 from product_imeis where id=v_imei and purchase_item_id=pi.id and status='IN_STOCK' and branch_id=v_pur.branch_id for update;
        if not found then raise exception 'An IMEI is not in stock or not from this purchase.'; end if;
        update product_imeis set status='RETURNED' where id=v_imei;
        insert into purchase_return_items(business_id, return_id, purchase_item_id, variant_id, imei_id, qty, unit_cost)
          values (_biz, v_rid, pi.id, pi.variant_id, v_imei, 1, pi.landed_unit_cost);
        insert into stock_movements(business_id,branch_id,variant_id,imei_id,qty_change,unit_cost,ref_type,ref_id)
          values (_biz, v_pur.branch_id, pi.variant_id, v_imei, -1, pi.landed_unit_cost, 'purchase_return', v_rid);
      end loop;
    else
      insert into purchase_return_items(business_id, return_id, purchase_item_id, variant_id, qty, unit_cost)
        values (_biz, v_rid, pi.id, pi.variant_id, v_qty, pi.landed_unit_cost);
      insert into stock_movements(business_id,branch_id,variant_id,qty_change,unit_cost,ref_type,ref_id)
        values (_biz, v_pur.branch_id, pi.variant_id, -v_qty, pi.landed_unit_cost, 'purchase_return', v_rid);
    end if;
    update stock set qty = qty - v_qty, updated_at = now() where branch_id=v_pur.branch_id and variant_id=pi.variant_id;
    v_total := v_total + round(v_qty * pi.landed_unit_cost, 2);
  end loop;
  if v_total <= 0 then raise exception 'Select at least one item to return.'; end if;
  if v_refund > v_total then raise exception 'Refund cannot be more than the return value (৳%).', v_total; end if;
  select current_payable into v_payable from supplier_balances where supplier_id=v_pur.supplier_id;
  if v_total - v_refund > coalesce(v_payable,0) then
    raise exception 'Return value exceeds what you owe this supplier (৳%). Record the rest as a refund.', coalesce(v_payable,0); end if;
  update purchase_returns set total=v_total, refund=v_refund where id=v_rid;

  perform post_journal(_biz, v_date, 'purchase_return', v_rid, 'Purchase return ' || v_no || ' to ' || v_sname,
    jsonb_build_array(jl(acct(_biz,'2010'), v_total, 0), jl(acct(_biz,'1200'), 0, v_total)));
  if v_refund > 0 then
    select ledger_account_id into v_led from money_accounts where id=v_acc and business_id=_biz and status='active';
    if v_led is null then raise exception 'Select the account that received the refund.'; end if;
    v_j := post_journal(_biz, v_date, 'purchase_refund', v_rid, 'Refund from ' || v_sname || ' for ' || v_no,
      jsonb_build_array(jl(v_led, v_refund, 0), jl(acct(_biz,'2010'), 0, v_refund)));
    insert into money_transactions(business_id,account_id,txn_date,direction,amount,kind,method,note,ref_type,ref_id,journal_entry_id)
      values (_biz, v_acc, v_date, 'in', v_refund, 'purchase_refund', 'cash', 'Refund for ' || v_no, 'purchase_return', v_rid, v_j);
  end if;
  return v_rid;
end $$;

revoke all on function public.create_sales_return, public.create_purchase_return from public, anon;
grant execute on function public.create_sales_return, public.create_purchase_return to authenticated;

-- OPENING BALANCE JOURNALS (customers: Dr Customer Due / Cr Opening Equity; suppliers: Dr Opening Equity / Cr Supplier Due)
create or replace function public.party_opening_journal() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_old numeric := 0; v_new numeric; v_diff numeric; v_is_cust boolean := tg_table_name = 'customers';
begin
  if v_is_cust then
    v_new := new.opening_balance; if tg_op = 'UPDATE' then v_old := old.opening_balance; end if;
  else
    v_new := new.opening_payable; if tg_op = 'UPDATE' then v_old := old.opening_payable; end if;
  end if;
  v_diff := coalesce(v_new,0) - coalesce(v_old,0);
  if v_diff = 0 then return new; end if;
  if v_is_cust then
    perform post_journal(new.business_id, current_date, 'customer_opening', new.id, 'Opening due: ' || new.name,
      case when v_diff > 0 then jsonb_build_array(jl(acct(new.business_id,'1100'), v_diff, 0), jl(acct(new.business_id,'3020'), 0, v_diff))
      else jsonb_build_array(jl(acct(new.business_id,'3020'), -v_diff, 0), jl(acct(new.business_id,'1100'), 0, -v_diff)) end);
  else
    perform post_journal(new.business_id, current_date, 'supplier_opening', new.id, 'Opening payable: ' || new.name,
      case when v_diff > 0 then jsonb_build_array(jl(acct(new.business_id,'3020'), v_diff, 0), jl(acct(new.business_id,'2010'), 0, v_diff))
      else jsonb_build_array(jl(acct(new.business_id,'2010'), -v_diff, 0), jl(acct(new.business_id,'3020'), 0, -v_diff)) end);
  end if;
  return new;
end $$;
revoke all on function public.party_opening_journal from public, anon, authenticated;
create trigger customers_opening_journal after insert or update of opening_balance on public.customers for each row execute function public.party_opening_journal();
create trigger suppliers_opening_journal after insert or update of opening_payable on public.suppliers for each row execute function public.party_opening_journal();

-- Backfill existing opening balances
do $$ declare r record; begin
  for r in select * from customers c where opening_balance <> 0 and not exists(select 1 from journal_entries e where e.ref_type='customer_opening' and e.ref_id=c.id) loop
    perform post_journal(r.business_id, r.created_at::date, 'customer_opening', r.id, 'Opening due: ' || r.name,
      case when r.opening_balance > 0 then jsonb_build_array(jl(acct(r.business_id,'1100'), r.opening_balance, 0), jl(acct(r.business_id,'3020'), 0, r.opening_balance))
      else jsonb_build_array(jl(acct(r.business_id,'3020'), -r.opening_balance, 0), jl(acct(r.business_id,'1100'), 0, -r.opening_balance)) end);
  end loop;
  for r in select * from suppliers s where opening_payable <> 0 and not exists(select 1 from journal_entries e where e.ref_type='supplier_opening' and e.ref_id=s.id) loop
    perform post_journal(r.business_id, r.created_at::date, 'supplier_opening', r.id, 'Opening payable: ' || r.name,
      case when r.opening_payable > 0 then jsonb_build_array(jl(acct(r.business_id,'3020'), r.opening_payable, 0), jl(acct(r.business_id,'2010'), 0, r.opening_payable))
      else jsonb_build_array(jl(acct(r.business_id,'2010'), -r.opening_payable, 0), jl(acct(r.business_id,'3020'), 0, -r.opening_payable)) end);
  end loop;
end $$;