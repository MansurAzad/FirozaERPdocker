BEGIN;

DROP TRIGGER IF EXISTS enforce_shop_branch_write ON public.sales;
DROP TRIGGER IF EXISTS enforce_shop_branch_write ON public.customer_payments;
DROP TRIGGER IF EXISTS enforce_shop_branch_write ON public.sales_returns;

COMMIT;
