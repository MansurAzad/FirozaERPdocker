CREATE OR REPLACE FUNCTION public.request_transfer_approval(
  _transfer_id uuid,
  _notes text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  transfer_rec stock_transfers%ROWTYPE;
BEGIN
  SELECT * INTO transfer_rec
  FROM stock_transfers
  WHERE id = _transfer_id;

  IF transfer_rec IS NULL THEN
    RAISE EXCEPTION 'Transfer not found';
  END IF;

  IF transfer_rec.status != 'draft' THEN
    RAISE EXCEPTION 'Transfer must be in draft status';
  END IF;

  UPDATE stock_transfers
  SET 
    status = 'pending_approval',
    notes = COALESCE(_notes, notes),
    updated_at = now()
  WHERE id = _transfer_id;

  INSERT INTO stock_transfer_approvals (
    business_id, transfer_id, action, approved_by, comments
  ) VALUES (
    transfer_rec.business_id, _transfer_id, 'request_change', 
    auth.uid(), 'Approval requested'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_stock_transfer(
  _transfer_id uuid,
  _comments text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  transfer_rec stock_transfers%ROWTYPE;
BEGIN
  SELECT * INTO transfer_rec
  FROM stock_transfers
  WHERE id = _transfer_id;

  IF transfer_rec IS NULL THEN
    RAISE EXCEPTION 'Transfer not found';
  END IF;

  IF transfer_rec.status != 'pending_approval' THEN
    RAISE EXCEPTION 'Transfer must be pending approval';
  END IF;

  UPDATE stock_transfers
  SET 
    status = 'approved',
    approved_by = auth.uid(),
    approved_at = now(),
    updated_at = now()
  WHERE id = _transfer_id;

  INSERT INTO stock_transfer_approvals (
    business_id, transfer_id, action, approved_by, comments
  ) VALUES (
    transfer_rec.business_id, _transfer_id, 'approve', 
    auth.uid(), _comments
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_stock_transfer(
  _transfer_id uuid,
  _reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  transfer_rec stock_transfers%ROWTYPE;
BEGIN
  SELECT * INTO transfer_rec
  FROM stock_transfers
  WHERE id = _transfer_id;

  IF transfer_rec IS NULL THEN
    RAISE EXCEPTION 'Transfer not found';
  END IF;

  IF transfer_rec.status != 'pending_approval' THEN
    RAISE EXCEPTION 'Transfer must be pending approval';
  END IF;

  IF _reason IS NULL OR trim(_reason) = '' THEN
    RAISE EXCEPTION 'Rejection reason is required';
  END IF;

  UPDATE stock_transfers
  SET 
    status = 'draft',
    rejected_by = auth.uid(),
    rejected_at = now(),
    rejection_reason = _reason,
    updated_at = now()
  WHERE id = _transfer_id;

  INSERT INTO stock_transfer_approvals (
    business_id, transfer_id, action, approved_by, comments
  ) VALUES (
    transfer_rec.business_id, _transfer_id, 'reject', 
    auth.uid(), _reason
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pending_transfer_approvals(
  _biz uuid
)
RETURNS TABLE (
  transfer_id uuid,
  from_branch_name text,
  to_branch_name text,
  item_count integer,
  total_value numeric,
  requested_by text,
  requested_at timestamptz,
  notes text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    st.id as transfer_id,
    fb.name as from_branch_name,
    tb.name as to_branch_name,
    COUNT(sti.id)::integer as item_count,
    COALESCE(SUM(sti.qty * pv.purchase_price), 0) as total_value,
    u.raw_user_meta_data->>'full_name' as requested_by,
    st.created_at as requested_at,
    st.notes
  FROM stock_transfers st
  JOIN branches fb ON fb.id = st.from_branch_id
  JOIN branches tb ON tb.id = st.to_branch_id
  JOIN stock_transfer_items sti ON sti.transfer_id = st.id
  JOIN product_variants pv ON pv.id = sti.variant_id
  LEFT JOIN auth.users u ON u.id = st.created_by
  WHERE st.business_id = _biz
    AND st.status = 'pending_approval'
  GROUP BY st.id, fb.name, tb.name, u.raw_user_meta_data, st.created_at, st.notes
  ORDER BY st.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_export_job(
  _biz uuid,
  _export_type text,
  _format text,
  _filters jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  job_id uuid;
  file_name text;
BEGIN
  file_name := _export_type || '_' || 
               to_char(now(), 'YYYY-MM-DD_HH24-MI-SS') || 
               '.' || _format;

  INSERT INTO export_jobs (
    business_id, export_type, format, filters, file_name, status
  ) VALUES (
    _biz, _export_type, _format, _filters, file_name, 'pending'
  )
  RETURNING id INTO job_id;

  RETURN job_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_export_job_status(
  _job_id uuid,
  _status text,
  _file_url text DEFAULT NULL,
  _record_count integer DEFAULT NULL,
  _file_size bigint DEFAULT NULL,
  _error_message text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE export_jobs
  SET 
    status = _status,
    file_url = COALESCE(_file_url, file_url),
    record_count = COALESCE(_record_count, record_count),
    file_size = COALESCE(_file_size, file_size),
    error_message = _error_message,
    completed_at = CASE WHEN _status IN ('completed', 'failed') THEN now() ELSE completed_at END
  WHERE id = _job_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_export_job_status(
  _biz uuid,
  _job_id uuid
)
RETURNS TABLE (
  id uuid,
  export_type text,
  format text,
  status text,
  file_name text,
  file_url text,
  record_count integer,
  file_size bigint,
  error_message text,
  created_at timestamptz,
  completed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ej.id,
    ej.export_type,
    ej.format,
    ej.status,
    ej.file_name,
    ej.file_url,
    ej.record_count,
    ej.file_size,
    ej.error_message,
    ej.created_at,
    ej.completed_at
  FROM export_jobs ej
  WHERE ej.business_id = _biz AND ej.id = _job_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_backup_schedule(
  _biz uuid,
  _schedule_type text,
  _schedule_time time DEFAULT NULL,
  _schedule_day integer DEFAULT NULL,
  _retention_days integer DEFAULT 30
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  schedule_id uuid;
  next_backup timestamptz;
BEGIN
  next_backup := CASE _schedule_type
    WHEN 'hourly' THEN now() + interval '1 hour'
    WHEN 'daily' THEN (now()::date + _schedule_time)::timestamptz
    WHEN 'weekly' THEN (now()::date + (_schedule_day - extract(dow from now())::integer) + _schedule_time)::timestamptz
    WHEN 'monthly' THEN (date_trunc('month', now()) + (_schedule_day - 1) + _schedule_time)::timestamptz
  END;

  INSERT INTO backup_schedules (
    business_id, schedule_type, schedule_time, schedule_day,
    is_active, retention_days, next_backup_at
  ) VALUES (
    _biz, _schedule_type, _schedule_time, _schedule_day,
    true, _retention_days, next_backup
  )
  ON CONFLICT (business_id, schedule_type) 
  DO UPDATE SET
    schedule_time = _schedule_time,
    schedule_day = _schedule_day,
    retention_days = _retention_days,
    is_active = true,
    next_backup_at = next_backup,
    updated_at = now()
  RETURNING id INTO schedule_id;

  RETURN schedule_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_backup(
  _biz uuid,
  _backup_type text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  backup_id uuid;
  file_name text;
BEGIN
  file_name := 'backup_' || 
               to_char(now(), 'YYYY-MM-DD_HH24-MI-SS') || 
               '.sql';

  INSERT INTO backup_history (
    business_id, backup_type, file_name, file_url, status, created_by
  ) VALUES (
    _biz, _backup_type, file_name, '', 'in_progress', auth.uid()
  )
  RETURNING id INTO backup_id;

  RETURN backup_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_backup(
  _backup_id uuid,
  _file_url text,
  _file_size bigint,
  _table_count integer,
  _record_count integer,
  _duration_seconds numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  retention_days integer;
BEGIN
  SELECT bs.retention_days INTO retention_days
  FROM backup_history bh
  JOIN backup_schedules bs ON bs.business_id = bh.business_id
  WHERE bh.id = _backup_id
  LIMIT 1;

  UPDATE backup_history
  SET 
    file_url = _file_url,
    file_size = _file_size,
    table_count = _table_count,
    record_count = _record_count,
    duration_seconds = _duration_seconds,
    status = 'completed',
    completed_at = now(),
    expires_at = now() + (COALESCE(retention_days, 30) || ' days')::interval
  WHERE id = _backup_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_backup(
  _backup_id uuid,
  _error_message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE backup_history
  SET 
    status = 'failed',
    error_message = _error_message,
    completed_at = now()
  WHERE id = _backup_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.clean_expired_backups()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  WITH deleted AS (
    DELETE FROM backup_history
    WHERE expires_at IS NOT NULL 
      AND expires_at < now()
      AND status = 'completed'
    RETURNING id
  )
  SELECT COUNT(*) INTO deleted_count FROM deleted;

  RETURN deleted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.subscribe_realtime_channel(
  _biz uuid,
  _channel text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO realtime_subscriptions (
    business_id, user_id, channel, subscribed_at, last_activity_at
  ) VALUES (
    _biz, auth.uid(), _channel, now(), now()
  )
  ON CONFLICT (business_id, user_id, channel) 
  DO UPDATE SET last_activity_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.unsubscribe_realtime_channel(
  _biz uuid,
  _channel text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM realtime_subscriptions
  WHERE business_id = _biz 
    AND user_id = auth.uid() 
    AND channel = _channel;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_active_subscriptions(
  _biz uuid
)
RETURNS TABLE (
  channel text,
  subscriber_count bigint,
  last_activity timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rs.channel,
    COUNT(*)::bigint as subscriber_count,
    MAX(rs.last_activity_at) as last_activity
  FROM realtime_subscriptions rs
  WHERE rs.business_id = _biz
    AND rs.last_activity_at > now() - interval '1 hour'
  GROUP BY rs.channel
  ORDER BY subscriber_count DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.export_customers_json(
  _biz uuid,
  _filters jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN COALESCE(
    (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.name)
     FROM customers c
     WHERE c.business_id = _biz
       AND c.status = 'active'),
    '[]'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.export_products_json(
  _biz uuid,
  _filters jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN COALESCE(
    (SELECT jsonb_agg(
       jsonb_build_object(
         'sku', v.sku,
         'product', p.model,
         'brand', b.name,
         'category', c.name,
         'ram', v.ram,
         'storage', v.storage,
         'color', v.color,
         'purchase_price', v.purchase_price,
         'retail_price', v.retail_price,
         'status', v.status
       ) ORDER BY v.sku
     )
     FROM product_variants v
     JOIN products p ON p.id = v.product_id
     JOIN brands b ON b.id = p.brand_id
     JOIN categories c ON c.id = p.category_id
     WHERE v.business_id = _biz
       AND v.status = 'active'),
    '[]'::jsonb
  );
END;
$$;

COMMENT ON FUNCTION public.request_transfer_approval IS 'Request approval for stock transfer';
COMMENT ON FUNCTION public.approve_stock_transfer IS 'Approve a pending stock transfer';
COMMENT ON FUNCTION public.reject_stock_transfer IS 'Reject a pending stock transfer';
COMMENT ON FUNCTION public.get_pending_transfer_approvals IS 'Get all pending transfer approvals';
COMMENT ON FUNCTION public.create_export_job IS 'Create an export job';
COMMENT ON FUNCTION public.update_export_job_status IS 'Update export job status';
COMMENT ON FUNCTION public.get_export_job_status IS 'Get export job status';
COMMENT ON FUNCTION public.create_backup_schedule IS 'Create or update backup schedule';
COMMENT ON FUNCTION public.start_backup IS 'Start backup process';
COMMENT ON FUNCTION public.complete_backup IS 'Mark backup as completed';
COMMENT ON FUNCTION public.fail_backup IS 'Mark backup as failed';
COMMENT ON FUNCTION public.clean_expired_backups IS 'Delete expired backups';
COMMENT ON FUNCTION public.subscribe_realtime_channel IS 'Subscribe to real-time notifications';
COMMENT ON FUNCTION public.unsubscribe_realtime_channel IS 'Unsubscribe from real-time notifications';
COMMENT ON FUNCTION public.get_active_subscriptions IS 'Get active real-time subscriptions';
COMMENT ON FUNCTION public.export_customers_json IS 'Export customers to JSON';
COMMENT ON FUNCTION public.export_products_json IS 'Export products to JSON';