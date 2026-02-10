-- ============================================================
-- Onboarding + Bulk Close
--
-- Adds app_config to track setup state and a bulk close
-- function to process all historical dates after the
-- initial history upload.
-- ============================================================

-- 1. App config table (single-row, key-value style)
CREATE TABLE IF NOT EXISTS public.app_config (
  key   text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_config_select_authenticated
  ON public.app_config FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY app_config_insert_authenticated
  ON public.app_config FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY app_config_update_authenticated
  ON public.app_config FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Seed the onboarding state
INSERT INTO public.app_config (key, value)
VALUES ('onboarding', jsonb_build_object(
  'setup_complete', false,
  'history_uploaded', false,
  'history_start_date', null,
  'history_end_date', null,
  'history_rows_ingested', 0,
  'bulk_close_complete', false,
  'completed_at', null
))
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 2. complete_onboarding_ingest
--
--    Called after the historical CSV is ingested. Records the
--    date range and marks history as uploaded.
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_onboarding_ingest()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min_date date;
  v_max_date date;
  v_row_count bigint;
BEGIN
  SELECT MIN(business_date), MAX(business_date), COUNT(*)
  INTO v_min_date, v_max_date, v_row_count
  FROM public.sales_line_items;

  UPDATE public.app_config
  SET value = value
    || jsonb_build_object(
      'history_uploaded', true,
      'history_start_date', v_min_date,
      'history_end_date', v_max_date,
      'history_rows_ingested', v_row_count
    ),
    updated_at = now()
  WHERE key = 'onboarding';

  RETURN jsonb_build_object(
    'status', 'success',
    'start_date', v_min_date,
    'end_date', v_max_date,
    'rows', v_row_count
  );
END;
$$;

-- ============================================================
-- 3. run_bulk_close
--
--    Runs daily close for every distinct business_date in
--    sales_line_items that hasn't been consumed yet.
--    Used after the initial history upload to establish
--    the full consumption history baseline.
--
--    Returns summary of all dates processed.
-- ============================================================
CREATE OR REPLACE FUNCTION public.run_bulk_close()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date         date;
  v_dates_processed integer := 0;
  v_dates_skipped   integer := 0;
  v_total_txns      integer := 0;
  v_result       jsonb;
BEGIN
  -- Loop through every sales date that hasn't been consumed yet
  FOR v_date IN
    SELECT DISTINCT s.business_date
    FROM public.sales_line_items s
    WHERE NOT EXISTS (
      SELECT 1 FROM public.inventory_txns t
      WHERE t.txn_type = 'CONSUME'
        AND t.business_date = s.business_date
    )
    ORDER BY s.business_date
  LOOP
    -- Insert CONSUME txns for this date
    INSERT INTO public.inventory_txns
      (ingredient_id, txn_type, qty_delta, business_date, note)
    SELECT
      b.ingredient_id,
      'CONSUME',
      -SUM(s.qty * b.qty_per_item),
      v_date,
      'Bulk close for ' || v_date::text
    FROM public.sales_line_items s
    JOIN public.bom b ON b.menu_item_id = s.menu_item_id
    WHERE s.business_date = v_date
    GROUP BY b.ingredient_id;

    -- Upsert inventory_on_hand from the new txns
    INSERT INTO public.inventory_on_hand (ingredient_id, qty_on_hand, updated_at)
    SELECT
      t.ingredient_id,
      t.qty_delta,
      now()
    FROM public.inventory_txns t
    WHERE t.txn_type = 'CONSUME'
      AND t.business_date = v_date
    ON CONFLICT (ingredient_id)
    DO UPDATE SET
      qty_on_hand = inventory_on_hand.qty_on_hand + EXCLUDED.qty_on_hand,
      updated_at  = now();

    v_dates_processed := v_dates_processed + 1;
  END LOOP;

  -- Count total consume txns
  SELECT COUNT(*) INTO v_total_txns
  FROM public.inventory_txns
  WHERE txn_type = 'CONSUME';

  -- Mark onboarding bulk close as complete
  UPDATE public.app_config
  SET value = value
    || jsonb_build_object(
      'bulk_close_complete', true,
      'setup_complete', true,
      'completed_at', now()
    ),
    updated_at = now()
  WHERE key = 'onboarding';

  RETURN jsonb_build_object(
    'status', 'success',
    'dates_processed', v_dates_processed,
    'total_consume_txns', v_total_txns
  );
END;
$$;

-- ============================================================
-- 4. get_onboarding_status
--
--    Returns current onboarding state so the frontend can
--    decide whether to show the landing/setup page or the
--    main dashboard.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_onboarding_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_config jsonb;
BEGIN
  SELECT value INTO v_config
  FROM public.app_config
  WHERE key = 'onboarding';

  RETURN COALESCE(v_config, jsonb_build_object('setup_complete', false));
END;
$$;
