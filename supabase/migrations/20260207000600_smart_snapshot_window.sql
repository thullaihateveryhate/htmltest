-- ============================================================
-- Migration: Smart inventory snapshot window
--
-- Updates get_inventory_snapshot() to auto-detect the latest
-- data window instead of hardcoding current_date.
-- This ensures correct avg_daily_usage even with historical data.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_inventory_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result   jsonb;
  v_end_date date;
BEGIN
  -- Auto-detect: use the most recent consume txn date, fallback to today
  SELECT COALESCE(MAX(business_date), current_date)
    INTO v_end_date
    FROM public.inventory_txns
   WHERE txn_type = 'CONSUME';

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
             AND t2.business_date >= v_end_date - 42),
          1
        ) AS avg_daily_usage
      FROM public.inventory_txns t
      WHERE t.ingredient_id = i.id
        AND t.txn_type = 'CONSUME'
        AND t.business_date >= v_end_date - 42
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
