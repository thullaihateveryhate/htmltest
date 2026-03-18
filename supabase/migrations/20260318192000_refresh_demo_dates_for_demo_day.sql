-- Shift demo-facing historical data so the newest business date lands on today.
-- This keeps dashboards, analytics, transaction history, and forecasts looking current for demo day.

DO $$
DECLARE
  v_target_date          date := current_date;
  v_sales_max            date;
  v_sales_min            date;
  v_txn_max              date;
  v_orders_max           date;
  v_latest_business_date date;
  v_shift_days           integer := 0;
  v_shift_interval       interval := interval '0 days';
BEGIN
  -- Normalize any leftover legacy 2015 demo dates into the current 2025/2026 data era
  -- before we calculate the final "move everything up to today" gap.
  IF to_regclass('public.sales_line_items') IS NOT NULL THEN
    UPDATE public.sales_line_items
    SET business_date = (business_date + interval '10 years')::date
    WHERE business_date >= date '2015-01-01'
      AND business_date < date '2016-01-01';
  END IF;

  IF to_regclass('public.inventory_txns') IS NOT NULL THEN
    UPDATE public.inventory_txns
    SET business_date = (business_date + interval '10 years')::date
    WHERE business_date >= date '2015-01-01'
      AND business_date < date '2016-01-01';
  END IF;

  IF to_regclass('public.daily_orders') IS NOT NULL THEN
    UPDATE public.daily_orders
    SET business_date = (business_date + interval '10 years')::date,
        opened_at = CASE
          WHEN opened_at IS NOT NULL
            THEN opened_at + interval '10 years'
          ELSE NULL
        END,
        closed_at = CASE
          WHEN closed_at IS NOT NULL
            THEN closed_at + interval '10 years'
          ELSE NULL
        END
    WHERE business_date >= date '2015-01-01'
      AND business_date < date '2016-01-01';
  END IF;

  IF to_regclass('public.app_config') IS NOT NULL THEN
    UPDATE public.app_config
    SET value = jsonb_strip_nulls(
          value
          || CASE
               WHEN jsonb_typeof(value->'history_start_date') = 'string'
                 AND value->>'history_start_date' >= '2015-01-01'
                 AND value->>'history_start_date' < '2016-01-01'
               THEN jsonb_build_object(
                 'history_start_date',
                 to_jsonb(((value->>'history_start_date')::date + interval '10 years')::date)
               )
               ELSE '{}'::jsonb
             END
          || CASE
               WHEN jsonb_typeof(value->'history_end_date') = 'string'
                 AND value->>'history_end_date' >= '2015-01-01'
                 AND value->>'history_end_date' < '2016-01-01'
               THEN jsonb_build_object(
                 'history_end_date',
                 to_jsonb(((value->>'history_end_date')::date + interval '10 years')::date)
               )
               ELSE '{}'::jsonb
             END
        )
    WHERE key = 'onboarding';
  END IF;

  IF to_regclass('public.sales_line_items') IS NOT NULL THEN
    SELECT MIN(business_date), MAX(business_date)
    INTO v_sales_min, v_sales_max
    FROM public.sales_line_items;
  END IF;

  IF to_regclass('public.inventory_txns') IS NOT NULL THEN
    SELECT MAX(business_date) INTO v_txn_max
    FROM public.inventory_txns
    WHERE business_date IS NOT NULL;
  END IF;

  IF to_regclass('public.daily_orders') IS NOT NULL THEN
    SELECT MAX(business_date) INTO v_orders_max
    FROM public.daily_orders;
  END IF;

  SELECT MAX(d)
  INTO v_latest_business_date
  FROM (VALUES (v_sales_max), (v_txn_max), (v_orders_max)) AS dated_rows(d);

  IF v_latest_business_date IS NULL THEN
    RAISE NOTICE 'No business-dated records found. Skipping demo date refresh.';
    RETURN;
  END IF;

  v_shift_days := GREATEST(v_target_date - v_latest_business_date, 0);
  v_shift_interval := make_interval(days => v_shift_days);

  RAISE NOTICE
    'Latest business date is %, shifting demo data by % day(s) so it lands on %.',
    v_latest_business_date,
    v_shift_days,
    v_target_date;

  IF v_shift_days > 0 THEN
    IF to_regclass('public.menu_items') IS NOT NULL THEN
      UPDATE public.menu_items
      SET created_at = created_at + v_shift_interval
      WHERE created_at IS NOT NULL
        AND created_at::date <= v_latest_business_date;
    END IF;

    IF to_regclass('public.ingredients') IS NOT NULL THEN
      UPDATE public.ingredients
      SET created_at = created_at + v_shift_interval
      WHERE created_at IS NOT NULL
        AND created_at::date <= v_latest_business_date;
    END IF;

    IF to_regclass('public.sales_line_items') IS NOT NULL THEN
      UPDATE public.sales_line_items
      SET business_date = business_date + v_shift_days,
          created_at = CASE
            WHEN created_at IS NOT NULL AND created_at::date <= v_latest_business_date
              THEN created_at + v_shift_interval
            ELSE created_at
          END;
    END IF;

    IF to_regclass('public.inventory_on_hand') IS NOT NULL THEN
      UPDATE public.inventory_on_hand
      SET updated_at = CASE
        WHEN updated_at IS NOT NULL AND updated_at::date <= v_latest_business_date
          THEN updated_at + v_shift_interval
        ELSE updated_at
      END;
    END IF;

    IF to_regclass('public.inventory_txns') IS NOT NULL THEN
      UPDATE public.inventory_txns
      SET business_date = CASE
            WHEN business_date IS NOT NULL THEN business_date + v_shift_days
            ELSE NULL
          END,
          created_at = CASE
            WHEN created_at IS NOT NULL AND created_at::date <= v_latest_business_date
              THEN created_at + v_shift_interval
            ELSE created_at
          END;
    END IF;

    IF to_regclass('public.daily_orders') IS NOT NULL THEN
      UPDATE public.daily_orders
      SET business_date = business_date + v_shift_days,
          opened_at = CASE
            WHEN opened_at IS NOT NULL THEN opened_at + v_shift_interval
            ELSE NULL
          END,
          closed_at = CASE
            WHEN closed_at IS NOT NULL THEN closed_at + v_shift_interval
            ELSE NULL
          END,
          created_at = CASE
            WHEN created_at IS NOT NULL AND created_at::date <= v_latest_business_date
              THEN created_at + v_shift_interval
            ELSE created_at
          END;
    END IF;

    IF to_regclass('public.app_config') IS NOT NULL THEN
      IF to_regclass('public.sales_line_items') IS NOT NULL THEN
        SELECT MIN(business_date), MAX(business_date)
        INTO v_sales_min, v_sales_max
        FROM public.sales_line_items;
      END IF;

      UPDATE public.app_config
      SET value = jsonb_strip_nulls(
            value
            || CASE
                 WHEN v_sales_min IS NOT NULL
                 THEN jsonb_build_object(
                   'history_start_date',
                   to_jsonb(v_sales_min)
                 )
                 ELSE '{}'::jsonb
               END
            || CASE
                 WHEN v_sales_max IS NOT NULL
                 THEN jsonb_build_object(
                   'history_end_date',
                   to_jsonb(v_sales_max)
                 )
                 ELSE '{}'::jsonb
               END
            || CASE
                 WHEN jsonb_typeof(value->'completed_at') = 'string'
                   AND value->>'completed_at' ~ '^\d{4}-\d{2}-\d{2}T'
                 THEN jsonb_build_object(
                   'completed_at',
                   to_jsonb((value->>'completed_at')::timestamptz + v_shift_interval)
                 )
                 ELSE '{}'::jsonb
               END
          ),
          updated_at = CASE
            WHEN updated_at IS NOT NULL AND updated_at::date <= v_latest_business_date
              THEN updated_at + v_shift_interval
            ELSE updated_at
          END
      WHERE key = 'onboarding';
    END IF;
  END IF;

  IF to_regclass('public.forecast_ingredients') IS NOT NULL THEN
    DELETE FROM public.forecast_ingredients;
  END IF;

  IF to_regclass('public.forecast_items') IS NOT NULL THEN
    DELETE FROM public.forecast_items;
  END IF;

  IF to_regprocedure('public.generate_forecast(integer, date)') IS NOT NULL THEN
    PERFORM public.generate_forecast(7, current_date);
    RAISE NOTICE 'Forecasts regenerated starting from %.', current_date;
  ELSE
    RAISE NOTICE 'generate_forecast(integer, date) is missing. Skipped forecast regeneration.';
  END IF;
END;
$$;
