-- ============================================================
-- Requirement 1: SQLi + XSS Hardening
--
-- Focus:
-- 1. Normalize and sanitize untrusted text before persistence.
-- 2. Validate JSON payload shape/types for write RPCs.
-- 3. Keep RPCs on static SQL paths (no dynamic SQL).
-- ============================================================

CREATE OR REPLACE FUNCTION public.stockd_sanitize_text(
  p_value text,
  p_max_length integer DEFAULT NULL,
  p_strip_markup boolean DEFAULT true
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_text text;
BEGIN
  IF p_value IS NULL THEN
    RETURN NULL;
  END IF;

  v_text := regexp_replace(p_value, '[[:cntrl:]]', ' ', 'g');

  IF p_strip_markup THEN
    v_text := regexp_replace(v_text, '<script[^>]*>.*?</script>', ' ', 'gi');
    v_text := regexp_replace(v_text, '<style[^>]*>.*?</style>', ' ', 'gi');
    v_text := regexp_replace(v_text, '<[^>]+>', ' ', 'g');
    v_text := translate(v_text, '<>', '  ');
  END IF;

  v_text := regexp_replace(v_text, '[[:space:]]+', ' ', 'g');
  v_text := btrim(v_text);

  IF p_max_length IS NOT NULL AND p_max_length > 0 AND char_length(v_text) > p_max_length THEN
    v_text := btrim(left(v_text, p_max_length));
  END IF;

  IF v_text = '' THEN
    RETURN NULL;
  END IF;

  RETURN v_text;
END;
$$;

CREATE OR REPLACE FUNCTION public.stockd_safe_enum(
  p_value text,
  p_allowed text[],
  p_default text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_clean text;
  v_match text;
BEGIN
  v_clean := lower(COALESCE(public.stockd_sanitize_text(p_value, 80, true), ''));

  IF v_clean = '' THEN
    RETURN p_default;
  END IF;

  SELECT candidate
  INTO v_match
  FROM unnest(p_allowed) AS candidate
  WHERE lower(candidate) = v_clean
  LIMIT 1;

  RETURN COALESCE(v_match, p_default);
END;
$$;

CREATE OR REPLACE FUNCTION public.receive_inventory(
  p_ingredient_id uuid,
  p_qty numeric,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_qty numeric;
  v_note text;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 OR p_qty > 1000000 THEN
    RETURN jsonb_build_object(
      'status', 'error',
      'message', 'qty must be greater than 0 and at most 1000000'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.ingredients WHERE id = p_ingredient_id) THEN
    RETURN jsonb_build_object(
      'status', 'error',
      'message', 'ingredient not found'
    );
  END IF;

  v_note := public.stockd_sanitize_text(p_note, 240, true);

  INSERT INTO public.inventory_txns (ingredient_id, txn_type, qty_delta, note)
  VALUES (p_ingredient_id, 'RECEIVE', p_qty, v_note);

  INSERT INTO public.inventory_on_hand (ingredient_id, qty_on_hand, updated_at)
  VALUES (p_ingredient_id, p_qty, now())
  ON CONFLICT (ingredient_id)
  DO UPDATE SET
    qty_on_hand = inventory_on_hand.qty_on_hand + EXCLUDED.qty_on_hand,
    updated_at = now();

  SELECT qty_on_hand INTO v_new_qty
  FROM public.inventory_on_hand
  WHERE ingredient_id = p_ingredient_id;

  RETURN jsonb_build_object(
    'status', 'success',
    'ingredient_id', p_ingredient_id,
    'qty_received', p_qty,
    'new_qty_on_hand', v_new_qty
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ingest_daily_sales(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_data jsonb;
  v_menu_item_id uuid;
  v_rows_processed integer := 0;
  v_items_created integer := 0;
  v_row_index integer := 0;
  v_business_date date;
  v_menu_item_name text;
  v_category text;
  v_source text;
  v_qty numeric;
  v_net_sales numeric;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'p_rows must be a JSON array');
  END IF;

  IF jsonb_array_length(p_rows) = 0 THEN
    RETURN jsonb_build_object('status', 'success', 'rows_processed', 0, 'menu_items_created', 0);
  END IF;

  FOR row_data IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_row_index := v_row_index + 1;

    IF jsonb_typeof(row_data) <> 'object' THEN
      RETURN jsonb_build_object('status', 'error', 'message', format('row %s must be a JSON object', v_row_index));
    END IF;

    v_menu_item_name := public.stockd_sanitize_text(row_data->>'menu_item_name', 160, true);
    v_category := COALESCE(public.stockd_sanitize_text(row_data->>'category', 80, true), 'Uncategorized');
    v_source := COALESCE(public.stockd_sanitize_text(row_data->>'source', 40, true), 'toast');

    IF v_menu_item_name IS NULL THEN
      RETURN jsonb_build_object('status', 'error', 'message', format('row %s menu_item_name is required', v_row_index));
    END IF;

    BEGIN
      v_business_date := (row_data->>'business_date')::date;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('status', 'error', 'message', format('row %s business_date must be a valid date', v_row_index));
    END;

    BEGIN
      v_qty := (row_data->>'qty')::numeric;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('status', 'error', 'message', format('row %s qty must be numeric', v_row_index));
    END;

    BEGIN
      v_net_sales := (row_data->>'net_sales')::numeric;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('status', 'error', 'message', format('row %s net_sales must be numeric', v_row_index));
    END;

    IF v_qty < 0 OR v_qty > 1000000 THEN
      RETURN jsonb_build_object('status', 'error', 'message', format('row %s qty is out of range', v_row_index));
    END IF;

    IF v_net_sales < -1000000 OR v_net_sales > 1000000 THEN
      RETURN jsonb_build_object('status', 'error', 'message', format('row %s net_sales is out of range', v_row_index));
    END IF;

    SELECT id INTO v_menu_item_id
    FROM public.menu_items
    WHERE name = v_menu_item_name;

    IF v_menu_item_id IS NULL THEN
      INSERT INTO public.menu_items (name, category)
      VALUES (v_menu_item_name, v_category)
      RETURNING id INTO v_menu_item_id;
      v_items_created := v_items_created + 1;
    END IF;

    INSERT INTO public.sales_line_items
      (business_date, menu_item_id, qty, net_sales, source)
    VALUES (
      v_business_date,
      v_menu_item_id,
      v_qty,
      v_net_sales,
      v_source
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

CREATE OR REPLACE FUNCTION public.ingest_daily_orders(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
  v_processed integer := 0;
  v_row_index integer := 0;
  v_business_date date;
  v_opened_at timestamptz;
  v_closed_at timestamptz;
  v_num_guests integer;
  v_server_name text;
  v_dining_area text;
  v_service_period text;
  v_dining_option text;
  v_order_source text;
  v_order_id text;
  v_discount_amount numeric;
  v_subtotal numeric;
  v_tax numeric;
  v_tip numeric;
  v_gratuity numeric;
  v_total numeric;
  v_voided boolean;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'p_rows must be a JSON array');
  END IF;

  IF jsonb_array_length(p_rows) = 0 THEN
    RETURN jsonb_build_object('status', 'success', 'rows_processed', 0);
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_row_index := v_row_index + 1;

    IF jsonb_typeof(v_row) <> 'object' THEN
      RETURN jsonb_build_object('status', 'error', 'message', format('row %s must be a JSON object', v_row_index));
    END IF;

    v_order_id := public.stockd_sanitize_text(v_row->>'order_id', 120, true);
    IF v_order_id IS NULL THEN
      RETURN jsonb_build_object('status', 'error', 'message', format('row %s order_id is required', v_row_index));
    END IF;

    BEGIN
      v_business_date := (v_row->>'business_date')::date;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('status', 'error', 'message', format('row %s business_date must be a valid date', v_row_index));
    END;

    BEGIN
      v_opened_at := CASE
        WHEN v_row->>'opened_at' IS NOT NULL AND btrim(v_row->>'opened_at') <> ''
        THEN (v_row->>'opened_at')::timestamptz
        ELSE NULL
      END;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('status', 'error', 'message', format('row %s opened_at must be a valid timestamp', v_row_index));
    END;

    BEGIN
      v_closed_at := CASE
        WHEN v_row->>'closed_at' IS NOT NULL AND btrim(v_row->>'closed_at') <> ''
        THEN (v_row->>'closed_at')::timestamptz
        ELSE NULL
      END;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('status', 'error', 'message', format('row %s closed_at must be a valid timestamp', v_row_index));
    END;

    BEGIN
      v_num_guests := COALESCE((v_row->>'num_guests')::integer, 0);
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('status', 'error', 'message', format('row %s num_guests must be an integer', v_row_index));
    END;

    IF v_num_guests < 0 OR v_num_guests > 100 THEN
      RETURN jsonb_build_object('status', 'error', 'message', format('row %s num_guests is out of range', v_row_index));
    END IF;

    BEGIN
      v_discount_amount := COALESCE((v_row->>'discount_amount')::numeric, 0);
      v_subtotal := COALESCE((v_row->>'subtotal')::numeric, 0);
      v_tax := COALESCE((v_row->>'tax')::numeric, 0);
      v_tip := COALESCE((v_row->>'tip')::numeric, 0);
      v_gratuity := COALESCE((v_row->>'gratuity')::numeric, 0);
      v_total := COALESCE((v_row->>'total')::numeric, 0);
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('status', 'error', 'message', format('row %s financial fields must be numeric', v_row_index));
    END;

    BEGIN
      v_voided := COALESCE((v_row->>'voided')::boolean, false);
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('status', 'error', 'message', format('row %s voided must be boolean', v_row_index));
    END;

    v_server_name := public.stockd_sanitize_text(v_row->>'server_name', 120, true);
    v_dining_area := public.stockd_sanitize_text(v_row->>'dining_area', 120, true);
    v_service_period := public.stockd_sanitize_text(v_row->>'service_period', 40, true);
    v_dining_option := COALESCE(
      public.stockd_safe_enum(v_row->>'dining_option', ARRAY['Dine In', 'Take Out', 'Takeout', 'Delivery', 'Pickup'], NULL),
      public.stockd_sanitize_text(v_row->>'dining_option', 40, true)
    );
    v_order_source := COALESCE(
      public.stockd_safe_enum(v_row->>'order_source', ARRAY['toast', 'kiosk', 'api', 'online', 'in_store', 'in-store'], NULL),
      public.stockd_sanitize_text(v_row->>'order_source', 40, true),
      'toast'
    );

    INSERT INTO public.daily_orders (
      business_date, order_id, opened_at, closed_at,
      num_guests, server_name, dining_area, service_period,
      dining_option, order_source, discount_amount,
      subtotal, tax, tip, gratuity, total, voided
    ) VALUES (
      v_business_date,
      v_order_id,
      v_opened_at,
      v_closed_at,
      v_num_guests,
      v_server_name,
      v_dining_area,
      v_service_period,
      v_dining_option,
      v_order_source,
      v_discount_amount,
      v_subtotal,
      v_tax,
      v_tip,
      v_gratuity,
      v_total,
      v_voided
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

CREATE OR REPLACE FUNCTION public.upsert_menu_item(
  p_id       uuid    DEFAULT NULL,
  p_name     text    DEFAULT NULL,
  p_category text    DEFAULT NULL,
  p_active   boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_name text;
  v_category text;
BEGIN
  v_name := public.stockd_sanitize_text(p_name, 160, true);
  v_category := public.stockd_sanitize_text(p_category, 80, true);

  IF v_name IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'name is required');
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE public.menu_items
    SET name     = v_name,
        category = v_category,
        active   = p_active
    WHERE id = p_id
    RETURNING id, name INTO v_id, v_name;

    IF v_id IS NULL THEN
      RETURN jsonb_build_object('status', 'error', 'message', 'menu item not found');
    END IF;

    RETURN jsonb_build_object('status', 'success', 'action', 'updated',
      'id', v_id, 'name', v_name);
  ELSE
    SELECT id INTO v_id FROM public.menu_items WHERE LOWER(name) = LOWER(v_name);
    IF v_id IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'error', 'message',
        'menu item with this name already exists', 'existing_id', v_id);
    END IF;

    INSERT INTO public.menu_items (name, category, active)
    VALUES (v_name, v_category, p_active)
    RETURNING id, name INTO v_id, v_name;

    RETURN jsonb_build_object('status', 'success', 'action', 'created',
      'id', v_id, 'name', v_name);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_ingredient(
  p_id             uuid         DEFAULT NULL,
  p_name           text         DEFAULT NULL,
  p_unit           unit_type    DEFAULT 'oz',
  p_reorder_point  numeric      DEFAULT 0,
  p_lead_time_days integer      DEFAULT 1,
  p_unit_cost      numeric      DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_name text;
BEGIN
  v_name := public.stockd_sanitize_text(p_name, 160, true);

  IF v_name IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'name is required');
  END IF;
  IF p_reorder_point < 0 THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'reorder_point must be >= 0');
  END IF;
  IF p_lead_time_days < 0 THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'lead_time_days must be >= 0');
  END IF;
  IF p_unit_cost < 0 THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'unit_cost must be >= 0');
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE public.ingredients
    SET name           = v_name,
        unit           = p_unit,
        reorder_point  = p_reorder_point,
        lead_time_days = p_lead_time_days,
        unit_cost      = p_unit_cost
    WHERE id = p_id
    RETURNING id, name INTO v_id, v_name;

    IF v_id IS NULL THEN
      RETURN jsonb_build_object('status', 'error', 'message', 'ingredient not found');
    END IF;

    RETURN jsonb_build_object('status', 'success', 'action', 'updated',
      'id', v_id, 'name', v_name);
  ELSE
    SELECT id INTO v_id FROM public.ingredients WHERE LOWER(name) = LOWER(v_name);
    IF v_id IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'error', 'message',
        'ingredient with this name already exists', 'existing_id', v_id);
    END IF;

    INSERT INTO public.ingredients (name, unit, reorder_point, lead_time_days, unit_cost)
    VALUES (v_name, p_unit, p_reorder_point, p_lead_time_days, p_unit_cost)
    RETURNING id, name INTO v_id, v_name;

    RETURN jsonb_build_object('status', 'success', 'action', 'created',
      'id', v_id, 'name', v_name);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_order(p_order_raw text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_data jsonb;
  v_order_id text;
  v_business_date date;
  v_opened_at timestamptz;
  v_closed_at timestamptz;
  v_num_guests integer := 0;
  v_server_name text;
  v_dining_area text;
  v_service_period text;
  v_dining_option text;
  v_order_source text;
  v_discount_amount numeric := 0;
  v_subtotal numeric := 0;
  v_tax numeric := 0;
  v_tip numeric := 0;
  v_gratuity numeric := 0;
  v_total numeric := 0;
  v_voided boolean := false;
  v_item jsonb;
  v_menu_item_id uuid;
  v_item_name text;
  v_item_category text;
  v_item_qty numeric;
  v_item_price numeric;
  v_items_processed integer := 0;
  v_items_created integer := 0;
  v_ingredients_consumed integer := 0;
  v_row_index integer := 0;
BEGIN
  BEGIN
    v_data := p_order_raw::jsonb;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'order payload must be valid JSON');
  END;

  IF jsonb_typeof(v_data) <> 'object' THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'order payload must be a JSON object');
  END IF;

  v_order_id := public.stockd_sanitize_text(v_data->>'order_id', 120, true);
  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'order_id is required');
  END IF;

  BEGIN
    v_business_date := COALESCE((v_data->>'business_date')::date, current_date);
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'business_date must be a valid date');
  END;

  IF v_data->'items' IS NULL OR jsonb_typeof(v_data->'items') <> 'array' OR jsonb_array_length(v_data->'items') = 0 THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'items array is required and must not be empty');
  END IF;

  BEGIN
    v_opened_at := CASE
      WHEN v_data->>'opened_at' IS NOT NULL AND btrim(v_data->>'opened_at') <> ''
      THEN (v_data->>'opened_at')::timestamptz
      ELSE NULL
    END;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'opened_at must be a valid timestamp');
  END;

  BEGIN
    v_closed_at := CASE
      WHEN v_data->>'closed_at' IS NOT NULL AND btrim(v_data->>'closed_at') <> ''
      THEN (v_data->>'closed_at')::timestamptz
      ELSE NULL
    END;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'closed_at must be a valid timestamp');
  END;

  BEGIN
    v_num_guests := COALESCE((v_data->>'num_guests')::integer, 0);
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'num_guests must be an integer');
  END;

  IF v_num_guests < 0 OR v_num_guests > 100 THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'num_guests must be between 0 and 100');
  END IF;

  BEGIN
    v_discount_amount := COALESCE((v_data->>'discount_amount')::numeric, 0);
    v_subtotal := COALESCE((v_data->>'subtotal')::numeric, 0);
    v_tax := COALESCE((v_data->>'tax')::numeric, 0);
    v_tip := COALESCE((v_data->>'tip')::numeric, 0);
    v_gratuity := COALESCE((v_data->>'gratuity')::numeric, 0);
    v_total := COALESCE((v_data->>'total')::numeric, 0);
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'subtotal, tax, tip, gratuity, and total must be numeric');
  END;

  BEGIN
    v_voided := COALESCE((v_data->>'voided')::boolean, false);
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'voided must be boolean');
  END;

  v_server_name := public.stockd_sanitize_text(v_data->>'server_name', 120, true);
  v_dining_area := public.stockd_sanitize_text(v_data->>'dining_area', 120, true);
  v_service_period := public.stockd_sanitize_text(v_data->>'service_period', 40, true);
  v_dining_option := COALESCE(
    public.stockd_safe_enum(v_data->>'dining_option', ARRAY['Dine In', 'Take Out', 'Takeout', 'Delivery', 'Pickup'], NULL),
    'Dine In'
  );
  v_order_source := COALESCE(
    public.stockd_safe_enum(v_data->>'order_source', ARRAY['kiosk', 'toast', 'api', 'online', 'in_store', 'in-store'], NULL),
    'api'
  );

  IF EXISTS (SELECT 1 FROM public.daily_orders WHERE order_id = v_order_id) THEN
    UPDATE public.daily_orders SET
      business_date   = v_business_date,
      opened_at       = v_opened_at,
      closed_at       = v_closed_at,
      num_guests      = v_num_guests,
      server_name     = v_server_name,
      dining_area     = v_dining_area,
      service_period  = v_service_period,
      dining_option   = v_dining_option,
      order_source    = v_order_source,
      discount_amount = v_discount_amount,
      subtotal        = v_subtotal,
      tax             = v_tax,
      tip             = v_tip,
      gratuity        = v_gratuity,
      total           = v_total,
      voided          = v_voided
    WHERE order_id = v_order_id;

    RETURN jsonb_build_object(
      'status',   'duplicate',
      'message',  'Order already exists. Metadata updated, items NOT re-consumed.',
      'order_id', v_order_id
    );
  END IF;

  INSERT INTO public.daily_orders (
    business_date, order_id, opened_at, closed_at,
    num_guests, server_name, dining_area, service_period,
    dining_option, order_source, discount_amount,
    subtotal, tax, tip, gratuity, total, voided
  ) VALUES (
    v_business_date,
    v_order_id,
    v_opened_at,
    v_closed_at,
    v_num_guests,
    v_server_name,
    v_dining_area,
    v_service_period,
    v_dining_option,
    v_order_source,
    v_discount_amount,
    v_subtotal,
    v_tax,
    v_tip,
    v_gratuity,
    v_total,
    v_voided
  );

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_data->'items')
  LOOP
    v_row_index := v_row_index + 1;

    IF jsonb_typeof(v_item) <> 'object' THEN
      RETURN jsonb_build_object('status', 'error', 'message', format('items[%s] must be a JSON object', v_row_index));
    END IF;

    v_item_name := public.stockd_sanitize_text(v_item->>'menu_item_name', 160, true);
    v_item_category := COALESCE(public.stockd_sanitize_text(v_item->>'category', 80, true), 'Uncategorized');

    IF v_item_name IS NULL THEN
      RETURN jsonb_build_object('status', 'error', 'message', format('items[%s].menu_item_name is required', v_row_index));
    END IF;

    BEGIN
      v_item_qty := COALESCE((v_item->>'qty')::numeric, 1);
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('status', 'error', 'message', format('items[%s].qty must be numeric', v_row_index));
    END;

    BEGIN
      v_item_price := COALESCE((v_item->>'price')::numeric, 0);
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('status', 'error', 'message', format('items[%s].price must be numeric', v_row_index));
    END;

    IF v_item_qty <= 0 OR v_item_qty > 100000 THEN
      RETURN jsonb_build_object('status', 'error', 'message', format('items[%s].qty is out of range', v_row_index));
    END IF;

    IF v_item_price < -1000000 OR v_item_price > 1000000 THEN
      RETURN jsonb_build_object('status', 'error', 'message', format('items[%s].price is out of range', v_row_index));
    END IF;

    SELECT id INTO v_menu_item_id
    FROM public.menu_items
    WHERE name = v_item_name;

    IF v_menu_item_id IS NULL THEN
      INSERT INTO public.menu_items (name, category)
      VALUES (
        v_item_name,
        v_item_category
      )
      RETURNING id INTO v_menu_item_id;
      v_items_created := v_items_created + 1;
    END IF;

    INSERT INTO public.sales_line_items
      (business_date, menu_item_id, qty, net_sales, source)
    VALUES (
      v_business_date,
      v_menu_item_id,
      v_item_qty,
      v_item_price,
      'api'
    )
    ON CONFLICT (business_date, menu_item_id)
    DO UPDATE SET
      qty       = sales_line_items.qty + EXCLUDED.qty,
      net_sales = sales_line_items.net_sales + EXCLUDED.net_sales;

    INSERT INTO public.inventory_txns
      (ingredient_id, txn_type, qty_delta, business_date, note)
    SELECT
      b.ingredient_id,
      'CONSUME',
      -(v_item_qty * b.qty_per_item),
      v_business_date,
      'Order ' || v_order_id || ': ' || v_item_name
    FROM public.bom b
    WHERE b.menu_item_id = v_menu_item_id;

    INSERT INTO public.inventory_on_hand (ingredient_id, qty_on_hand, updated_at)
    SELECT
      b.ingredient_id,
      -(v_item_qty * b.qty_per_item),
      now()
    FROM public.bom b
    WHERE b.menu_item_id = v_menu_item_id
    ON CONFLICT (ingredient_id)
    DO UPDATE SET
      qty_on_hand = inventory_on_hand.qty_on_hand + EXCLUDED.qty_on_hand,
      updated_at  = now();

    v_ingredients_consumed := v_ingredients_consumed + (
      SELECT COUNT(*)::integer FROM public.bom WHERE menu_item_id = v_menu_item_id
    );

    v_items_processed := v_items_processed + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'status',               'success',
    'order_id',             v_order_id,
    'business_date',        v_business_date,
    'items_processed',      v_items_processed,
    'menu_items_created',   v_items_created,
    'ingredients_consumed', v_ingredients_consumed
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
