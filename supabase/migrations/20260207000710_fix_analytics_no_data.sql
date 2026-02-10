-- Fix: get_daily_analytics should return no_data when no orders exist for the date

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
  v_count  integer;
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

  -- Check if any orders exist for this date
  SELECT COUNT(*) INTO v_count FROM public.daily_orders
  WHERE business_date = v_date AND NOT voided;

  IF v_count = 0 THEN
    RETURN jsonb_build_object('status', 'no_data', 'business_date', v_date);
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
