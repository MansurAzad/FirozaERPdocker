CREATE TABLE IF NOT EXISTS public.user_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_type text NOT NULL,
  entity_type text,
  entity_id uuid,
  description text NOT NULL,
  ip_address text,
  user_agent text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_activities_business ON user_activities(business_id);
CREATE INDEX idx_user_activities_user ON user_activities(user_id);
CREATE INDEX idx_user_activities_created ON user_activities(created_at DESC);
CREATE INDEX idx_user_activities_entity ON user_activities(business_id, entity_type, entity_id);

CREATE TABLE IF NOT EXISTS public.entity_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  comment text NOT NULL,
  is_internal boolean DEFAULT true,
  parent_id uuid REFERENCES entity_comments(id) ON DELETE CASCADE,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_entity_comments_entity ON entity_comments(business_id, entity_type, entity_id);
CREATE INDEX idx_entity_comments_user ON entity_comments(user_id);
CREATE INDEX idx_entity_comments_parent ON entity_comments(parent_id);

CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  priority text DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  due_date date,
  entity_type text,
  entity_id uuid,
  completed_at timestamptz,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tasks_business ON tasks(business_id);
CREATE INDEX idx_tasks_assigned ON tasks(assigned_to, status);
CREATE INDEX idx_tasks_due ON tasks(due_date) WHERE status != 'completed' AND status != 'cancelled';
CREATE INDEX idx_tasks_entity ON tasks(business_id, entity_type, entity_id);

CREATE TABLE IF NOT EXISTS public.user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  type text DEFAULT 'info' CHECK (type IN ('info', 'success', 'warning', 'error', 'task', 'mention')),
  link text,
  read_at timestamptz,
  entity_type text,
  entity_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_notifications_user ON user_notifications(user_id, read_at);
CREATE INDEX idx_user_notifications_created ON user_notifications(created_at DESC);

CREATE TABLE IF NOT EXISTS public.customer_portal_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  is_active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_portal_tokens_token ON customer_portal_tokens(token) WHERE is_active = true;
CREATE INDEX idx_portal_tokens_customer ON customer_portal_tokens(customer_id);

CREATE TABLE IF NOT EXISTS public.customer_portal_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_id uuid NOT NULL REFERENCES customer_portal_tokens(id) ON DELETE CASCADE,
  ip_address text,
  user_agent text,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_portal_sessions_customer ON customer_portal_sessions(customer_id);
CREATE INDEX idx_portal_sessions_last_activity ON customer_portal_sessions(last_activity_at DESC);

CREATE TABLE IF NOT EXISTS public.customer_payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  due_date date,
  description text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  paid_at timestamptz,
  payment_id uuid REFERENCES customer_payments(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_payment_requests_customer ON customer_payment_requests(customer_id, status);
CREATE INDEX idx_payment_requests_due ON customer_payment_requests(due_date) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.saved_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  report_type text NOT NULL,
  filters jsonb DEFAULT '{}'::jsonb,
  columns jsonb DEFAULT '[]'::jsonb,
  sort_by jsonb DEFAULT '{}'::jsonb,
  is_public boolean DEFAULT false,
  is_scheduled boolean DEFAULT false,
  schedule_cron text,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_saved_reports_business ON saved_reports(business_id);
CREATE INDEX idx_saved_reports_user ON saved_reports(user_id);
CREATE INDEX idx_saved_reports_type ON saved_reports(report_type);

CREATE TABLE IF NOT EXISTS public.report_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  saved_report_id uuid REFERENCES saved_reports(id) ON DELETE CASCADE,
  executed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  execution_type text DEFAULT 'manual' CHECK (execution_type IN ('manual', 'scheduled', 'export')),
  file_url text,
  row_count integer,
  execution_time_ms integer,
  status text DEFAULT 'success' CHECK (status IN ('success', 'error')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_report_executions_report ON report_executions(saved_report_id);
CREATE INDEX idx_report_executions_created ON report_executions(created_at DESC);

CREATE TABLE IF NOT EXISTS public.kpi_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL,
  kpi_type text NOT NULL,
  value numeric(14,2) NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_kpi_snapshots_unique ON kpi_snapshots(business_id, snapshot_date, kpi_type);
CREATE INDEX idx_kpi_snapshots_date ON kpi_snapshots(snapshot_date DESC);

CREATE TABLE IF NOT EXISTS public.user_report_favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  saved_report_id uuid NOT NULL REFERENCES saved_reports(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, saved_report_id)
);
CREATE INDEX idx_report_favorites_user ON user_report_favorites(user_id);

ALTER TABLE public.user_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_activities_select ON user_activities
  FOR SELECT USING (is_member(business_id));
CREATE POLICY user_activities_insert ON user_activities
  FOR INSERT WITH CHECK (is_member(business_id) AND user_id = auth.uid());

ALTER TABLE public.entity_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY entity_comments_select ON entity_comments
  FOR SELECT USING (is_member(business_id));
CREATE POLICY entity_comments_insert ON entity_comments
  FOR INSERT WITH CHECK (is_member(business_id) AND user_id = auth.uid());
CREATE POLICY entity_comments_update ON entity_comments
  FOR UPDATE USING (is_member(business_id) AND user_id = auth.uid());
CREATE POLICY entity_comments_delete ON entity_comments
  FOR DELETE USING (is_member(business_id) AND user_id = auth.uid());

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tasks_select ON tasks
  FOR SELECT USING (is_member(business_id));
CREATE POLICY tasks_insert ON tasks
  FOR INSERT WITH CHECK (is_member(business_id) AND created_by = auth.uid());
CREATE POLICY tasks_update ON tasks
  FOR UPDATE USING (is_member(business_id) AND (created_by = auth.uid() OR assigned_to = auth.uid()));
CREATE POLICY tasks_delete ON tasks
  FOR DELETE USING (is_member(business_id) AND created_by = auth.uid());

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_notifications_select ON user_notifications
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY user_notifications_insert ON user_notifications
  FOR INSERT WITH CHECK (is_member(business_id));
CREATE POLICY user_notifications_update ON user_notifications
  FOR UPDATE USING (user_id = auth.uid());

ALTER TABLE public.customer_portal_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY portal_tokens_owner ON customer_portal_tokens
  FOR ALL USING (has_biz_role(business_id, array['owner']::public.member_role[]));

ALTER TABLE public.customer_portal_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY portal_sessions_owner ON customer_portal_sessions
  FOR ALL USING (has_biz_role(business_id, array['owner']::public.member_role[]));

ALTER TABLE public.customer_payment_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_requests_select ON customer_payment_requests
  FOR SELECT USING (is_member(business_id));
CREATE POLICY payment_requests_insert ON customer_payment_requests
  FOR INSERT WITH CHECK (is_member(business_id) AND created_by = auth.uid());
CREATE POLICY payment_requests_update ON customer_payment_requests
  FOR UPDATE USING (is_member(business_id));

ALTER TABLE public.saved_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY saved_reports_select ON saved_reports
  FOR SELECT USING (is_member(business_id) AND (user_id = auth.uid() OR is_public = true));
CREATE POLICY saved_reports_insert ON saved_reports
  FOR INSERT WITH CHECK (is_member(business_id) AND user_id = auth.uid());
CREATE POLICY saved_reports_update ON saved_reports
  FOR UPDATE USING (is_member(business_id) AND user_id = auth.uid());
CREATE POLICY saved_reports_delete ON saved_reports
  FOR DELETE USING (is_member(business_id) AND user_id = auth.uid());

ALTER TABLE public.report_executions ENABLE ROW LEVEL SECURITY;
CREATE POLICY report_executions_select ON report_executions
  FOR SELECT USING (is_member(business_id));
CREATE POLICY report_executions_insert ON report_executions
  FOR INSERT WITH CHECK (is_member(business_id));

ALTER TABLE public.kpi_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY kpi_snapshots_select ON kpi_snapshots
  FOR SELECT USING (is_member(business_id));
CREATE POLICY kpi_snapshots_insert ON kpi_snapshots
  FOR INSERT WITH CHECK (is_member(business_id));

ALTER TABLE public.user_report_favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY report_favorites_select ON user_report_favorites
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY report_favorites_insert ON user_report_favorites
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY report_favorites_delete ON user_report_favorites
  FOR DELETE USING (user_id = auth.uid());

CREATE TRIGGER audit_entity_comments AFTER INSERT OR UPDATE OR DELETE ON entity_comments
  FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE TRIGGER audit_tasks AFTER INSERT OR UPDATE OR DELETE ON tasks
  FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE TRIGGER audit_saved_reports AFTER INSERT OR UPDATE OR DELETE ON saved_reports
  FOR EACH ROW EXECUTE FUNCTION audit_row();

CREATE OR REPLACE VIEW public.team_activity_feed AS
SELECT 
  ua.id,
  ua.business_id,
  ua.user_id,
  u.raw_user_meta_data->>'full_name' as user_name,
  ua.activity_type,
  ua.entity_type,
  ua.entity_id,
  ua.description,
  ua.created_at
FROM user_activities ua
LEFT JOIN auth.users u ON u.id = ua.user_id
ORDER BY ua.created_at DESC;

CREATE OR REPLACE VIEW public.user_task_summary AS
SELECT 
  t.business_id,
  t.assigned_to as user_id,
  u.raw_user_meta_data->>'full_name' as user_name,
  COUNT(*) FILTER (WHERE t.status = 'pending') as pending_tasks,
  COUNT(*) FILTER (WHERE t.status = 'in_progress') as in_progress_tasks,
  COUNT(*) FILTER (WHERE t.status = 'completed') as completed_tasks,
  COUNT(*) FILTER (WHERE t.due_date < CURRENT_DATE AND t.status NOT IN ('completed', 'cancelled')) as overdue_tasks
FROM tasks t
LEFT JOIN auth.users u ON u.id = t.assigned_to
GROUP BY t.business_id, t.assigned_to, u.raw_user_meta_data;

CREATE OR REPLACE VIEW public.unread_notifications_count AS
SELECT 
  user_id,
  business_id,
  COUNT(*) as unread_count
FROM user_notifications
WHERE read_at IS NULL
GROUP BY user_id, business_id;

COMMENT ON TABLE user_activities IS 'Track all user activities for audit and collaboration';
COMMENT ON TABLE entity_comments IS 'Comments and notes on any entity';
COMMENT ON TABLE tasks IS 'Task management for collaborative work';
COMMENT ON TABLE user_notifications IS 'In-app notifications for users';
COMMENT ON TABLE customer_portal_tokens IS 'Passwordless access tokens for customer portal';
COMMENT ON TABLE customer_portal_sessions IS 'Active customer portal sessions';
COMMENT ON TABLE customer_payment_requests IS 'Payment requests sent to customers';
COMMENT ON TABLE saved_reports IS 'User-saved custom report configurations';
COMMENT ON TABLE report_executions IS 'History of report executions';
COMMENT ON TABLE kpi_snapshots IS 'Daily KPI tracking for analytics';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_activities TO authenticated;
GRANT ALL ON public.user_activities TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.entity_comments TO authenticated;
GRANT ALL ON public.entity_comments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_notifications TO authenticated;
GRANT ALL ON public.user_notifications TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_portal_tokens TO authenticated;
GRANT ALL ON public.customer_portal_tokens TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_portal_sessions TO authenticated;
GRANT ALL ON public.customer_portal_sessions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_payment_requests TO authenticated;
GRANT ALL ON public.customer_payment_requests TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_reports TO authenticated;
GRANT ALL ON public.saved_reports TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_executions TO authenticated;
GRANT ALL ON public.report_executions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kpi_snapshots TO authenticated;
GRANT ALL ON public.kpi_snapshots TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_report_favorites TO authenticated;
GRANT ALL ON public.user_report_favorites TO service_role;