-- ============================================================
-- Migration: daily_orders table + analytics RPCs
--
-- Stores order-level data from Toast OrderDetails CSV.
-- This is SUPPLEMENTARY to sales_line_items — provides
-- revenue analytics, service mix, guest counts, peak hours.
-- ============================================================

-- 1. daily_orders table
CREATE TABLE IF NOT EXISTS public.daily_orders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_date date NOT NULL,
  order_id      text NOT NULL,
  opened_at     timestamptz,
  closed_at     timestamptz,
  num_guests    integer DEFAULT 0,
  server_name   text,
  dining_area   text,
  service_period text,         -- Lunch, Dinner, Late Night
  dining_option text,          -- Dine In, Takeout, Delivery
  order_source  text,          -- In store, Online
  discount_amount numeric(10,2) DEFAULT 0,
  subtotal      numeric(10,2) DEFAULT 0,
  tax           numeric(10,4) DEFAULT 0,
  tip           numeric(10,2) DEFAULT 0,
  gratuity      numeric(10,2) DEFAULT 0,
  total         numeric(10,2) DEFAULT 0,
  voided        boolean DEFAULT false,
  created_at    timestamptz DEFAULT now(),

  CONSTRAINT uq_daily_orders_order_id UNIQUE (order_id)
);

-- RLS
ALTER TABLE public.daily_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read daily_orders"
  ON public.daily_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert daily_orders"
  ON public.daily_orders FOR INSERT TO authenticated WITH CHECK (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_daily_orders_date ON public.daily_orders (business_date);
CREATE INDEX IF NOT EXISTS idx_daily_orders_service ON public.daily_orders (service_period);

-- ============================================================
-- 2. ingest_daily_orders(p_rows jsonb)
--
-- Batch upserts order-level data. Safe to re-upload.
-- ============================================================
CREATE OR REPLACE FUNCTION public.ingest_daily_orders(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row         jsonb;
  v_processed   integer := 0;
BEGIN
  IF jsonb_array_length(p_rows) = 0 THEN
    RETURN jsonb_build_object('status', 'success', 'rows_processed', 0);
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    INSERT INTO public.daily_orders (
      business_date, order_id, opened_at, closed_at,
      num_guests, server_name, dining_area, service_period,
      dining_option, order_source, discount_amount,
      subtotal, tax, tip, gratuity, total, voided
    ) VALUES (
      (v_row->>'business_date')::date,
      v_row->>'order_id',
      CASE WHEN v_row->>'opened_at' IS NOT NULL
           THEN (v_row->>'opened_at')::timestamptz ELSE NULL END,
      CASE WHEN v_row->>'closed_at' IS NOT NULL
           THEN (v_row->>'closed_at')::timestamptz ELSE NULL END,
      COALESCE((v_row->>'num_guests')::integer, 0),
      v_row->>'server_name',
      v_row->>'dining_area',
      v_row->>'service_period',
      v_row->>'dining_option',
      v_row->>'order_source',
      COALESCE((v_row->>'discount_amount')::numeric, 0),
      COALESCE((v_row->>'subtotal')::numeric, 0),
      COALESCE((v_row->>'tax')::numeric, 0),
      COALESCE((v_row->>'tip')::numeric, 0),
      COALESCE((v_row->>'gratuity')::numeric, 0),
      COALESCE((v_row->>'total')::numeric, 0),
      COALESCE((v_row->>'voided')::boolean, false)
    )
    ON CONFLICT (order_id) DO UPDATE SET
      business_date    = EXCLUDED.business_date,
      opened_at        = EXCLUDED.opened_at,
      closed_at        = EXCLUDED.closed_at,
      num_guests       = EXCLUDED.num_guests,
      server_name      = EXCLUDED.server_name,
      dining_area      = EXCLUDED.dining_area,
      service_period   = EXCLUDED.service_period,
      dining_option    = EXCLUDED.dining_option,
      order_source     = EXCLUDED.order_source,
      discount_amount  = EXCLUDED.discount_amount,
      subtotal         = EXCLUDED.subtotal,
      tax              = EXCLUDED.tax,
      tip              = EXCLUDED.tip,
      gratuity         = EXCLUDED.gratuity,
      total            = EXCLUDED.total,
      voided           = EXCLUDED.voided;

    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'status',         'success',
    'rows_processed', v_processed
  );
END;
$$;

-- ============================================================
-- 3. get_daily_analytics(p_business_date date)
--
-- Returns revenue, order count, avg order value, service mix,
-- dining option mix, peak hours, top servers for a given date.
-- If no date provided, uses the most recent date with data.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_daily_analytics(
  p_business_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date   date;
  v_result jsonb;
BEGIN
  -- Auto-detect date if not provided
  IF p_business_date IS NULL THEN
    SELECT MAX(business_date) INTO v_date FROM public.daily_orders WHERE NOT voided;
  ELSE
    v_date := p_business_date;
  END IF;

  IF v_date IS NULL THEN
    RETURN jsonb_build_object('status', 'no_data');
  END IF;

  SELECT jsonb_build_object(
    'status', 'success',
    'business_date', v_date,

    -- Revenue summary
    'total_orders', COUNT(*),
    'total_revenue', COALESCE(SUM(subtotal), 0),
    'total_tax', COALESCE(SUM(tax), 0),
    'total_tips', COALESCE(SUM(tip), 0),
    'total_discounts', COALESCE(SUM(discount_amount), 0),
    'grand_total', COALESCE(SUM(total), 0),
    'avg_order_value', ROUND(COALESCE(AVG(subtotal), 0), 2),
    'total_guests', COALESCE(SUM(num_guests), 0),
    'avg_guests_per_order', ROUND(COALESCE(AVG(num_guests), 0), 1),

    -- Service period breakdown
    'by_service_period', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'period', service_period,
        'orders', cnt,
        'revenue', rev
      )), '[]'::jsonb)
      FROM (
        SELECT service_period, COUNT(*) AS cnt, SUM(subtotal) AS rev
        FROM public.daily_orders
        WHERE business_date = v_date AND NOT voided
        GROUP BY service_period ORDER BY cnt DESC
      ) sp
    ),

    -- Dining option breakdown
    'by_dining_option', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'option', dining_option,
        'orders', cnt,
        'revenue', rev
      )), '[]'::jsonb)
      FROM (
        SELECT dining_option, COUNT(*) AS cnt, SUM(subtotal) AS rev
        FROM public.daily_orders
        WHERE business_date = v_date AND NOT voided
        GROUP BY dining_option ORDER BY cnt DESC
      ) do_
    ),

    -- Order source breakdown
    'by_order_source', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'source', order_source,
        'orders', cnt,
        'revenue', rev
      )), '[]'::jsonb)
      FROM (
        SELECT order_source, COUNT(*) AS cnt, SUM(subtotal) AS rev
        FROM public.daily_orders
        WHERE business_date = v_date AND NOT voided
        GROUP BY order_source ORDER BY cnt DESC
      ) os
    ),

    -- Hourly breakdown
    'by_hour', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'hour', hr,
        'orders', cnt,
        'revenue', rev
      )), '[]'::jsonb)
      FROM (
        SELECT EXTRACT(HOUR FROM opened_at) AS hr,
               COUNT(*) AS cnt, SUM(subtotal) AS rev
        FROM public.daily_orders
        WHERE business_date = v_date AND NOT voided AND opened_at IS NOT NULL
        GROUP BY hr ORDER BY hr
      ) h
    ),

    -- Top servers
    'by_server', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'server', server_name,
        'orders', cnt,
        'revenue', rev,
        'tips', tp
      )), '[]'::jsonb)
      FROM (
        SELECT server_name, COUNT(*) AS cnt, SUM(subtotal) AS rev, SUM(tip) AS tp
        FROM public.daily_orders
        WHERE business_date = v_date AND NOT voided AND server_name IS NOT NULL
          AND server_name != ''
        GROUP BY server_name ORDER BY rev DESC
      ) sv
    )

  ) INTO v_result
  FROM public.daily_orders
  WHERE business_date = v_date AND NOT voided;

  RETURN v_result;
END;
$$;

-- ============================================================
-- 4. get_revenue_trend(p_days integer DEFAULT 30)
--
-- Returns daily revenue, order count, avg order value
-- for the last N days of data. Auto-detects window.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_revenue_trend(
  p_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_end_date date;
  v_result   jsonb;
BEGIN
  SELECT MAX(business_date) INTO v_end_date FROM public.daily_orders WHERE NOT voided;

  IF v_end_date IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      business_date,
      COUNT(*) AS orders,
      SUM(subtotal) AS revenue,
      ROUND(AVG(subtotal), 2) AS avg_order_value,
      SUM(num_guests) AS guests,
      SUM(tip) AS tips,
      SUM(discount_amount) AS discounts
    FROM public.daily_orders
    WHERE NOT voided
      AND business_date > v_end_date - p_days
      AND business_date <= v_end_date
    GROUP BY business_date
    ORDER BY business_date
  ) t;

  RETURN v_result;
END;
$$;
