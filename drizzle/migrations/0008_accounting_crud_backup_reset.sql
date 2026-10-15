ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS reversed_at timestamptz, ADD COLUMN IF NOT EXISTS reversal_reason text;
ALTER TABLE public.money_transactions ADD COLUMN IF NOT EXISTS reversed_at timestamptz, ADD COLUMN IF NOT EXISTS reversal_of uuid;
ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS reversed_at timestamptz, ADD COLUMN IF NOT EXISTS reversal_of uuid;

-- bulk guard for restore/reset
CREATE OR REPLACE FUNCTION public._bulk() RETURNS boolean LANGUAGE sql STABLE AS $$ select coalesce(current_setting('app.bulk', true),'') = 'on' $$;

CREATE OR REPLACE FUNCTION public.audit_row() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare r jsonb := to_jsonb(coalesce(new, old));
begin
  if _bulk() then return coalesce(new, old); end if;
  insert into audit_logs(business_id, user_id, module, action, record_id, old_value, new_value)
  values ((r->>'business_id')::uuid, auth.uid(), tg_table_name, lower(tg_op), (r->>'id')::uuid,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $function$;

CREATE OR REPLACE FUNCTION public.seed_finance_v2() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
begin
  if _bulk() then return new; end if;
  if new.code = '4010' then
    insert into accounts(business_id, code, name, type) values (new.business_id, '4090', 'Sales Discount', 'revenue') on conflict do nothing;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.party_opening_journal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare v_old numeric := 0; v_new numeric; v_diff numeric; v_is_cust boolean := tg_table_name = 'customers';
begin
  if _bulk() then return new; end if;
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
end $function$;

-- reverse a journal entry (internal)
CREATE OR REPLACE FUNCTION public._reverse_journal(_biz uuid, _entry uuid, _memo text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_new uuid;
begin
  if _entry is null then return null; end if;
  if exists(select 1 from journal_entries where id=_entry and business_id=_biz and reversed_at is not null) then raise exception 'This entry is already reversed.'; end if;
  v_new := post_journal(_biz, current_date, 'reversal', _entry, _memo,
    (select jsonb_agg(jsonb_build_object('account_id', account_id, 'debit', credit, 'credit', debit)) from journal_lines where entry_id=_entry and business_id=_biz));
  update journal_entries set reversal_of=_entry where id=v_new;
  update journal_entries set reversed_at=now() where id=_entry;
  return v_new;
end $$;

CREATE OR REPLACE FUNCTION public.reverse_expense(_biz uuid, _id uuid, _reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare e record;
begin
  if not has_biz_role(_biz, array['owner','manager','accountant']::member_role[]) then raise exception 'You do not have permission.'; end if;
  select * into e from expenses where id=_id and business_id=_biz for update;
  if e.id is null then raise exception 'Expense not found.'; end if;
  if e.reversed_at is not null then raise exception 'This expense is already cancelled.'; end if;
  perform _reverse_journal(_biz, e.journal_entry_id, 'Cancelled expense' || coalesce(': ' || nullif(_reason,''), ''));
  update money_transactions set reversed_at=now() where business_id=_biz and ref_type='expense' and ref_id=_id and reversal_of is null;
  insert into money_transactions(business_id, account_id, txn_date, direction, amount, kind, note, ref_type, ref_id, reversal_of)
  select _biz, account_id, current_date, 'in', amount, 'reversal', 'Expense cancelled', 'expense', _id, id
  from money_transactions where business_id=_biz and ref_type='expense' and ref_id=_id and reversal_of is null;
  update expenses set reversed_at=now(), reversal_reason=nullif(_reason,'') where id=_id;
end $$;

CREATE OR REPLACE FUNCTION public.update_expense(_biz uuid, _id uuid, _branch uuid, _category uuid, _account uuid, _amount numeric, _date date, _description text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  perform reverse_expense(_biz, _id, 'Edited');
  return create_expense(_biz, _branch, _category, _account, _amount, _date, _description);
end $$;

CREATE OR REPLACE FUNCTION public.reverse_money_txn(_biz uuid, _id uuid, _reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare t record; r record;
begin
  if not has_biz_role(_biz, array['owner','manager','accountant']::member_role[]) then raise exception 'You do not have permission.'; end if;
  select * into t from money_transactions where id=_id and business_id=_biz;
  if t.id is null then raise exception 'Transaction not found.'; end if;
  if t.reversed_at is not null or t.reversal_of is not null then raise exception 'This entry is already cancelled.'; end if;
  if t.kind not in ('other_income','owner_capital','loan_received','owner_drawing','loan_repayment','adjustment','transfer_in','transfer_out') then
    raise exception 'This entry comes from a sale, purchase, payment or expense. Cancel it from that page (Return / Cancel expense).';
  end if;
  for r in select * from money_transactions where business_id=_biz and reversal_of is null and reversed_at is null
           and (id=_id or (t.ref_type='transfer' and ref_type='transfer' and ref_id=t.ref_id)) loop
    if r.direction='in' then perform _money_out_check(r.account_id, r.amount); end if;
    insert into money_transactions(business_id, account_id, txn_date, direction, amount, kind, note, ref_type, ref_id, reversal_of)
    values (_biz, r.account_id, current_date, case when r.direction='in' then 'out' else 'in' end, r.amount, 'reversal',
            'Cancelled' || coalesce(': ' || nullif(_reason,''), ''), r.ref_type, r.ref_id, r.id);
    update money_transactions set reversed_at=now() where id=r.id;
  end loop;
  perform _reverse_journal(_biz, t.journal_entry_id, 'Cancelled entry' || coalesce(': ' || nullif(_reason,''), ''));
end $$;

CREATE OR REPLACE FUNCTION public.update_money_account(_biz uuid, _id uuid, _name text, _bank_name text, _bank_branch text, _account_no text, _branch uuid, _status record_status) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if not has_biz_role(_biz, array['owner','manager','accountant']::member_role[]) then raise exception 'You do not have permission.'; end if;
  if coalesce(trim(_name),'') = '' then raise exception 'Account name is required.'; end if;
  update money_accounts set name=trim(_name), bank_name=nullif(_bank_name,''), bank_branch=nullif(_bank_branch,''), account_no=nullif(_account_no,''),
    branch_id=_branch, status=coalesce(_status,status) where id=_id and business_id=_biz;
  if not found then raise exception 'Account not found.'; end if;
end $$;

CREATE OR REPLACE FUNCTION public.delete_money_account(_biz uuid, _id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if not has_biz_role(_biz, array['owner','manager','accountant']::member_role[]) then raise exception 'You do not have permission.'; end if;
  if exists(select 1 from money_transactions where account_id=_id) or exists(select 1 from money_accounts where id=_id and opening_balance <> 0)
     or exists(select 1 from expenses where account_id=_id) or exists(select 1 from customer_payments where account_id=_id) or exists(select 1 from daily_closings where account_id=_id) then
    raise exception 'This account has history. Mark it Inactive instead of deleting.';
  end if;
  delete from money_accounts where id=_id and business_id=_biz;
end $$;

CREATE OR REPLACE FUNCTION public.update_expense_category(_biz uuid, _id uuid, _name text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_acc uuid;
begin
  if not has_biz_role(_biz, array['owner','manager','accountant']::member_role[]) then raise exception 'You do not have permission.'; end if;
  if coalesce(trim(_name),'') = '' then raise exception 'Category name is required.'; end if;
  update expense_categories set name=trim(_name) where id=_id and business_id=_biz returning account_id into v_acc;
  if v_acc is null then raise exception 'Category not found.'; end if;
  update accounts set name=trim(_name) where id=v_acc and is_system=false;
end $$;

CREATE OR REPLACE FUNCTION public.delete_expense_category(_biz uuid, _id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_acc uuid;
begin
  if not has_biz_role(_biz, array['owner','manager','accountant']::member_role[]) then raise exception 'You do not have permission.'; end if;
  if exists(select 1 from expenses where category_id=_id) then raise exception 'This category has expenses and cannot be deleted.'; end if;
  delete from expense_categories where id=_id and business_id=_biz returning account_id into v_acc;
  if v_acc is not null and not exists(select 1 from journal_lines where account_id=v_acc) and not exists(select 1 from expense_categories where account_id=v_acc) then
    delete from accounts where id=v_acc and is_system=false;
  end if;
end $$;

-- chart of accounts CRUD (custom accounts only)
CREATE OR REPLACE FUNCTION public.create_account(_biz uuid, _code text, _name text, _type account_type) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_id uuid;
begin
  if not has_biz_role(_biz, array['owner','manager','accountant']::member_role[]) then raise exception 'You do not have permission.'; end if;
  if coalesce(trim(_name),'') = '' or coalesce(trim(_code),'') !~ '^[0-9]{4}$' then raise exception 'Enter a 4-digit code and a name.'; end if;
  if exists(select 1 from accounts where business_id=_biz and code=trim(_code)) then raise exception 'This account code already exists.'; end if;
  insert into accounts(business_id, code, name, type, is_system) values (_biz, trim(_code), trim(_name), _type, false) returning id into v_id;
  return v_id;
end $$;

CREATE OR REPLACE FUNCTION public.update_account(_biz uuid, _id uuid, _name text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if not has_biz_role(_biz, array['owner','manager','accountant']::member_role[]) then raise exception 'You do not have permission.'; end if;
  if coalesce(trim(_name),'') = '' then raise exception 'Name is required.'; end if;
  update accounts set name=trim(_name) where id=_id and business_id=_biz and is_system=false;
  if not found then raise exception 'System accounts cannot be renamed.'; end if;
  update expense_categories set name=trim(_name) where account_id=_id;
end $$;

CREATE OR REPLACE FUNCTION public.delete_account(_biz uuid, _id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if not has_biz_role(_biz, array['owner','manager','accountant']::member_role[]) then raise exception 'You do not have permission.'; end if;
  if exists(select 1 from accounts where id=_id and is_system) then raise exception 'System accounts cannot be deleted.'; end if;
  if exists(select 1 from journal_lines where account_id=_id) or exists(select 1 from money_accounts where ledger_account_id=_id) or exists(select 1 from expense_categories where account_id=_id) then
    raise exception 'This account is in use and cannot be deleted.';
  end if;
  delete from accounts where id=_id and business_id=_biz;
end $$;

-- manual journal entries (control accounts blocked so sub-ledgers stay correct)
CREATE OR REPLACE FUNCTION public.create_manual_journal(_biz uuid, _date date, _memo text, _lines jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if not has_biz_role(_biz, array['owner','manager','accountant']::member_role[]) then raise exception 'You do not have permission.'; end if;
  if coalesce(trim(_memo),'') = '' then raise exception 'Enter a description.'; end if;
  if exists(select 1 from jsonb_array_elements(_lines) x left join accounts a on a.id=(x->>'account_id')::uuid and a.business_id=_biz where a.id is null) then
    raise exception 'Invalid account in entry.'; end if;
  if exists(select 1 from jsonb_array_elements(_lines) x join accounts a on a.id=(x->>'account_id')::uuid
            where a.code in ('1010','1020','1030','1100','1200','2010') or exists(select 1 from money_accounts m where m.ledger_account_id=a.id)) then
    raise exception 'Cash, bank, customer due, supplier due and inventory are updated automatically. Use their own pages instead.';
  end if;
  return post_journal(_biz, coalesce(_date,current_date), 'manual', null, trim(_memo), _lines);
end $$;

CREATE OR REPLACE FUNCTION public.reverse_journal(_biz uuid, _id uuid, _reason text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if not has_biz_role(_biz, array['owner','manager','accountant']::member_role[]) then raise exception 'You do not have permission.'; end if;
  if not exists(select 1 from journal_entries where id=_id and business_id=_biz and ref_type='manual') then
    raise exception 'Only manual entries can be reversed here. Automatic entries are reversed from their own page.';
  end if;
  return _reverse_journal(_biz, _id, 'Reversal' || coalesce(': ' || nullif(_reason,''), ''));
end $$;

-- ===== Backup / Restore / Reset (owner only) =====
CREATE OR REPLACE FUNCTION public._biz_tables() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  select array['branches','brands','categories','accounts','products','product_variants','customers','suppliers','money_accounts','expense_categories',
    'commission_rules','journal_entries','journal_lines','money_transactions','purchases','purchase_items','product_imeis','sales','sale_items',
    'customer_payments','supplier_payments','expenses','sales_returns','sales_return_items','purchase_returns','purchase_return_items','stock',
    'stock_movements','stock_transfers','stock_transfer_items','warranty_claims','daily_closings']
$$;

CREATE OR REPLACE FUNCTION public.export_business(_biz uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare t text; v jsonb; o jsonb := '{}'::jsonb;
begin
  if not has_biz_role(_biz, array['owner']::member_role[]) then raise exception 'Only the owner can download a backup.'; end if;
  foreach t in array _biz_tables() loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from %I x where business_id=$1', t) into v using _biz;
    o := o || jsonb_build_object(t, v);
  end loop;
  insert into audit_logs(business_id, user_id, module, action) values (_biz, auth.uid(), 'backup', 'export');
  return jsonb_build_object('app','MOBILE D-ERP','version',1,'business_id',_biz,
    'business_name',(select name from businesses where id=_biz),'exported_at',now(),'tables',o);
end $$;

CREATE OR REPLACE FUNCTION public._wipe_business(_biz uuid, _full boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  perform set_config('app.bulk','on',true);
  delete from daily_closings where business_id=_biz;
  delete from warranty_claims where business_id=_biz;
  delete from stock_transfer_items where business_id=_biz;
  delete from stock_transfers where business_id=_biz;
  delete from stock_movements where business_id=_biz;
  delete from stock where business_id=_biz;
  delete from purchase_return_items where business_id=_biz;
  delete from purchase_returns where business_id=_biz;
  delete from sales_return_items where business_id=_biz;
  delete from sales_returns where business_id=_biz;
  delete from customer_payments where business_id=_biz;
  delete from supplier_payments where business_id=_biz;
  delete from expenses where business_id=_biz;
  update product_imeis set sale_item_id=null where business_id=_biz and sale_item_id is not null;
  delete from sale_items where business_id=_biz;
  delete from sales where business_id=_biz;
  delete from product_imeis where business_id=_biz;
  delete from purchase_items where business_id=_biz;
  delete from purchases where business_id=_biz;
  delete from money_transactions where business_id=_biz;
  delete from journal_lines where business_id=_biz;
  delete from journal_entries where business_id=_biz;
  if _full then
    delete from commission_rules where business_id=_biz;
    delete from product_variants where business_id=_biz;
    delete from products where business_id=_biz;
    delete from categories where business_id=_biz;
    delete from brands where business_id=_biz;
    delete from customers where business_id=_biz;
    delete from suppliers where business_id=_biz;
    delete from money_accounts where business_id=_biz;
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.reset_business(_biz uuid, _mode text, _confirm text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare r record;
begin
  if not has_biz_role(_biz, array['owner']::member_role[]) then raise exception 'Only the owner can reset data.'; end if;
  if _confirm <> 'RESET' then raise exception 'Type RESET to confirm.'; end if;
  if _mode not in ('transactions','full') then raise exception 'Invalid reset type.'; end if;
  perform _wipe_business(_biz, _mode='full');
  perform set_config('app.bulk','off',true);
  if _mode='full' then
    perform seed_finance(_biz);
  else
    for r in select id, name, opening_balance from money_accounts where business_id=_biz and opening_balance > 0 loop
      perform post_journal(_biz, current_date, 'opening', r.id, 'Opening balance: ' || r.name,
        jsonb_build_array(jl((select ledger_account_id from money_accounts where id=r.id), r.opening_balance, 0), jl(acct(_biz,'3020'), 0, r.opening_balance)));
    end loop;
    for r in select id, name, opening_balance from customers where business_id=_biz and opening_balance <> 0 loop
      perform post_journal(_biz, current_date, 'customer_opening', r.id, 'Opening due: ' || r.name,
        case when r.opening_balance > 0 then jsonb_build_array(jl(acct(_biz,'1100'), r.opening_balance, 0), jl(acct(_biz,'3020'), 0, r.opening_balance))
        else jsonb_build_array(jl(acct(_biz,'3020'), -r.opening_balance, 0), jl(acct(_biz,'1100'), 0, -r.opening_balance)) end);
    end loop;
    for r in select id, name, opening_payable from suppliers where business_id=_biz and opening_payable <> 0 loop
      perform post_journal(_biz, current_date, 'supplier_opening', r.id, 'Opening payable: ' || r.name,
        case when r.opening_payable > 0 then jsonb_build_array(jl(acct(_biz,'3020'), r.opening_payable, 0), jl(acct(_biz,'2010'), 0, r.opening_payable))
        else jsonb_build_array(jl(acct(_biz,'2010'), -r.opening_payable, 0), jl(acct(_biz,'3020'), 0, -r.opening_payable)) end);
    end loop;
  end if;
  insert into audit_logs(business_id, user_id, module, action, new_value) values (_biz, auth.uid(), 'backup', 'reset', jsonb_build_object('mode', _mode));
end $$;

CREATE OR REPLACE FUNCTION public.restore_business(_biz uuid, _data jsonb, _confirm text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare t text; d jsonb := _data->'tables';
begin
  if not has_biz_role(_biz, array['owner']::member_role[]) then raise exception 'Only the owner can restore a backup.'; end if;
  if _confirm <> 'RESTORE' then raise exception 'Type RESTORE to confirm.'; end if;
  if coalesce(_data->>'app','') <> 'MOBILE D-ERP' or d is null then raise exception 'This is not a MOBILE D-ERP backup file.'; end if;
  if (_data->>'business_id')::uuid <> _biz then raise exception 'This backup belongs to a different business.'; end if;
  perform _wipe_business(_biz, true);
  delete from commission_rules where business_id=_biz;
  delete from expense_categories where business_id=_biz;
  update accounts set id=id where false;
  delete from accounts where business_id=_biz;
  delete from branches where business_id=_biz;
  foreach t in array _biz_tables() loop
    if t = 'product_imeis' then
      insert into product_imeis(id,business_id,variant_id,imei1,imei2,serial_no,status,branch_id,purchase_item_id,cost,created_at,sale_item_id)
      select id,business_id,variant_id,imei1,imei2,serial_no,status,branch_id,purchase_item_id,cost,created_at,null
      from jsonb_populate_recordset(null::product_imeis, coalesce(d->t,'[]'::jsonb)) where business_id=_biz;
    else
      execute format('insert into %I overriding system value select * from jsonb_populate_recordset(null::%I, $1) where business_id=$2', t, t)
        using coalesce(d->t,'[]'::jsonb), _biz;
    end if;
    if t = 'sale_items' then
      update product_imeis p set sale_item_id=x.sale_item_id
      from jsonb_populate_recordset(null::product_imeis, coalesce(d->'product_imeis','[]'::jsonb)) x
      where p.id=x.id and p.business_id=_biz and x.sale_item_id is not null;
    end if;
  end loop;
  perform set_config('app.bulk','off',true);
  insert into audit_logs(business_id, user_id, module, action, new_value) values (_biz, auth.uid(), 'backup', 'restore', jsonb_build_object('exported_at', _data->>'exported_at'));
end $$;

REVOKE EXECUTE ON FUNCTION public._wipe_business(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._reverse_journal(uuid, uuid, text) FROM PUBLIC, anon, authenticated;