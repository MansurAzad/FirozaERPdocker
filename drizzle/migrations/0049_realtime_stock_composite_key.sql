CREATE OR REPLACE FUNCTION public.notify_realtime_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  channel text;
  payload jsonb;
  row_data jsonb;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  channel := TG_TABLE_NAME || '_changes';
  payload := jsonb_build_object(
    'table', TG_TABLE_NAME,
    'operation', TG_OP,
    'business_id', row_data->>'business_id',
    'record_id', COALESCE(
      row_data->>'id',
      CASE WHEN TG_TABLE_NAME = 'stock'
        THEN concat_ws(':', row_data->>'branch_id', row_data->>'variant_id')
      END
    ),
    'timestamp', now()
  );
  PERFORM pg_notify(channel, payload::text);
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
