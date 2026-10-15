CREATE OR REPLACE FUNCTION public.auto_generate_product_variant_sku()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_number bigint;
BEGIN
  IF NEW.sku IS NULL OR btrim(NEW.sku) = '' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.business_id::text || ':product-sku', 0));

    SELECT COALESCE(
      MAX((regexp_match(sku, '^SKU-([0-9]+)$'))[1]::bigint),
      0
    ) + 1
    INTO next_number
    FROM public.product_variants
    WHERE business_id = NEW.business_id
      AND sku ~ '^SKU-[0-9]+$';

    NEW.sku := 'SKU-' || lpad(next_number::text, 6, '0');
  ELSE
    NEW.sku := upper(btrim(NEW.sku));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS product_variants_auto_sku ON public.product_variants;
CREATE TRIGGER product_variants_auto_sku
BEFORE INSERT ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION public.auto_generate_product_variant_sku();

COMMENT ON FUNCTION public.auto_generate_product_variant_sku() IS 'Generates a sequential SKU scoped to each business when no manual SKU is supplied.';