CREATE OR REPLACE FUNCTION public.log_user_activity(
  _biz uuid,
  _activity_type text,
  _entity_type text,
  _entity_id uuid,
  _description text,
  _metadata jsonb DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  activity_id uuid;
BEGIN
  INSERT INTO user_activities (
    business_id, user_id, activity_type, entity_type, entity_id, description, metadata
  ) VALUES (
    _biz, auth.uid(), _activity_type, _entity_type, _entity_id, _description, _metadata
  )
  RETURNING id INTO activity_id;
  RETURN activity_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_team_activity(
  _biz uuid,
  _limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  user_name text,
  activity_type text,
  entity_type text,
  entity_id uuid,
  description text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ua.id,
    ua.user_id,
    u.raw_user_meta_data->>'full_name' as user_name,
    ua.activity_type,
    ua.entity_type,
    ua.entity_id,
    ua.description,
    ua.created_at
  FROM user_activities ua
  LEFT JOIN auth.users u ON u.id = ua.user_id
  WHERE ua.business_id = _biz
  ORDER BY ua.created_at DESC
  LIMIT _limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_entity_comment(
  _biz uuid,
  _entity_type text,
  _entity_id uuid,
  _comment text,
  _is_internal boolean DEFAULT true,
  _parent_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  comment_id uuid;
BEGIN
  INSERT INTO entity_comments (
    business_id, entity_type, entity_id, user_id, comment, is_internal, parent_id
  ) VALUES (
    _biz, _entity_type, _entity_id, auth.uid(), _comment, _is_internal, _parent_id
  )
  RETURNING id INTO comment_id;
  RETURN comment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_entity_comments(
  _biz uuid,
  _entity_type text,
  _entity_id uuid
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  user_name text,
  comment text,
  is_internal boolean,
  parent_id uuid,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ec.id,
    ec.user_id,
    u.raw_user_meta_data->>'full_name' as user_name,
    ec.comment,
    ec.is_internal,
    ec.parent_id,
    ec.created_at,
    ec.updated_at
  FROM entity_comments ec
  LEFT JOIN auth.users u ON u.id = ec.user_id
  WHERE ec.business_id = _biz
    AND ec.entity_type = _entity_type
    AND ec.entity_id = _entity_id
  ORDER BY ec.created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_task(
  _biz uuid,
  _title text,
  _description text,
  _assigned_to uuid,
  _priority text DEFAULT 'medium',
  _due_date date DEFAULT NULL,
  _entity_type text DEFAULT NULL,
  _entity_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task_id uuid;
BEGIN
  INSERT INTO tasks (
    business_id, title, description, assigned_to, created_by, priority, due_date, entity_type, entity_id
  ) VALUES (
    _biz, _title, _description, _assigned_to, auth.uid(), _priority, _due_date, _entity_type, _entity_id
  )
  RETURNING id INTO task_id;
  IF _assigned_to IS NOT NULL THEN
    PERFORM create_notification(
      _biz,
      _assigned_to,
      'New Task Assigned',
      _title,
      'task',
      '/app/tasks/' || task_id
    );
  END IF;
  RETURN task_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_task_status(
  _task_id uuid,
  _status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE tasks
  SET 
    status = _status,
    completed_at = CASE WHEN _status = 'completed' THEN now() ELSE NULL END,
    completed_by = CASE WHEN _status = 'completed' THEN auth.uid() ELSE NULL END,
    updated_at = now()
  WHERE id = _task_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_tasks(
  _biz uuid,
  _user_id uuid DEFAULT NULL,
  _status text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  title text,
  description text,
  assigned_to uuid,
  assigned_to_name text,
  created_by uuid,
  created_by_name text,
  priority text,
  status text,
  due_date date,
  entity_type text,
  entity_id uuid,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.id,
    t.title,
    t.description,
    t.assigned_to,
    u1.raw_user_meta_data->>'full_name' as assigned_to_name,
    t.created_by,
    u2.raw_user_meta_data->>'full_name' as created_by_name,
    t.priority,
    t.status,
    t.due_date,
    t.entity_type,
    t.entity_id,
    t.created_at
  FROM tasks t
  LEFT JOIN auth.users u1 ON u1.id = t.assigned_to
  LEFT JOIN auth.users u2 ON u2.id = t.created_by
  WHERE t.business_id = _biz
    AND (_user_id IS NULL OR t.assigned_to = _user_id)
    AND (_status IS NULL OR t.status = _status)
  ORDER BY 
    CASE t.priority
      WHEN 'urgent' THEN 1
      WHEN 'high' THEN 2
      WHEN 'medium' THEN 3
      WHEN 'low' THEN 4
    END,
    t.due_date NULLS LAST,
    t.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_notification(
  _biz uuid,
  _user_id uuid,
  _title text,
  _message text,
  _type text DEFAULT 'info',
  _link text DEFAULT NULL,
  _entity_type text DEFAULT NULL,
  _entity_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  notification_id uuid;
BEGIN
  INSERT INTO user_notifications (
    business_id, user_id, title, message, type, link, entity_type, entity_id
  ) VALUES (
    _biz, _user_id, _title, _message, _type, _link, _entity_type, _entity_id
  )
  RETURNING id INTO notification_id;
  RETURN notification_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_notification_read(
  _notification_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE user_notifications
  SET read_at = now()
  WHERE id = _notification_id AND user_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(
  _biz uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE user_notifications
  SET read_at = now()
  WHERE business_id = _biz AND user_id = auth.uid() AND read_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_notifications(
  _biz uuid,
  _limit integer DEFAULT 50,
  _unread_only boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  title text,
  message text,
  type text,
  link text,
  read_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    n.id,
    n.title,
    n.message,
    n.type,
    n.link,
    n.read_at,
    n.created_at
  FROM user_notifications n
  WHERE n.business_id = _biz
    AND n.user_id = auth.uid()
    AND (_unread_only = false OR n.read_at IS NULL)
  ORDER BY n.created_at DESC
  LIMIT _limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_customer_portal_token(
  _biz uuid,
  _customer_id uuid,
  _expires_in_days integer DEFAULT 30
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  token_value text;
BEGIN
  token_value := encode(gen_random_bytes(32), 'base64');
  INSERT INTO customer_portal_tokens (
    business_id, customer_id, token, expires_at
  ) VALUES (
    _biz, _customer_id, token_value, now() + (_expires_in_days || ' days')::interval
  );
  RETURN token_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_customer_portal_token(
  _token text
)
RETURNS TABLE (
  customer_id uuid,
  business_id uuid,
  customer_name text,
  customer_mobile text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE customer_portal_tokens
  SET last_used_at = now()
  WHERE token = _token AND is_active = true AND expires_at > now();
  RETURN QUERY
  SELECT 
    c.id as customer_id,
    c.business_id,
    c.name as customer_name,
    c.mobile as customer_mobile
  FROM customer_portal_tokens cpt
  JOIN customers c ON c.id = cpt.customer_id
  WHERE cpt.token = _token 
    AND cpt.is_active = true 
    AND cpt.expires_at > now();
END;
$$;

CREATE OR REPLACE FUNCTION public.get_customer_portal_data(
  _biz uuid,
  _customer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  customer_info jsonb;
  recent_sales jsonb;
  total_due numeric;
BEGIN
  SELECT to_jsonb(c.*) INTO customer_info
  FROM customers c
  WHERE c.id = _customer_id AND c.business_id = _biz;
  SELECT jsonb_agg(s.*) INTO recent_sales
  FROM (
    SELECT id, invoice_no, sale_date, total, paid, due
    FROM sales
    WHERE customer_id = _customer_id AND business_id = _biz
    ORDER BY sale_date DESC
    LIMIT 10
  ) s;
  SELECT COALESCE(SUM(due), 0) INTO total_due
  FROM sales
  WHERE customer_id = _customer_id AND business_id = _biz;
  result := jsonb_build_object(
    'customer', customer_info,
    'recent_sales', COALESCE(recent_sales, '[]'::jsonb),
    'total_due', total_due
  );
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_payment_request(
  _biz uuid,
  _customer_id uuid,
  _amount numeric,
  _due_date date,
  _description text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_id uuid;
BEGIN
  INSERT INTO customer_payment_requests (
    business_id, customer_id, amount, due_date, description, created_by
  ) VALUES (
    _biz, _customer_id, _amount, _due_date, _description, auth.uid()
  )
  RETURNING id INTO request_id;
  RETURN request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_report_config(
  _biz uuid,
  _name text,
  _description text,
  _report_type text,
  _filters jsonb,
  _columns jsonb,
  _sort_by jsonb,
  _is_public boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  report_id uuid;
BEGIN
  INSERT INTO saved_reports (
    business_id, user_id, name, description, report_type, filters, columns, sort_by, is_public
  ) VALUES (
    _biz, auth.uid(), _name, _description, _report_type, _filters, _columns, _sort_by, _is_public
  )
  RETURNING id INTO report_id;
  RETURN report_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_saved_reports(
  _biz uuid,
  _report_type text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  report_type text,
  filters jsonb,
  columns jsonb,
  is_public boolean,
  user_id uuid,
  user_name text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    sr.id,
    sr.name,
    sr.description,
    sr.report_type,
    sr.filters,
    sr.columns,
    sr.is_public,
    sr.user_id,
    u.raw_user_meta_data->>'full_name' as user_name,
    sr.created_at
  FROM saved_reports sr
  LEFT JOIN auth.users u ON u.id = sr.user_id
  WHERE sr.business_id = _biz
    AND (_report_type IS NULL OR sr.report_type = _report_type)
    AND (sr.user_id = auth.uid() OR sr.is_public = true)
  ORDER BY sr.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_kpi_snapshot(
  _biz uuid,
  _snapshot_date date,
  _kpi_type text,
  _value numeric,
  _metadata jsonb DEFAULT '{}'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO kpi_snapshots (
    business_id, snapshot_date, kpi_type, value, metadata
  ) VALUES (
    _biz, _snapshot_date, _kpi_type, _value, _metadata
  )
  ON CONFLICT (business_id, snapshot_date, kpi_type) 
  DO UPDATE SET value = _value, metadata = _metadata;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_kpi_trend(
  _biz uuid,
  _kpi_type text,
  _from_date date,
  _to_date date
)
RETURNS TABLE (
  snapshot_date date,
  value numeric,
  metadata jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ks.snapshot_date,
    ks.value,
    ks.metadata
  FROM kpi_snapshots ks
  WHERE ks.business_id = _biz
    AND ks.kpi_type = _kpi_type
    AND ks.snapshot_date BETWEEN _from_date AND _to_date
  ORDER BY ks.snapshot_date ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_daily_kpi_snapshots(
  _biz uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  today_date date := CURRENT_DATE;
  daily_sales numeric;
  daily_purchases numeric;
  inventory_value numeric;
  total_due numeric;
BEGIN
  SELECT COALESCE(SUM(total), 0) INTO daily_sales
  FROM sales
  WHERE business_id = _biz AND sale_date = today_date;
  PERFORM record_kpi_snapshot(_biz, today_date, 'daily_sales', daily_sales);
  SELECT COALESCE(SUM(total), 0) INTO daily_purchases
  FROM purchases
  WHERE business_id = _biz AND purchase_date = today_date;
  PERFORM record_kpi_snapshot(_biz, today_date, 'daily_purchases', daily_purchases);
  SELECT COALESCE(SUM(pv.purchase_price * COALESCE(sb.stock, 0)), 0) INTO inventory_value
  FROM product_variants pv
  LEFT JOIN stock_balances sb ON sb.variant_id = pv.id
  WHERE pv.business_id = _biz;
  PERFORM record_kpi_snapshot(_biz, today_date, 'inventory_value', inventory_value);
  SELECT COALESCE(SUM(due), 0) INTO total_due
  FROM sales
  WHERE business_id = _biz;
  PERFORM record_kpi_snapshot(_biz, today_date, 'customer_dues', total_due);
END;
$$;

COMMENT ON FUNCTION log_user_activity IS 'Log user activity for audit trail';
COMMENT ON FUNCTION get_team_activity IS 'Get recent team activity feed';
COMMENT ON FUNCTION add_entity_comment IS 'Add comment to any entity';
COMMENT ON FUNCTION get_entity_comments IS 'Get comments for entity';
COMMENT ON FUNCTION create_task IS 'Create collaborative task';
COMMENT ON FUNCTION update_task_status IS 'Update task status';
COMMENT ON FUNCTION get_user_tasks IS 'Get tasks for user';
COMMENT ON FUNCTION create_notification IS 'Create user notification';
COMMENT ON FUNCTION mark_notification_read IS 'Mark notification as read';
COMMENT ON FUNCTION mark_all_notifications_read IS 'Mark all notifications as read';
COMMENT ON FUNCTION get_user_notifications IS 'Get user notifications';
COMMENT ON FUNCTION generate_customer_portal_token IS 'Generate passwordless token for customer portal';
COMMENT ON FUNCTION verify_customer_portal_token IS 'Verify customer portal token';
COMMENT ON FUNCTION get_customer_portal_data IS 'Get customer portal data';
COMMENT ON FUNCTION create_payment_request IS 'Create payment request for customer';
COMMENT ON FUNCTION save_report_config IS 'Save custom report configuration';
COMMENT ON FUNCTION get_saved_reports IS 'Get saved reports';
COMMENT ON FUNCTION record_kpi_snapshot IS 'Record daily KPI snapshot';
COMMENT ON FUNCTION get_kpi_trend IS 'Get KPI trend over time';
COMMENT ON FUNCTION generate_daily_kpi_snapshots IS 'Generate all daily KPI snapshots';