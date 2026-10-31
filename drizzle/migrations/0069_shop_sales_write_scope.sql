BEGIN;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'sales', 'customer_payments', 'sales_returns'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS enforce_shop_branch_write ON public.%I', v_table);
    EXECUTE format(
      'CREATE TRIGGER enforce_shop_branch_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_shop_branch_write()',
      v_table
    );
  END LOOP;
END
$$;

COMMIT;
