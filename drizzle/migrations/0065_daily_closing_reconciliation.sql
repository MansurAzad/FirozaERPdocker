ALTER TABLE public.daily_closings
  ADD COLUMN card_collection numeric(14,2) NOT NULL DEFAULT 0;

UPDATE public.daily_closings dc
   SET card_collection = COALESCE((
         SELECT sum(mt.amount)
           FROM public.money_transactions mt
           JOIN public.money_accounts ma
             ON ma.business_id=mt.business_id AND ma.id=mt.account_id
          WHERE mt.business_id=dc.business_id
            AND mt.txn_date=dc.closing_date
            AND mt.direction='in'
            AND mt.method='card'
            AND mt.reversed_at IS NULL
            AND (
              mt.branch_id=dc.branch_id
              OR (ma.branch_id=dc.branch_id AND mt.branch_id IS NULL)
            )
       ),0),
       refund_total = COALESCE((
         SELECT sum(mt.amount)
           FROM public.money_transactions mt
           JOIN public.money_accounts ma
             ON ma.business_id=mt.business_id AND ma.id=mt.account_id
          WHERE mt.business_id=dc.business_id
            AND mt.txn_date=dc.closing_date
            AND mt.direction='out'
            AND mt.kind IN (
              'sales_refund','partner_finance_refund','partner_finance_settlement_reversal'
            )
            AND mt.reversed_at IS NULL
            AND (
              mt.branch_id=dc.branch_id
              OR (ma.branch_id=dc.branch_id AND mt.branch_id IS NULL)
            )
       ),0);

CREATE OR REPLACE FUNCTION public.close_day(
  _biz uuid, _branch uuid, _account uuid, _date date, _actual numeric,
  _note text, _difference_reason text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_branch uuid;
  v_previous_date date;
  v_previous_actual numeric(14,2);
  v_open numeric(14,2);
  v_in numeric(14,2);
  v_out numeric(14,2);
  v_cash_collection numeric(14,2);
  v_card_collection numeric(14,2);
  v_bank_collection numeric(14,2);
  v_mfs_collection numeric(14,2);
  v_refunds numeric(14,2);
  v_adjustments numeric(14,2);
  v_expected numeric(14,2);
  v_variance numeric(14,2);
  v_id uuid;
BEGIN
  IF NOT public.has_module_access(_biz,'closing','view')
    OR NOT public.has_module_access(_biz,'closing','create')
    OR NOT public.can_access_daily_closing_branch(_biz,_branch) THEN
    RAISE EXCEPTION 'You do not have permission to close this shop.';
  END IF;
  IF _date IS NULL OR _date > (now() AT TIME ZONE 'Asia/Dhaka')::date THEN
    RAISE EXCEPTION 'Cannot close a future date.';
  END IF;
  IF _actual IS NULL OR _actual < 0 THEN
    RAISE EXCEPTION 'Enter the counted cash.';
  END IF;

  SELECT branch_id INTO v_account_branch
    FROM public.money_accounts
   WHERE business_id=_biz AND id=_account AND kind='cash' AND status='active';
  IF NOT FOUND OR (v_account_branch IS NOT NULL AND v_account_branch <> _branch) THEN
    RAISE EXCEPTION 'Select an active cash account assigned to this shop or shared centrally.';
  END IF;

  SELECT closing_date,actual INTO v_previous_date,v_previous_actual
    FROM public.daily_closings
   WHERE business_id=_biz AND account_id=_account AND branch_id=_branch
     AND closing_date < _date
   ORDER BY closing_date DESC LIMIT 1;
  IF v_previous_date IS NULL THEN
    SELECT CASE WHEN v_account_branch=_branch THEN ma.opening_balance ELSE 0 END
        + COALESCE(sum(CASE WHEN mt.direction='in' THEN mt.amount ELSE -mt.amount END),0)
      INTO v_open
      FROM public.money_accounts ma
      LEFT JOIN public.money_transactions mt
        ON mt.business_id=ma.business_id AND mt.account_id=ma.id AND mt.txn_date<_date
       AND (mt.branch_id=_branch OR (ma.branch_id=_branch AND mt.branch_id IS NULL))
     WHERE ma.business_id=_biz AND ma.id=_account
     GROUP BY ma.opening_balance;
  ELSE
    SELECT v_previous_actual
        + COALESCE(sum(CASE WHEN mt.direction='in' THEN mt.amount ELSE -mt.amount END),0)
      INTO v_open
      FROM public.money_transactions mt
     WHERE mt.business_id=_biz AND mt.account_id=_account
       AND mt.txn_date>v_previous_date AND mt.txn_date<_date
       AND (mt.branch_id=_branch OR (v_account_branch=_branch AND mt.branch_id IS NULL));
  END IF;

  SELECT
    COALESCE(sum(mt.amount) FILTER (WHERE mt.direction='in'),0),
    COALESCE(sum(mt.amount) FILTER (WHERE mt.direction='out'),0)
    INTO v_in,v_out
    FROM public.money_transactions mt
   WHERE mt.business_id=_biz AND mt.account_id=_account AND mt.txn_date=_date
     AND (mt.branch_id=_branch OR (v_account_branch=_branch AND mt.branch_id IS NULL));

  SELECT
    COALESCE(sum(mt.amount) FILTER (
      WHERE mt.direction='in' AND (mt.method='cash' OR (mt.method IS NULL AND ma.kind='cash'))
    ),0),
    COALESCE(sum(mt.amount) FILTER (WHERE mt.direction='in' AND mt.method='card'),0),
    COALESCE(sum(mt.amount) FILTER (
      WHERE mt.direction='in'
        AND (mt.method IN ('bank','cheque') OR (mt.method IS NULL AND ma.kind='bank'))
    ),0),
    COALESCE(sum(mt.amount) FILTER (
      WHERE mt.direction='in'
        AND (mt.method IN ('bkash','nagad','rocket') OR (mt.method IS NULL AND ma.kind='mfs'))
    ),0),
    COALESCE(sum(mt.amount) FILTER (
      WHERE mt.direction='out'
        AND mt.kind IN (
          'sales_refund','partner_finance_refund','partner_finance_settlement_reversal'
        )
    ),0),
    COALESCE(sum(CASE WHEN mt.direction='in' THEN mt.amount ELSE -mt.amount END)
      FILTER (WHERE mt.kind IN ('adjustment','transfer_in','transfer_out')),0)
    INTO v_cash_collection,v_card_collection,v_bank_collection,v_mfs_collection,
      v_refunds,v_adjustments
    FROM public.money_transactions mt
    JOIN public.money_accounts ma
      ON ma.business_id=mt.business_id AND ma.id=mt.account_id
   WHERE mt.business_id=_biz AND mt.txn_date=_date
     AND mt.reversed_at IS NULL
     AND (mt.branch_id=_branch OR (ma.branch_id=_branch AND mt.branch_id IS NULL));

  v_expected := COALESCE(v_open,0)+COALESCE(v_in,0)-COALESCE(v_out,0);
  v_variance := ROUND(_actual-v_expected,2);
  IF ABS(v_variance)>=0.01 AND length(trim(COALESCE(_difference_reason,'')))<3 THEN
    RAISE EXCEPTION 'Explain the cash difference before submitting this closing.';
  END IF;

  INSERT INTO public.daily_closings(
    business_id,account_id,branch_id,closing_date,opening,cash_in,cash_out,
    expected,actual,variance,note,closed_by,prepared_by,cash_collection,
    card_collection,bank_collection,mfs_collection,refund_total,adjustment_total,
    closing_status,difference_reason
  ) VALUES (
    _biz,_account,_branch,_date,COALESCE(v_open,0),COALESCE(v_in,0),COALESCE(v_out,0),
    v_expected,ROUND(_actual,2),v_variance,NULLIF(trim(COALESCE(_note,'')),''),auth.uid(),
    auth.uid(),COALESCE(v_cash_collection,0),COALESCE(v_card_collection,0),
    COALESCE(v_bank_collection,0),COALESCE(v_mfs_collection,0),COALESCE(v_refunds,0),
    COALESCE(v_adjustments,0),
    CASE WHEN ABS(v_variance)>=0.01 THEN 'pending_review' ELSE 'closed' END,
    CASE WHEN ABS(v_variance)>=0.01 THEN trim(_difference_reason) END
  ) RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'This shop account is already closed for this date.';
END
$$;

REVOKE ALL ON FUNCTION public.close_day(uuid,uuid,uuid,date,numeric,text,text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.close_day(uuid,uuid,uuid,date,numeric,text,text)
  TO authenticated;
