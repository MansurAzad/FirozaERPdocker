
create table public.sales (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  customer_id uuid references public.customers(id),
  invoice_no text not null,
  sale_date date not null default current_date,
  price_level public.price_level not null default 'retail',
  subtotal numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0 check (discount >= 0),
  tax numeric(14,2) not null default 0 check (tax >= 0),
  total numeric(14,2) not null default 0,
  paid numeric(14,2) not null default 0 check (paid >= 0),
  due numeric(14,2) not null default 0 check (due >= 0),
  cogs numeric(14,2) not null default 0,
  status text not null default 'posted' check (status in ('posted','cancelled')),
  credit_override_by uuid,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (business_id, invoice_no)
);
create index on public.sales(business_id, sale_date desc);
create index on public.sales(customer_id);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id),
  imei_id uuid references public.product_imeis(id),
  qty integer not null check (qty > 0),
  price numeric(14,2) not null check (price >= 0),
  line_total numeric(14,2) not null,
  unit_cost numeric(14,2) not null default 0,
  warranty_months integer not null default 0
);
create index on public.sale_items(sale_id);
create index on public.sale_items(imei_id);

create table public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid references public.customers(id),
  sale_id uuid references public.sales(id),
  account_id uuid not null references public.money_accounts(id),
  amount numeric(14,2) not null check (amount > 0),
  method public.payment_method not null default 'cash',
  txn_ref text,
  paid_on date not null default current_date,
  notes text,
  money_txn_id uuid references public.money_transactions(id),
  journal_entry_id uuid references public.journal_entries(id),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.customer_payments(customer_id);
create index on public.customer_payments(sale_id);

alter table public.product_imeis add column sale_item_id uuid references public.sale_items(id);

grant select on public.sales, public.sale_items, public.customer_payments to authenticated;
grant all on public.sales, public.sale_items, public.customer_payments to service_role;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.customer_payments enable row level security;
create policy "members read sales" on public.sales for select to authenticated using (public.is_member(business_id));
create policy "members read sale items" on public.sale_items for select to authenticated using (public.is_member(business_id));
create policy "members read customer payments" on public.customer_payments for select to authenticated using (public.is_member(business_id));
create trigger audit_sales after insert or update or delete on public.sales for each row execute function public.audit_row();
create trigger audit_customer_payments after insert or update or delete on public.customer_payments for each row execute function public.audit_row();

insert into public.accounts(business_id, code, name, type)
select id, '4090', 'Sales Discount', 'revenue' from public.businesses on conflict do nothing;

create or replace function public.seed_finance_v2() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.code = '4010' then
    insert into accounts(business_id, code, name, type) values (new.business_id, '4090', 'Sales Discount', 'revenue') on conflict do nothing;
  end if;
  return new;
end $$;
create trigger seed_sales_discount after insert on public.accounts for each row execute function public.seed_finance_v2();

create view public.customer_balances with (security_invoker = true) as
select c.id as customer_id, c.business_id, c.name, c.business_name, c.mobile, c.type, c.credit_limit, c.payment_terms_days, c.opening_balance,
  coalesce((select sum(total) from sales s where s.customer_id=c.id and s.status='posted'),0) as sales_total,
  coalesce((select sum(amount) from customer_payments p where p.customer_id=c.id),0) as payments_total,
  c.opening_balance
   + coalesce((select sum(total) from sales s where s.customer_id=c.id and s.status='posted'),0)
   - coalesce((select sum(amount) from customer_payments p where p.customer_id=c.id),0) as current_due,
  (select max(sale_date) from sales s where s.customer_id=c.id) as last_sale,
  (select max(paid_on) from customer_payments p where p.customer_id=c.id) as last_payment
from customers c;
grant select on public.customer_balances to authenticated;

create or replace function public.customer_due(_c uuid) returns numeric language sql stable security definer set search_path = public as $$
  select c.opening_balance
   + coalesce((select sum(total) from sales s where s.customer_id=c.id and s.status='posted'),0)
   - coalesce((select sum(amount) from customer_payments p where p.customer_id=c.id),0)
  from customers c where c.id=_c $$;
revoke all on function public.customer_due from public, anon, authenticated;

create or replace function public.create_sale(_biz uuid, _data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_sid uuid; v_branch uuid := (_data->>'branch_id')::uuid; v_cust uuid := nullif(_data->>'customer_id','')::uuid;
  v_date date := coalesce((_data->>'sale_date')::date, current_date);
  v_disc numeric(14,2) := coalesce((_data->>'discount')::numeric,0);
  v_tax numeric(14,2) := coalesce((_data->>'tax')::numeric,0);
  v_override boolean := coalesce((_data->>'override_credit')::boolean,false);
  v_is_mgr boolean := has_biz_role(_biz, array['owner','manager']::member_role[]);
  v_sub numeric(14,2) := 0; v_total numeric(14,2); v_paid numeric(14,2) := 0; v_due numeric(14,2);
  v_cogs numeric(14,2) := 0; v_mob numeric(14,2) := 0; v_acc numeric(14,2) := 0;
  v_cname text; v_limit numeric; v_ctype customer_type; v_level price_level := 'retail'; v_curdue numeric;
  it jsonb; pm jsonb; v_var uuid; v_qty int; v_price numeric(14,2); v_serial boolean; v_min numeric; v_warr int;
  v_ids jsonb; v_imei uuid; v_cost numeric(14,2); v_item uuid; v_stock int; v_avg numeric(14,2);
  v_seq int; v_no text; v_j uuid; v_t uuid; v_led uuid; v_amt numeric(14,2); v_lines jsonb := '[]'::jsonb; v_over boolean := false;
begin
  if not has_biz_role(_biz, array['owner','manager','salesman','branch_manager','accountant']::member_role[]) then
    raise exception 'You do not have permission to create sales.'; end if;
  if not exists(select 1 from branches where id=v_branch and business_id=_biz and status='active') then raise exception 'Invalid branch.'; end if;
  if v_cust is not null then
    select name, credit_limit, type, price_level into v_cname, v_limit, v_ctype, v_level from customers where id=v_cust and business_id=_biz;
    if v_cname is null then raise exception 'Invalid customer.'; end if;
    if exists(select 1 from customers where id=v_cust and status='inactive') then raise exception 'Customer is inactive.'; end if;
  else v_cname := 'Walk-in customer'; end if;
  if jsonb_array_length(coalesce(_data->'items','[]'::jsonb)) = 0 then raise exception 'Add at least one product.'; end if;
  if v_disc < 0 or v_tax < 0 then raise exception 'Amounts cannot be negative.'; end if;

  for pm in select * from jsonb_array_elements(coalesce(_data->'payments','[]'::jsonb)) loop
    v_amt := coalesce((pm->>'amount')::numeric,0);
    if v_amt < 0 then raise exception 'Invalid payment amount.'; end if;
    v_paid := v_paid + v_amt;
  end loop;

  perform pg_advisory_xact_lock(hashtext('sale_no_' || _biz::text));
  select coalesce(max(nullif(regexp_replace(invoice_no,'\D','','g'),'')::int),0)+1 into v_seq from sales where business_id=_biz;
  v_no := 'INV-' || lpad(v_seq::text, 6, '0');
  insert into sales(business_id, branch_id, customer_id, invoice_no, sale_date, price_level, notes)
    values (_biz, v_branch, v_cust, v_no, v_date, coalesce(v_level,'retail'), nullif(_data->>'notes','')) returning id into v_sid;

  for it in select * from jsonb_array_elements(_data->'items') loop
    v_var := (it->>'variant_id')::uuid; v_qty := (it->>'qty')::int; v_price := (it->>'price')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantity must be at least 1.'; end if;
    if v_price is null or v_price < 0 then raise exception 'Invalid price.'; end if;
    select c.is_serialized, pv.min_price, pv.warranty_months into v_serial, v_min, v_warr
      from product_variants pv join products p on p.id=pv.product_id join categories c on c.id=p.category_id
      where pv.id=v_var and pv.business_id=_biz;
    if not found then raise exception 'Invalid product.'; end if;
    if v_price < v_min and not v_is_mgr then raise exception 'Price ৳% is below the minimum selling price ৳%. Manager approval required.', v_price, v_min; end if;

    select qty, avg_cost into v_stock, v_avg from stock where branch_id=v_branch and variant_id=v_var for update;
    if coalesce(v_stock,0) < v_qty then raise exception 'Insufficient stock (available %).', coalesce(v_stock,0); end if;

    v_ids := coalesce(it->'imei_ids','[]'::jsonb);
    if v_serial then
      if jsonb_array_length(v_ids) <> v_qty then raise exception 'Select % IMEI(s) for this product.', v_qty; end if;
      for v_imei in select (x #>> '{}')::uuid from jsonb_array_elements(v_ids) x loop
        select cost into v_cost from product_imeis where id=v_imei and business_id=_biz and variant_id=v_var
          and branch_id=v_branch and status='IN_STOCK' for update;
        if not found then raise exception 'An IMEI is not available in stock at this branch.'; end if;
        insert into sale_items(business_id, sale_id, variant_id, imei_id, qty, price, line_total, unit_cost, warranty_months)
          values (_biz, v_sid, v_var, v_imei, 1, v_price, v_price, v_cost, v_warr) returning id into v_item;
        update product_imeis set status='SOLD', sale_item_id=v_item where id=v_imei;
        insert into stock_movements(business_id,branch_id,variant_id,imei_id,qty_change,unit_cost,ref_type,ref_id)
          values (_biz,v_branch,v_var,v_imei,-1,v_cost,'sale',v_sid);
        v_cogs := v_cogs + v_cost; v_mob := v_mob + v_price;
      end loop;
    else
      if jsonb_array_length(v_ids) > 0 then raise exception 'This product is not IMEI-tracked.'; end if;
      insert into sale_items(business_id, sale_id, variant_id, qty, price, line_total, unit_cost, warranty_months)
        values (_biz, v_sid, v_var, v_qty, v_price, round(v_qty*v_price,2), v_avg, v_warr);
      insert into stock_movements(business_id,branch_id,variant_id,qty_change,unit_cost,ref_type,ref_id)
        values (_biz,v_branch,v_var,-v_qty,v_avg,'sale',v_sid);
      v_cogs := v_cogs + round(v_qty*v_avg,2); v_acc := v_acc + round(v_qty*v_price,2);
    end if;
    update stock set qty = qty - v_qty, updated_at = now() where branch_id=v_branch and variant_id=v_var;
    v_sub := v_sub + round(v_qty*v_price,2);
  end loop;

  v_total := v_sub - v_disc + v_tax;
  if v_total < 0 then raise exception 'Discount is larger than the sale amount.'; end if;
  if v_paid > v_total then raise exception 'Payment (৳%) exceeds invoice total (৳%).', v_paid, v_total; end if;
  v_due := v_total - v_paid;
  if v_due > 0 and v_cust is null then raise exception 'Walk-in sales must be fully paid. Select a customer to sell on credit.'; end if;
  if v_disc > 0 and v_sub > 0 and v_disc / v_sub > 0.10 and not v_is_mgr then raise exception 'Discount above 10%% needs manager approval.'; end if;

  if v_due > 0 then
    v_curdue := customer_due(v_cust);
    if v_curdue + v_due > coalesce(v_limit,0) then
      if not v_override then raise exception 'CREDIT_LIMIT: Credit limit exceeded. Limit ৳%, current due ৳%, this sale adds ৳%. Manager approval required.', v_limit, v_curdue, v_due; end if;
      if not v_is_mgr then raise exception 'Only an owner or manager can override the credit limit.'; end if;
      v_over := true;
    end if;
  end if;

  update sales set subtotal=v_sub, discount=v_disc, tax=v_tax, total=v_total, paid=v_paid, due=v_due, cogs=v_cogs,
    credit_override_by = case when v_over then auth.uid() end where id=v_sid;
  if v_over then
    insert into audit_logs(business_id,user_id,module,action,record_id,new_value)
    values (_biz, auth.uid(), 'sales', 'credit_override', v_sid, jsonb_build_object('invoice',v_no,'limit',v_limit,'due_before',v_curdue,'added',v_due));
  end if;

  -- revenue journal
  v_lines := jsonb_build_array(jl(acct(_biz,'1100'), v_total, 0));
  if v_mob > 0 then v_lines := v_lines || jsonb_build_array(jl(acct(_biz,'4010'),0,v_mob)); end if;
  if v_acc > 0 then v_lines := v_lines || jsonb_build_array(jl(acct(_biz,'4020'),0,v_acc)); end if;
  if v_disc > 0 then v_lines := v_lines || jsonb_build_array(jl(acct(_biz,'4090'),v_disc,0)); end if;
  if v_tax > 0 then v_lines := v_lines || jsonb_build_array(jl(acct(_biz,'2100'),0,v_tax)); end if;
  if v_total > 0 then perform post_journal(_biz, v_date, 'sale', v_sid, 'Sale ' || v_no || ' to ' || v_cname, v_lines); end if;
  if v_cogs > 0 then
    perform post_journal(_biz, v_date, 'cogs', v_sid, 'Cost of goods for ' || v_no,
      jsonb_build_array(jl(acct(_biz,'5010'),v_cogs,0), jl(acct(_biz,'1200'),0,v_cogs)));
  end if;

  for pm in select * from jsonb_array_elements(coalesce(_data->'payments','[]'::jsonb)) loop
    v_amt := coalesce((pm->>'amount')::numeric,0);
    continue when v_amt <= 0;
    select ledger_account_id into v_led from money_accounts where id=(pm->>'account_id')::uuid and business_id=_biz and status='active';
    if v_led is null then raise exception 'Select the account that received the payment.'; end if;
    v_j := post_journal(_biz, v_date, 'customer_payment', v_sid, 'Receipt for ' || v_no,
      jsonb_build_array(jl(v_led,v_amt,0), jl(acct(_biz,'1100'),0,v_amt)));
    insert into money_transactions(business_id,account_id,txn_date,direction,amount,kind,method,txn_ref,note,ref_type,ref_id,journal_entry_id)
      values (_biz,(pm->>'account_id')::uuid,v_date,'in',v_amt,'sale_receipt',coalesce(nullif(pm->>'method','')::payment_method,'cash'),
              nullif(pm->>'txn_ref',''),'Receipt for ' || v_no,'sale',v_sid,v_j) returning id into v_t;
    insert into customer_payments(business_id,customer_id,sale_id,account_id,amount,method,txn_ref,paid_on,money_txn_id,journal_entry_id)
      values (_biz,v_cust,v_sid,(pm->>'account_id')::uuid,v_amt,coalesce(nullif(pm->>'method','')::payment_method,'cash'),nullif(pm->>'txn_ref',''),v_date,v_t,v_j);
  end loop;
  return v_sid;
end $$;

create or replace function public.receive_customer_payment(_biz uuid, _customer uuid, _account uuid, _amount numeric, _date date, _method public.payment_method, _txn_ref text, _note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_led uuid; v_due numeric; v_id uuid := gen_random_uuid(); v_j uuid; v_t uuid; v_name text;
begin
  if not has_biz_role(_biz, array['owner','manager','accountant','salesman','branch_manager']::member_role[]) then raise exception 'You do not have permission.'; end if;
  select name into v_name from customers where id=_customer and business_id=_biz;
  if v_name is null then raise exception 'Invalid customer.'; end if;
  select ledger_account_id into v_led from money_accounts where id=_account and business_id=_biz and status='active';
  if v_led is null then raise exception 'Select the receiving account.'; end if;
  if coalesce(_amount,0) <= 0 then raise exception 'Invalid payment amount.'; end if;
  v_due := customer_due(_customer);
  if _amount > v_due then raise exception 'Payment (৳%) is more than the customer due (৳%).', _amount, v_due; end if;
  v_j := post_journal(_biz, coalesce(_date,current_date), 'customer_payment', v_id, 'Collection from ' || v_name,
    jsonb_build_array(jl(v_led,_amount,0), jl(acct(_biz,'1100'),0,_amount)));
  insert into money_transactions(business_id,account_id,txn_date,direction,amount,kind,method,txn_ref,note,ref_type,ref_id,journal_entry_id)
    values (_biz,_account,coalesce(_date,current_date),'in',_amount,'customer_payment',_method,nullif(_txn_ref,''),'Collection from ' || v_name,'customer_payment',v_id,v_j) returning id into v_t;
  insert into customer_payments(id,business_id,customer_id,account_id,amount,method,txn_ref,paid_on,notes,money_txn_id,journal_entry_id)
    values (v_id,_biz,_customer,_account,_amount,coalesce(_method,'cash'),nullif(_txn_ref,''),coalesce(_date,current_date),nullif(_note,''),v_t,v_j);
  return v_id;
end $$;

revoke all on function public.create_sale, public.receive_customer_payment from public, anon;
grant execute on function public.create_sale, public.receive_customer_payment to authenticated;
