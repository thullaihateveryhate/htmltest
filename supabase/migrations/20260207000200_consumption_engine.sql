-- ============================================================
-- Module 2+3: Ingestion helpers + Consumption Engine
-- ============================================================

-- 1. Add business_date to inventory_txns so CONSUME txns
--    are linked to the sales date (enables idempotent daily close)
ALTER TABLE public.inventory_txns
  ADD COLUMN IF NOT EXISTS business_date date;

CREATE INDEX IF NOT EXISTS inventory_txns_business_date_idx
  ON public.inventory_txns (business_date);

-- ============================================================
-- 2. ingest_daily_sales  (Module 2 backend support)
--
--    Accepts a JSONB array of sales rows, auto-creates any
--    missing menu_items, and upserts into sales_line_items
--    aggregated by (business_date, menu_item_id).
--
--    Frontend sends pre-aggregated rows after parsing the CSV.
--    Re-uploading the same date+item REPLACES qty/net_sales.
--
--    Example call from JS:
--      supabase.rpc('ingest_daily_sales', { p_rows: [
--        { business_date:'2015-01-01', menu_item_name:'The Hawaiian Pizza (M)',
--          category:'Classic', qty:10, net_sales:132.50, source:'toast' }
--      ]})
-- ============================================================
CREATE OR REPLACE FUNCTION public.ingest_daily_sales(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_data       jsonb;
  v_menu_item_id uuid;
  v_rows_processed  integer := 0;
  v_items_created   integer := 0;
BEGIN
  FOR row_data IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    -- Find existing menu item by name
    SELECT id INTO v_menu_item_id
    FROM public.menu_items
    WHERE name = row_data->>'menu_item_name';

    -- Auto-create if missing
    IF v_menu_item_id IS NULL THEN
      INSERT INTO public.menu_items (name, category)
      VALUES (
        row_data->>'menu_item_name',
        row_data->>'category'
      )
      RETURNING id INTO v_menu_item_id;
      v_items_created := v_items_created + 1;
    END IF;

    -- Upsert daily sales (REPLACE on re-upload)
    INSERT INTO public.sales_line_items
      (business_date, menu_item_id, qty, net_sales, source)
    VALUES (
      (row_data->>'business_date')::date,
      v_menu_item_id,
      (row_data->>'qty')::numeric,
      (row_data->>'net_sales')::numeric,
      row_data->>'source'
    )
    ON CONFLICT (business_date, menu_item_id)
    DO UPDATE SET
      qty       = EXCLUDED.qty,
      net_sales = EXCLUDED.net_sales,
      source    = EXCLUDED.source;

    v_rows_processed := v_rows_processed + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'status',             'success',
    'rows_processed',     v_rows_processed,
    'menu_items_created', v_items_created
  );
END;
$$;

-- ============================================================
-- 3. run_daily_close  (Module 3 — Consumption Engine)
--
--    For a given business_date:
--      a) joins sales_line_items with bom
--      b) computes ingredient usage = SUM(qty_sold * qty_per_item)
--      c) writes CONSUME txns into inventory_txns
--      d) decrements inventory_on_hand
--
--    Idempotent: skips if CONSUME txns already exist for that date.
--
--    Example:  supabase.rpc('run_daily_close', { p_business_date: '2015-01-01' })
-- ============================================================
CREATE OR REPLACE FUNCTION public.run_daily_close(p_business_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_txn_count        integer;
  v_ingredient_count integer;
BEGIN
  -- Idempotency: if we already consumed for this date, skip
  IF EXISTS (
    SELECT 1 FROM public.inventory_txns
    WHERE txn_type = 'CONSUME' AND business_date = p_business_date
  ) THEN
    RETURN jsonb_build_object(
      'status',  'skipped',
      'message', 'Daily close already run for ' || p_business_date::text
    );
  END IF;

  -- Verify there are sales for this date
  IF NOT EXISTS (
    SELECT 1 FROM public.sales_line_items
    WHERE business_date = p_business_date
  ) THEN
    RETURN jsonb_build_object(
      'status',  'no_data',
      'message', 'No sales found for ' || p_business_date::text
    );
  END IF;

  -- Insert CONSUME txns (qty_delta is negative)
  INSERT INTO public.inventory_txns
    (ingredient_id, txn_type, qty_delta, business_date, note)
  SELECT
    b.ingredient_id,
    'CONSUME',
    -SUM(s.qty * b.qty_per_item),
    p_business_date,
    'Daily close for ' || p_business_date::text
  FROM public.sales_line_items s
  JOIN public.bom b ON b.menu_item_id = s.menu_item_id
  WHERE s.business_date = p_business_date
  GROUP BY b.ingredient_id;

  GET DIAGNOSTICS v_txn_count = ROW_COUNT;

  -- Upsert inventory_on_hand (handles missing rows too)
  INSERT INTO public.inventory_on_hand (ingredient_id, qty_on_hand, updated_at)
  SELECT
    t.ingredient_id,
    t.qty_delta,
    now()
  FROM public.inventory_txns t
  WHERE t.txn_type = 'CONSUME'
    AND t.business_date = p_business_date
  ON CONFLICT (ingredient_id)
  DO UPDATE SET
    qty_on_hand = inventory_on_hand.qty_on_hand + EXCLUDED.qty_on_hand,
    updated_at  = now();

  GET DIAGNOSTICS v_ingredient_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'status',                'success',
    'business_date',         p_business_date,
    'consume_txns_created',  v_txn_count,
    'ingredients_updated',   v_ingredient_count
  );
END;
$$;

-- ============================================================
-- 4. reverse_daily_close  (undo helper)
--
--    Reverses a daily close: deletes CONSUME txns and restores
--    inventory_on_hand. Useful for corrections.
-- ============================================================
CREATE OR REPLACE FUNCTION public.reverse_daily_close(p_business_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reversed integer;
BEGIN
  -- Restore inventory
  UPDATE public.inventory_on_hand oh
  SET
    qty_on_hand = oh.qty_on_hand - t.qty_delta,  -- subtract negative = add back
    updated_at  = now()
  FROM public.inventory_txns t
  WHERE t.ingredient_id = oh.ingredient_id
    AND t.txn_type = 'CONSUME'
    AND t.business_date = p_business_date;

  -- Delete the CONSUME txns
  DELETE FROM public.inventory_txns
  WHERE txn_type = 'CONSUME'
    AND business_date = p_business_date;

  GET DIAGNOSTICS v_reversed = ROW_COUNT;

  RETURN jsonb_build_object(
    'status',        'success',
    'business_date', p_business_date,
    'txns_reversed', v_reversed
  );
END;
$$;

-- ============================================================
-- 5. get_inventory_snapshot  (Module 5 dashboard support)
--
--    Returns current inventory with avg daily usage (last 14 days
--    of CONSUME txns), days of supply, and reorder status.
--
--    Example:  supabase.rpc('get_inventory_snapshot')
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_inventory_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_agg(row_to_json(snap))
  INTO v_result
  FROM (
    SELECT
      i.id               AS ingredient_id,
      i.name,
      i.unit::text,
      i.reorder_point,
      i.lead_time_days,
      i.unit_cost,
      COALESCE(oh.qty_on_hand, 0)  AS qty_on_hand,
      COALESCE(avg_use.avg_daily_usage, 0) AS avg_daily_usage,
      CASE
        WHEN COALESCE(avg_use.avg_daily_usage, 0) = 0 THEN NULL
        ELSE ROUND(COALESCE(oh.qty_on_hand, 0) / avg_use.avg_daily_usage, 1)
      END AS days_of_supply,
      CASE
        WHEN COALESCE(avg_use.avg_daily_usage, 0) = 0 THEN NULL
        ELSE ROUND(
          (COALESCE(oh.qty_on_hand, 0) - i.reorder_point)
            / avg_use.avg_daily_usage, 1
        )
      END AS days_to_reorder,
      CASE
        WHEN COALESCE(avg_use.avg_daily_usage, 0) = 0 THEN 'unknown'
        WHEN COALESCE(oh.qty_on_hand, 0) / avg_use.avg_daily_usage
             <= i.lead_time_days THEN 'critical'
        WHEN (COALESCE(oh.qty_on_hand, 0) - i.reorder_point)
             / avg_use.avg_daily_usage <= 3 THEN 'reorder_soon'
        ELSE 'ok'
      END AS status
    FROM public.ingredients i
    LEFT JOIN public.inventory_on_hand oh
      ON oh.ingredient_id = i.id
    LEFT JOIN LATERAL (
      SELECT
        -SUM(t.qty_delta) / GREATEST(
          (SELECT COUNT(DISTINCT t2.business_date)
           FROM public.inventory_txns t2
           WHERE t2.ingredient_id = i.id
             AND t2.txn_type = 'CONSUME'
             AND t2.business_date >= current_date - 14),
          1
        ) AS avg_daily_usage
      FROM public.inventory_txns t
      WHERE t.ingredient_id = i.id
        AND t.txn_type = 'CONSUME'
        AND t.business_date >= current_date - 14
    ) avg_use ON true
    ORDER BY
      CASE
        WHEN COALESCE(avg_use.avg_daily_usage, 0) = 0 THEN 3
        WHEN COALESCE(oh.qty_on_hand, 0) / avg_use.avg_daily_usage
             <= i.lead_time_days THEN 1
        WHEN (COALESCE(oh.qty_on_hand, 0) - i.reorder_point)
             / avg_use.avg_daily_usage <= 3 THEN 2
        ELSE 4
      END,
      i.name
  ) snap;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;
