
create type public.account_type as enum ('asset','liability','equity','revenue','expense');
create type public.money_kind as enum ('cash','bank','mfs');

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  code text not null, name text not null, type public.account_type not null,
  is_system boolean not null default true,
  created_at timestamptz not null default now(),
  unique (business_id, code)
);
create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  entry_no bigint generated always as identity,
  entry_date date not null,
  ref_type text not null, ref_id uuid,
  memo text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.journal_entries(business_id, entry_date);
create index on public.journal_entries(ref_type, ref_id);
create table public.journal_lines (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  entry_id uuid not null references public.journal_entries(id) on delete cascade,
  account_id uuid not null references public.accounts(id),
  debit numeric(14,2) not null default 0 check (debit >= 0),
  credit numeric(14,2) not null default 0 check (credit >= 0),
  check ((debit > 0) <> (credit > 0))
);
create index on public.journal_lines(entry_id);
create index on public.journal_lines(account_id);

create table public.money_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind public.money_kind not null,
  name text not null,
  bank_name text, bank_branch text, account_no text,
  branch_id uuid references public.branches(id),
  ledger_account_id uuid not null references public.accounts(id),
  opening_balance numeric(14,2) not null default 0,
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  unique (business_id, name)
);
create table public.money_transactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  account_id uuid not null references public.money_accounts(id),
  txn_date date not null,
  direction text not null check (direction in ('in','out')),
  amount numeric(14,2) not null check (amount > 0),
  kind text not null,
  method public.payment_method,
  txn_ref text, note text,
  ref_type text, ref_id uuid,
  journal_entry_id uuid references public.journal_entries(id),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.money_transactions(business_id, txn_date);
create index on public.money_transactions(account_id, txn_date);

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  account_id uuid not null references public.accounts(id),
  created_at timestamptz not null default now(),
  unique (business_id, name)
);
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  category_id uuid not null references public.expense_categories(id),
  account_id uuid not null references public.money_accounts(id),
  expense_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  description text,
  journal_entry_id uuid references public.journal_entries(id),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.expenses(business_id, expense_date);

create table public.daily_closings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  account_id uuid not null references public.money_accounts(id),
  closing_date date not null,
  opening numeric(14,2) not null, cash_in numeric(14,2) not null, cash_out numeric(14,2) not null,
  expected numeric(14,2) not null, actual numeric(14,2) not null, variance numeric(14,2) not null,
  note text,
  closed_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (account_id, closing_date)
);

alter table public.supplier_payments add column money_txn_id uuid references public.money_transactions(id);
alter table public.supplier_payments add column journal_entry_id uuid references public.journal_entries(id);

grant select on public.accounts, public.journal_entries, public.journal_lines, public.money_accounts, public.money_transactions, public.expense_categories, public.expenses, public.daily_closings to authenticated;
grant all on public.accounts, public.journal_entries, public.journal_lines, public.money_accounts, public.money_transactions, public.expense_categories, public.expenses, public.daily_closings to service_role;

alter table public.accounts enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
alter table public.money_accounts enable row level security;
alter table public.money_transactions enable row level security;
alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;
alter table public.daily_closings enable row level security;

create policy "members read accounts" on public.accounts for select to authenticated using (public.is_member(business_id));
create policy "finance read journal" on public.journal_entries for select to authenticated using (public.has_biz_role(business_id, array['owner','manager','accountant']::public.member_role[]));
create policy "finance read journal lines" on public.journal_lines for select to authenticated using (public.has_biz_role(business_id, array['owner','manager','accountant']::public.member_role[]));
create policy "members read money accounts" on public.money_accounts for select to authenticated using (public.is_member(business_id));
create policy "finance read money txns" on public.money_transactions for select to authenticated using (public.has_biz_role(business_id, array['owner','manager','accountant','branch_manager']::public.member_role[]));
create policy "members read expense cats" on public.expense_categories for select to authenticated using (public.is_member(business_id));
create policy "finance read expenses" on public.expenses for select to authenticated using (public.has_biz_role(business_id, array['owner','manager','accountant','branch_manager']::public.member_role[]));
create policy "finance read closings" on public.daily_closings for select to authenticated using (public.has_biz_role(business_id, array['owner','manager','accountant','branch_manager']::public.member_role[]));

create trigger audit_money_accounts after insert or update or delete on public.money_accounts for each row execute function public.audit_row();
create trigger audit_expenses after insert or update or delete on public.expenses for each row execute function public.audit_row();
create trigger audit_daily_closings after insert or update or delete on public.daily_closings for each row execute function public.audit_row();
create trigger audit_journal_entries after insert or update or delete on public.journal_entries for each row execute function public.audit_row();

-- ===== Helpers =====
create or replace function public.acct(_biz uuid, _code text) returns uuid
language sql stable security definer set search_path = public as $$ select id from accounts where business_id=_biz and code=_code $$;

create or replace function public.post_journal(_biz uuid, _date date, _ref_type text, _ref_id uuid, _memo text, _lines jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; l jsonb; d numeric := 0; c numeric := 0;
begin
  for l in select * from jsonb_array_elements(_lines) loop
    d := d + coalesce((l->>'debit')::numeric,0); c := c + coalesce((l->>'credit')::numeric,0);
  end loop;
  if d <> c or d <= 0 then raise exception 'Journal not balanced (Dr % / Cr %).', d, c; end if;
  insert into journal_entries(business_id, entry_date, ref_type, ref_id, memo) values (_biz, _date, _ref_type, _ref_id, _memo) returning id into v_id;
  insert into journal_lines(business_id, entry_id, account_id, debit, credit)
  select _biz, v_id, (x->>'account_id')::uuid, coalesce((x->>'debit')::numeric,0), coalesce((x->>'credit')::numeric,0)
  from jsonb_array_elements(_lines) x
  where coalesce((x->>'debit')::numeric,0) > 0 or coalesce((x->>'credit')::numeric,0) > 0;
  return v_id;
end $$;
revoke all on function public.post_journal from public, anon, authenticated;
revoke all on function public.acct from public, anon;
grant execute on function public.acct to authenticated;

create or replace function public.jl(_acc uuid, _dr numeric, _cr numeric) returns jsonb
language sql immutable as $$ select jsonb_build_object('account_id', _acc, 'debit', _dr, 'credit', _cr) $$;

create or replace function public.seed_finance(_biz uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  insert into accounts(business_id, code, name, type) values
    (_biz,'1010','Cash','asset'),(_biz,'1020','Bank','asset'),(_biz,'1030','Mobile Banking (bKash/Nagad/Rocket)','asset'),
    (_biz,'1100','Customer Due (Receivable)','asset'),(_biz,'1200','Inventory','asset'),
    (_biz,'2010','Supplier Due (Payable)','liability'),(_biz,'2100','VAT / Tax Payable','liability'),(_biz,'2200','Loan','liability'),(_biz,'2900','Other Liability','liability'),
    (_biz,'3010','Owner''s Capital','equity'),(_biz,'3020','Opening Balance Equity','equity'),(_biz,'3030','Owner''s Drawings','equity'),
    (_biz,'4010','Mobile Sales','revenue'),(_biz,'4020','Accessories Sales','revenue'),(_biz,'4900','Other Income','revenue'),
    (_biz,'5010','Cost of Goods Sold','expense'),
    (_biz,'6010','Rent','expense'),(_biz,'6020','Salary','expense'),(_biz,'6030','Electricity','expense'),(_biz,'6040','Internet','expense'),
    (_biz,'6050','Transport','expense'),(_biz,'6060','Courier','expense'),(_biz,'6070','Packaging','expense'),(_biz,'6080','Marketing','expense'),
    (_biz,'6090','Facebook Ads','expense'),(_biz,'6100','Repair','expense'),(_biz,'6110','Office Expense','expense'),(_biz,'6120','Bank Charge','expense'),
    (_biz,'6130','Government Fee','expense'),(_biz,'6190','Other Expense','expense')
  on conflict (business_id, code) do nothing;
  for r in select id, name from accounts where business_id=_biz and code between '6000' and '6999' loop
    insert into expense_categories(business_id, name, account_id) values (_biz, replace(r.name,'Other Expense','Other'), r.id) on conflict do nothing;
  end loop;
  insert into money_accounts(business_id, kind, name, ledger_account_id, branch_id)
  values (_biz, 'cash', 'Main Cash', acct(_biz,'1010'), (select id from branches where business_id=_biz and kind='head' limit 1))
  on conflict do nothing;
end $$;
revoke all on function public.seed_finance from public, anon, authenticated;

create or replace function public.money_ledger_code(_k public.money_kind) returns text
language sql immutable as $$ select case _k when 'cash' then '1010' when 'bank' then '1020' else '1030' end $$;

-- update onboarding to also seed finance
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
  perform seed_finance(biz);
  return biz;
end $$;

-- ===== Money accounts =====
create or replace function public.create_money_account(_biz uuid, _kind public.money_kind, _name text, _bank_name text, _bank_branch text, _account_no text, _opening numeric, _branch uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_led uuid := acct(_biz, money_ledger_code(_kind)); v_j uuid;
begin
  if not has_biz_role(_biz, array['owner','manager','accountant']::member_role[]) then raise exception 'You do not have permission.'; end if;
  if coalesce(trim(_name),'') = '' then raise exception 'Account name is required.'; end if;
  if coalesce(_opening,0) < 0 then raise exception 'Opening balance cannot be negative.'; end if;
  insert into money_accounts(business_id, kind, name, bank_name, bank_branch, account_no, ledger_account_id, opening_balance, branch_id)
  values (_biz, _kind, trim(_name), nullif(_bank_name,''), nullif(_bank_branch,''), nullif(_account_no,''), v_led, coalesce(_opening,0), _branch) returning id into v_id;
  if coalesce(_opening,0) > 0 then
    v_j := post_journal(_biz, current_date, 'opening', v_id, 'Opening balance: ' || _name,
      jsonb_build_array(jl(v_led,_opening,0), jl(acct(_biz,'3020'),0,_opening)));
  end if;
  return v_id;
end $$;

create or replace function public.money_balance(_account uuid, _upto date default null) returns numeric
language sql stable security definer set search_path = public as $$
  select ma.opening_balance + coalesce(sum(case when t.direction='in' then t.amount else -t.amount end),0)
  from money_accounts ma left join money_transactions t on t.account_id=ma.id and (_upto is null or t.txn_date <= _upto)
  where ma.id=_account and is_member(ma.business_id) group by ma.opening_balance $$;

create view public.money_account_balances with (security_invoker = true) as
select ma.id, ma.business_id, ma.kind, ma.name, ma.bank_name, ma.bank_branch, ma.account_no, ma.opening_balance, ma.status,
  ma.opening_balance + coalesce((select sum(case when t.direction='in' then t.amount else -t.amount end) from money_transactions t where t.account_id=ma.id),0) as balance
from money_accounts ma;
grant select on public.money_account_balances to authenticated;

create or replace function public._money_out_check(_acc uuid, _amount numeric) returns void
language plpgsql security definer set search_path = public as $$
declare b numeric;
begin
  select opening_balance + coalesce((select sum(case when direction='in' then amount else -amount end) from money_transactions where account_id=_acc),0)
    into b from money_accounts where id=_acc;
  if b < _amount then raise exception 'Insufficient balance in this account (available ৳%).', b; end if;
end $$;
revoke all on function public._money_out_check from public, anon, authenticated;

-- Cash in / out (non-trade)
create or replace function public.record_money_txn(_biz uuid, _account uuid, _direction text, _kind text, _amount numeric, _date date, _method public.payment_method, _txn_ref text, _note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_led uuid; v_other uuid; v_j uuid; v_id uuid;
begin
  if not has_biz_role(_biz, array['owner','manager','accountant']::member_role[]) then raise exception 'You do not have permission.'; end if;
  select ledger_account_id into v_led from money_accounts where id=_account and business_id=_biz and status='active';
  if v_led is null then raise exception 'Invalid account.'; end if;
  if coalesce(_amount,0) <= 0 then raise exception 'Invalid payment amount.'; end if;
  if _direction not in ('in','out') then raise exception 'Invalid direction.'; end if;
  v_other := case
    when _direction='in' and _kind='other_income' then acct(_biz,'4900')
    when _direction='in' and _kind='owner_capital' then acct(_biz,'3010')
    when _direction='in' and _kind='loan_received' then acct(_biz,'2200')
    when _direction='out' and _kind='owner_drawing' then acct(_biz,'3030')
    when _direction='out' and _kind='loan_repayment' then acct(_biz,'2200')
    when _kind='adjustment' then acct(_biz,'6190')
    else null end;
  if v_other is null then raise exception 'Invalid transaction type.'; end if;
  if _direction='out' then perform _money_out_check(_account, _amount); end if;
  v_j := post_journal(_biz, coalesce(_date,current_date), _kind, null, coalesce(nullif(_note,''), _kind),
    case when _direction='in' then jsonb_build_array(jl(v_led,_amount,0), jl(v_other,0,_amount))
         else jsonb_build_array(jl(v_other,_amount,0), jl(v_led,0,_amount)) end);
  insert into money_transactions(business_id, account_id, txn_date, direction, amount, kind, method, txn_ref, note, journal_entry_id)
  values (_biz, _account, coalesce(_date,current_date), _direction, _amount, _kind, _method, nullif(_txn_ref,''), nullif(_note,''), v_j) returning id into v_id;
  return v_id;
end $$;

create or replace function public.transfer_money(_biz uuid, _from uuid, _to uuid, _amount numeric, _date date, _note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare lf uuid; lt uuid; v_j uuid; v_ref uuid := gen_random_uuid();
begin
  if not has_biz_role(_biz, array['owner','manager','accountant']::member_role[]) then raise exception 'You do not have permission.'; end if;
  if _from = _to then raise exception 'Choose two different accounts.'; end if;
  select ledger_account_id into lf from money_accounts where id=_from and business_id=_biz and status='active';
  select ledger_account_id into lt from money_accounts where id=_to and business_id=_biz and status='active';
  if lf is null or lt is null then raise exception 'Invalid account.'; end if;
  if coalesce(_amount,0) <= 0 then raise exception 'Invalid amount.'; end if;
  perform _money_out_check(_from, _amount);
  v_j := post_journal(_biz, coalesce(_date,current_date), 'transfer', v_ref, coalesce(nullif(_note,''),'Fund transfer'),
    jsonb_build_array(jl(lt,_amount,0), jl(lf,0,_amount)));
  insert into money_transactions(business_id, account_id, txn_date, direction, amount, kind, note, ref_type, ref_id, journal_entry_id) values
    (_biz,_from,coalesce(_date,current_date),'out',_amount,'transfer_out',nullif(_note,''),'transfer',v_ref,v_j),
    (_biz,_to,coalesce(_date,current_date),'in',_amount,'transfer_in',nullif(_note,''),'transfer',v_ref,v_j);
  return v_ref;
end $$;

-- Expenses
create or replace function public.create_expense(_biz uuid, _branch uuid, _category uuid, _account uuid, _amount numeric, _date date, _description text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_exp_acc uuid; v_led uuid; v_id uuid := gen_random_uuid(); v_j uuid; v_cat text;
begin
  if not has_biz_role(_biz, array['owner','manager','accountant','branch_manager']::member_role[]) then raise exception 'You do not have permission.'; end if;
  select account_id, name into v_exp_acc, v_cat from expense_categories where id=_category and business_id=_biz;
  select ledger_account_id into v_led from money_accounts where id=_account and business_id=_biz and status='active';
  if v_exp_acc is null then raise exception 'Select an expense category.'; end if;
  if v_led is null then raise exception 'Select a cash/bank account.'; end if;
  if not exists(select 1 from branches where id=_branch and business_id=_biz) then raise exception 'Invalid branch.'; end if;
  if coalesce(_amount,0) <= 0 then raise exception 'Invalid amount.'; end if;
  perform _money_out_check(_account, _amount);
  v_j := post_journal(_biz, coalesce(_date,current_date), 'expense', v_id, v_cat || coalesce(': ' || nullif(_description,''), ''),
    jsonb_build_array(jl(v_exp_acc,_amount,0), jl(v_led,0,_amount)));
  insert into expenses(id, business_id, branch_id, category_id, account_id, expense_date, amount, description, journal_entry_id)
  values (v_id, _biz, _branch, _category, _account, coalesce(_date,current_date), _amount, nullif(_description,''), v_j);
  insert into money_transactions(business_id, account_id, txn_date, direction, amount, kind, note, ref_type, ref_id, journal_entry_id)
  values (_biz, _account, coalesce(_date,current_date), 'out', _amount, 'expense', v_cat, 'expense', v_id, v_j);
  return v_id;
end $$;

create or replace function public.add_expense_category(_biz uuid, _name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_code int; v_acc uuid; v_id uuid;
begin
  if not has_biz_role(_biz, array['owner','manager','accountant']::member_role[]) then raise exception 'You do not have permission.'; end if;
  if coalesce(trim(_name),'') = '' then raise exception 'Category name is required.'; end if;
  select coalesce(max(code::int),6190)+10 into v_code from accounts where business_id=_biz and code ~ '^6[0-9]{3}$' and code::int > 6190;
  if v_code > 6990 then raise exception 'Too many expense categories.'; end if;
  insert into accounts(business_id, code, name, type, is_system) values (_biz, v_code::text, trim(_name), 'expense', false) returning id into v_acc;
  insert into expense_categories(business_id, name, account_id) values (_biz, trim(_name), v_acc) returning id into v_id;
  return v_id;
end $$;

-- Supplier payment (later payment)
create or replace function public.pay_supplier(_biz uuid, _supplier uuid, _account uuid, _amount numeric, _date date, _method public.payment_method, _txn_ref text, _note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_led uuid; v_due numeric; v_id uuid := gen_random_uuid(); v_j uuid; v_t uuid; v_name text;
begin
  if not has_biz_role(_biz, array['owner','manager','accountant','purchase_officer']::member_role[]) then raise exception 'You do not have permission.'; end if;
  select name into v_name from suppliers where id=_supplier and business_id=_biz;
  if v_name is null then raise exception 'Invalid supplier.'; end if;
  select ledger_account_id into v_led from money_accounts where id=_account and business_id=_biz and status='active';
  if v_led is null then raise exception 'Select a cash/bank account.'; end if;
  if coalesce(_amount,0) <= 0 then raise exception 'Invalid payment amount.'; end if;
  select s.opening_payable + coalesce((select sum(total) from purchases where supplier_id=s.id and status='posted'),0)
       - coalesce((select sum(amount) from supplier_payments where supplier_id=s.id),0) into v_due from suppliers s where s.id=_supplier;
  if _amount > v_due then raise exception 'Payment (৳%) is more than the supplier due (৳%).', _amount, v_due; end if;
  perform _money_out_check(_account, _amount);
  v_j := post_journal(_biz, coalesce(_date,current_date), 'supplier_payment', v_id, 'Payment to ' || v_name,
    jsonb_build_array(jl(acct(_biz,'2010'),_amount,0), jl(v_led,0,_amount)));
  insert into money_transactions(business_id, account_id, txn_date, direction, amount, kind, method, txn_ref, note, ref_type, ref_id, journal_entry_id)
  values (_biz,_account,coalesce(_date,current_date),'out',_amount,'supplier_payment',_method,nullif(_txn_ref,''),'Payment to ' || v_name,'supplier_payment',v_id,v_j) returning id into v_t;
  insert into supplier_payments(id, business_id, supplier_id, amount, method, txn_ref, paid_on, notes, money_txn_id, journal_entry_id)
  values (v_id,_biz,_supplier,_amount,coalesce(_method,'cash'),nullif(_txn_ref,''),coalesce(_date,current_date),nullif(_note,''),v_t,v_j);
  return v_id;
end $$;

-- Purchase posting with accounting (replaces phase-2 version)
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
  v_acc uuid := nullif(_data->>'account_id','')::uuid; v_led uuid;
  v_date date := coalesce((_data->>'purchase_date')::date,current_date);
  v_total numeric(14,2); v_extra numeric; v_factor numeric;
  v_no text; v_seq int; it jsonb; im jsonb; v_item uuid; v_var uuid; v_qty int; v_rate numeric(14,2);
  v_line numeric(14,2); v_unit numeric(14,2); v_serial boolean; v_imeis jsonb; v_imei_id uuid;
  v_j uuid; v_t uuid; v_sname text; v_method payment_method := coalesce(nullif(_data->>'payment_method','')::payment_method,'cash');
begin
  if not has_biz_role(_biz, array['owner','manager','purchase_officer','store_keeper']::member_role[]) then
    raise exception 'You do not have permission to create purchases.'; end if;
  select name into v_sname from suppliers where id=v_supplier and business_id=_biz;
  if v_sname is null then raise exception 'Invalid supplier.'; end if;
  if exists(select 1 from suppliers where id=v_supplier and status='inactive') then raise exception 'Supplier is inactive.'; end if;
  if not exists(select 1 from branches where id=v_branch and business_id=_biz and status='active') then raise exception 'Invalid branch.'; end if;
  if jsonb_array_length(coalesce(_data->'items','[]'::jsonb)) = 0 then raise exception 'Add at least one product.'; end if;
  if least(v_disc,v_tax,v_tr,v_ld,v_cr,v_in,v_ot,v_paid) < 0 then raise exception 'Amounts cannot be negative.'; end if;
  if v_paid > 0 then
    select ledger_account_id into v_led from money_accounts where id=v_acc and business_id=_biz and status='active';
    if v_led is null then raise exception 'Select the cash/bank account used for payment.'; end if;
  end if;

  for it in select * from jsonb_array_elements(_data->'items') loop
    v_qty := (it->>'qty')::int; v_rate := (it->>'rate')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantity must be at least 1.'; end if;
    if v_rate is null or v_rate < 0 then raise exception 'Invalid purchase rate.'; end if;
    v_sub := v_sub + round(v_qty * v_rate, 2);
  end loop;

  v_total := v_sub - v_disc + v_tax + v_tr + v_ld + v_cr + v_in + v_ot;
  if v_total < 0 then raise exception 'Discount is larger than the purchase amount.'; end if;
  if v_paid > v_total then raise exception 'Paid amount cannot exceed total (৳%).', v_total; end if;
  if v_paid > 0 then perform _money_out_check(v_acc, v_paid); end if;
  v_extra := v_total - v_sub;
  v_factor := case when v_sub > 0 then v_extra / v_sub else 0 end;

  perform pg_advisory_xact_lock(hashtext('purchase_no_' || _biz::text));
  select coalesce(max(nullif(regexp_replace(invoice_no,'\D','','g'),'')::int),0)+1 into v_seq from purchases where business_id=_biz;
  v_no := 'PUR-' || lpad(v_seq::text, 6, '0');

  insert into purchases(business_id,branch_id,supplier_id,invoice_no,supplier_invoice_no,purchase_date,subtotal,discount,tax,
    transport_cost,loading_cost,courier_cost,insurance_cost,other_cost,total,paid,due,notes)
  values (_biz,v_branch,v_supplier,v_no,nullif(_data->>'supplier_invoice_no',''),v_date,
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
        if (im->>'imei1') !~ '^[0-9]{15}$' then raise exception 'Invalid IMEI (must be 15 digits): %', im->>'imei1'; end if;
        if exists(select 1 from product_imeis where business_id=_biz and (imei1 = im->>'imei1' or imei2 = im->>'imei1'
             or (nullif(im->>'imei2','') is not null and (imei1 = im->>'imei2' or imei2 = im->>'imei2')))) then
          raise exception 'IMEI already exists: %', im->>'imei1'; end if;
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
  end loop;

  if v_total > 0 then
    perform post_journal(_biz, v_date, 'purchase', v_pid, 'Purchase ' || v_no || ' from ' || v_sname,
      jsonb_build_array(jl(acct(_biz,'1200'),v_total,0), jl(acct(_biz,'2010'),0,v_total)));
  end if;
  if v_paid > 0 then
    v_j := post_journal(_biz, v_date, 'supplier_payment', v_pid, 'Payment for ' || v_no,
      jsonb_build_array(jl(acct(_biz,'2010'),v_paid,0), jl(v_led,0,v_paid)));
    insert into money_transactions(business_id,account_id,txn_date,direction,amount,kind,method,txn_ref,note,ref_type,ref_id,journal_entry_id)
      values (_biz,v_acc,v_date,'out',v_paid,'supplier_payment',v_method,nullif(_data->>'txn_ref',''),'Payment for ' || v_no,'purchase',v_pid,v_j)
      returning id into v_t;
    insert into supplier_payments(business_id,supplier_id,purchase_id,branch_id,amount,method,txn_ref,paid_on,money_txn_id,journal_entry_id)
      values (_biz,v_supplier,v_pid,v_branch,v_paid,v_method,nullif(_data->>'txn_ref',''),v_date,v_t,v_j);
  end if;
  return v_pid;
end $$;

-- Daily closing
create or replace function public.close_day(_biz uuid, _account uuid, _date date, _actual numeric, _note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_open numeric; v_in numeric; v_out numeric; v_exp numeric; v_id uuid;
begin
  if not has_biz_role(_biz, array['owner','manager','accountant','branch_manager']::member_role[]) then raise exception 'You do not have permission.'; end if;
  if not exists(select 1 from money_accounts where id=_account and business_id=_biz and kind='cash') then raise exception 'Select a cash account.'; end if;
  if _actual is null or _actual < 0 then raise exception 'Enter the counted cash.'; end if;
  if _date > current_date then raise exception 'Cannot close a future date.'; end if;
  select opening_balance + coalesce((select sum(case when direction='in' then amount else -amount end) from money_transactions where account_id=_account and txn_date < _date),0)
    into v_open from money_accounts where id=_account;
  select coalesce(sum(amount) filter (where direction='in'),0), coalesce(sum(amount) filter (where direction='out'),0)
    into v_in, v_out from money_transactions where account_id=_account and txn_date=_date;
  v_exp := v_open + v_in - v_out;
  insert into daily_closings(business_id, account_id, closing_date, opening, cash_in, cash_out, expected, actual, variance, note)
  values (_biz, _account, _date, v_open, v_in, v_out, v_exp, _actual, _actual - v_exp, nullif(_note,'')) returning id into v_id;
  return v_id;
exception when unique_violation then raise exception 'This day is already closed for this account.';
end $$;

-- Reports (security invoker: RLS applies)
create or replace function public.account_totals(_biz uuid, _from date, _to date)
returns table(account_id uuid, code text, name text, type public.account_type, debit numeric, credit numeric)
language sql stable set search_path = public as $$
  select a.id, a.code, a.name, a.type, coalesce(sum(l.debit),0), coalesce(sum(l.credit),0)
  from accounts a
  left join journal_lines l on l.account_id=a.id
    and exists(select 1 from journal_entries e where e.id=l.entry_id and (_from is null or e.entry_date >= _from) and e.entry_date <= _to)
  where a.business_id=_biz
  group by a.id order by a.code $$;

revoke all on function public.create_money_account, public.record_money_txn, public.transfer_money, public.create_expense,
  public.add_expense_category, public.pay_supplier, public.close_day, public.account_totals, public.money_balance from public, anon;
grant execute on function public.create_money_account, public.record_money_txn, public.transfer_money, public.create_expense,
  public.add_expense_category, public.pay_supplier, public.close_day, public.account_totals, public.money_balance to authenticated;
grant execute on function public.create_purchase to authenticated;

-- Backfill existing businesses and purchases
do $$ declare b record; p record; v_led uuid; v_acc uuid; v_j uuid; v_t uuid;
begin
  for b in select id from businesses loop perform seed_finance(b.id); end loop;
  for p in select pu.*, s.name as sname from purchases pu join suppliers s on s.id=pu.supplier_id
           where pu.status='posted' and not exists(select 1 from journal_entries e where e.ref_type='purchase' and e.ref_id=pu.id) loop
    if p.total > 0 then
      perform post_journal(p.business_id, p.purchase_date, 'purchase', p.id, 'Purchase ' || p.invoice_no || ' from ' || p.sname,
        jsonb_build_array(jl(acct(p.business_id,'1200'),p.total,0), jl(acct(p.business_id,'2010'),0,p.total)));
    end if;
  end loop;
  for p in select sp.* from supplier_payments sp where sp.journal_entry_id is null loop
    select id, ledger_account_id into v_acc, v_led from money_accounts where business_id=p.business_id and name='Main Cash';
    v_j := post_journal(p.business_id, p.paid_on, 'supplier_payment', p.purchase_id, 'Payment (backfill)',
      jsonb_build_array(jl(acct(p.business_id,'2010'),p.amount,0), jl(v_led,0,p.amount)));
    insert into money_transactions(business_id,account_id,txn_date,direction,amount,kind,method,txn_ref,note,ref_type,ref_id,journal_entry_id)
      values (p.business_id,v_acc,p.paid_on,'out',p.amount,'supplier_payment',p.method,p.txn_ref,'Supplier payment','purchase',p.purchase_id,v_j) returning id into v_t;
    update supplier_payments set journal_entry_id=v_j, money_txn_id=v_t where id=p.id;
  end loop;
end $$;
