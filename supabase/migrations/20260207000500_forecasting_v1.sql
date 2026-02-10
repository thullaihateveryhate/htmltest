-- ============================================================
-- Module 6: Forecasting v1
--
-- Rolling average by day-of-week from the last 6 weeks of sales,
-- converted to ingredient needs via BOM.
-- ============================================================

-- 1. Forecast tables
CREATE TABLE IF NOT EXISTS public.forecast_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_date date NOT NULL,
  menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  qty numeric(12,3) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (forecast_date, menu_item_id)
);

CREATE TABLE IF NOT EXISTS public.forecast_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_date date NOT NULL,
  ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  qty numeric(12,3) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (forecast_date, ingredient_id)
);

CREATE INDEX IF NOT EXISTS forecast_items_date_idx
  ON public.forecast_items (forecast_date);

CREATE INDEX IF NOT EXISTS forecast_ingredients_date_idx
  ON public.forecast_ingredients (forecast_date);

-- RLS
ALTER TABLE public.forecast_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forecast_ingredients ENABLE ROW LEVEL SECURITY;

CREATE POLICY forecast_items_select_auth
  ON public.forecast_items FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY forecast_items_insert_auth
  ON public.forecast_items FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY forecast_items_update_auth
  ON public.forecast_items FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY forecast_ingredients_select_auth
  ON public.forecast_ingredients FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY forecast_ingredients_insert_auth
  ON public.forecast_ingredients FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY forecast_ingredients_update_auth
  ON public.forecast_ingredients FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- 2. generate_forecast
--
--    For each of the next p_days_ahead days (starting from
--    p_reference_date):
--      a) determine the day-of-week
--      b) compute avg qty per menu_item for that DOW from
--         the last 6 weeks of sales before the reference date
--      c) upsert into forecast_items
--      d) convert to ingredient forecast via BOM
--      e) upsert into forecast_ingredients
--
--    Idempotent: upserts replace previous forecasts.
--
--    Example:
--      supabase.rpc('generate_forecast', {
--        p_days_ahead: 7,
--        p_reference_date: '2026-02-07'
--      })
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_forecast(
  p_days_ahead integer DEFAULT 7,
  p_reference_date date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lookback_start date;
  v_day integer;
  v_target_date date;
  v_target_dow integer;
  v_item_count integer := 0;
  v_ing_count integer := 0;
BEGIN
  -- Lookback window: 6 weeks (42 days) before reference date
  v_lookback_start := p_reference_date - 42;

  -- Clear existing forecasts for the target range
  DELETE FROM public.forecast_ingredients
  WHERE forecast_date >= p_reference_date
    AND forecast_date < p_reference_date + p_days_ahead;

  DELETE FROM public.forecast_items
  WHERE forecast_date >= p_reference_date
    AND forecast_date < p_reference_date + p_days_ahead;

  -- For each forecast day
  FOR v_day IN 0 .. (p_days_ahead - 1)
  LOOP
    v_target_date := p_reference_date + v_day;
    v_target_dow := EXTRACT(DOW FROM v_target_date)::integer;

    -- Upsert item forecasts: avg qty by DOW from last 6 weeks
    INSERT INTO public.forecast_items (forecast_date, menu_item_id, qty)
    SELECT
      v_target_date,
      s.menu_item_id,
      ROUND(AVG(s.qty), 3)
    FROM public.sales_line_items s
    WHERE s.business_date >= v_lookback_start
      AND s.business_date < p_reference_date
      AND EXTRACT(DOW FROM s.business_date)::integer = v_target_dow
    GROUP BY s.menu_item_id
    ON CONFLICT (forecast_date, menu_item_id)
    DO UPDATE SET
      qty = EXCLUDED.qty,
      created_at = now();

    -- Upsert ingredient forecasts: sum of (item_forecast * bom qty)
    INSERT INTO public.forecast_ingredients (forecast_date, ingredient_id, qty)
    SELECT
      v_target_date,
      b.ingredient_id,
      ROUND(SUM(fi.qty * b.qty_per_item), 3)
    FROM public.forecast_items fi
    JOIN public.bom b ON b.menu_item_id = fi.menu_item_id
    WHERE fi.forecast_date = v_target_date
    GROUP BY b.ingredient_id
    ON CONFLICT (forecast_date, ingredient_id)
    DO UPDATE SET
      qty = EXCLUDED.qty,
      created_at = now();

  END LOOP;

  -- Count results
  SELECT COUNT(*) INTO v_item_count
  FROM public.forecast_items
  WHERE forecast_date >= p_reference_date
    AND forecast_date < p_reference_date + p_days_ahead;

  SELECT COUNT(*) INTO v_ing_count
  FROM public.forecast_ingredients
  WHERE forecast_date >= p_reference_date
    AND forecast_date < p_reference_date + p_days_ahead;

  RETURN jsonb_build_object(
    'status', 'success',
    'reference_date', p_reference_date,
    'days_forecasted', p_days_ahead,
    'item_forecasts', v_item_count,
    'ingredient_forecasts', v_ing_count
  );
END;
$$;

-- ============================================================
-- 3. get_forecast
--
--    Returns the ingredient forecast for the next 7 days,
--    joined with current inventory to show shortfall.
--
--    Example:
--      supabase.rpc('get_forecast', { p_reference_date: '2026-02-07' })
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_forecast(
  p_reference_date date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_agg(row_to_json(f))
  INTO v_result
  FROM (
    SELECT
      fi.forecast_date,
      fi.ingredient_id,
      i.name,
      i.unit::text,
      fi.qty AS qty_needed,
      COALESCE(oh.qty_on_hand, 0) AS qty_on_hand,
      CASE
        WHEN COALESCE(oh.qty_on_hand, 0) - fi.qty < 0
        THEN ROUND(fi.qty - COALESCE(oh.qty_on_hand, 0), 3)
        ELSE 0
      END AS shortfall
    FROM public.forecast_ingredients fi
    JOIN public.ingredients i ON i.id = fi.ingredient_id
    LEFT JOIN public.inventory_on_hand oh ON oh.ingredient_id = fi.ingredient_id
    WHERE fi.forecast_date >= p_reference_date
      AND fi.forecast_date < p_reference_date + 7
    ORDER BY fi.forecast_date, i.name
  ) f;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;
