-- ============================================================
-- Module 9: Live Order Registration API
-- ============================================================

-- Drop all overloads to ensure clean state
DROP FUNCTION IF EXISTS public.register_order(text);
DROP FUNCTION IF EXISTS public.register_order(json);
DROP FUNCTION IF EXISTS public.register_order(jsonb);

CREATE FUNCTION public.register_order(p_order_raw text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_data           jsonb;
  v_order_id       text;
  v_business_date  date;
  v_item           jsonb;
  v_menu_item_id   uuid;
  v_items_processed   integer := 0;
  v_items_created     integer := 0;
  v_ingredients_consumed integer := 0;
BEGIN
  -- Cast text → jsonb right away
  v_data := p_order_raw::jsonb;

  -- --- Validate required fields ---
  v_order_id := v_data->>'order_id';
  IF v_order_id IS NULL OR v_order_id = '' THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'order_id is required');
  END IF;

  v_business_date := COALESCE(
    (v_data->>'business_date')::date,
    current_date
  );

  IF v_data->'items' IS NULL OR jsonb_array_length(v_data->'items') = 0 THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'items array is required and must not be empty');
  END IF;

  -- --- Check for duplicate order (idempotency) ---
  IF EXISTS (SELECT 1 FROM public.daily_orders WHERE order_id = v_order_id) THEN
    UPDATE public.daily_orders SET
      business_date   = v_business_date,
      opened_at       = (v_data->>'opened_at')::timestamptz,
      closed_at       = (v_data->>'closed_at')::timestamptz,
      num_guests      = COALESCE((v_data->>'num_guests')::integer, 0),
      server_name     = v_data->>'server_name',
      dining_area     = v_data->>'dining_area',
      service_period  = v_data->>'service_period',
      dining_option   = v_data->>'dining_option',
      order_source    = v_data->>'order_source',
      discount_amount = COALESCE((v_data->>'discount_amount')::numeric, 0),
      subtotal        = COALESCE((v_data->>'subtotal')::numeric, 0),
      tax             = COALESCE((v_data->>'tax')::numeric, 0),
      tip             = COALESCE((v_data->>'tip')::numeric, 0),
      gratuity        = COALESCE((v_data->>'gratuity')::numeric, 0),
      total           = COALESCE((v_data->>'total')::numeric, 0),
      voided          = COALESCE((v_data->>'voided')::boolean, false)
    WHERE order_id = v_order_id;

    RETURN jsonb_build_object(
      'status',   'duplicate',
      'message',  'Order already exists. Metadata updated, items NOT re-consumed.',
      'order_id', v_order_id
    );
  END IF;

  -- --- 1. Insert order metadata ---
  INSERT INTO public.daily_orders (
    business_date, order_id, opened_at, closed_at,
    num_guests, server_name, dining_area, service_period,
    dining_option, order_source, discount_amount,
    subtotal, tax, tip, gratuity, total, voided
  ) VALUES (
    v_business_date,
    v_order_id,
    (v_data->>'opened_at')::timestamptz,
    (v_data->>'closed_at')::timestamptz,
    COALESCE((v_data->>'num_guests')::integer, 0),
    v_data->>'server_name',
    v_data->>'dining_area',
    v_data->>'service_period',
    v_data->>'dining_option',
    v_data->>'order_source',
    COALESCE((v_data->>'discount_amount')::numeric, 0),
    COALESCE((v_data->>'subtotal')::numeric, 0),
    COALESCE((v_data->>'tax')::numeric, 0),
    COALESCE((v_data->>'tip')::numeric, 0),
    COALESCE((v_data->>'gratuity')::numeric, 0),
    COALESCE((v_data->>'total')::numeric, 0),
    COALESCE((v_data->>'voided')::boolean, false)
  );

  -- --- 2. Process each line item ---
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_data->'items')
  LOOP
    -- Look up menu item by name
    SELECT id INTO v_menu_item_id
    FROM public.menu_items
    WHERE name = (v_item->>'menu_item_name');

    -- Auto-create if missing
    IF v_menu_item_id IS NULL THEN
      INSERT INTO public.menu_items (name, category)
      VALUES (
        v_item->>'menu_item_name',
        COALESCE(v_item->>'category', 'Uncategorized')
      )
      RETURNING id INTO v_menu_item_id;
      v_items_created := v_items_created + 1;
    END IF;

    -- Upsert into sales_line_items (ADD to running totals)
    INSERT INTO public.sales_line_items
      (business_date, menu_item_id, qty, net_sales, source)
    VALUES (
      v_business_date,
      v_menu_item_id,
      COALESCE((v_item->>'qty')::numeric, 1),
      COALESCE((v_item->>'price')::numeric, 0),
      'api'
    )
    ON CONFLICT (business_date, menu_item_id)
    DO UPDATE SET
      qty       = sales_line_items.qty + EXCLUDED.qty,
      net_sales = sales_line_items.net_sales + EXCLUDED.net_sales;

    -- --- 3. Consume ingredients via BOM ---
    INSERT INTO public.inventory_txns
      (ingredient_id, txn_type, qty_delta, business_date, note)
    SELECT
      b.ingredient_id,
      'CONSUME',
      -(COALESCE((v_item->>'qty')::numeric, 1) * b.qty_per_item),
      v_business_date,
      'Order ' || v_order_id || ': ' || (v_item->>'menu_item_name')
    FROM public.bom b
    WHERE b.menu_item_id = v_menu_item_id;

    -- Decrement inventory_on_hand
    INSERT INTO public.inventory_on_hand (ingredient_id, qty_on_hand, updated_at)
    SELECT
      b.ingredient_id,
      -(COALESCE((v_item->>'qty')::numeric, 1) * b.qty_per_item),
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
