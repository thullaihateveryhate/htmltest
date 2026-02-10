-- ============================================================
-- Module 4: Inventory Ops — Receive + Count
-- ============================================================

-- ============================================================
-- 1. receive_inventory
--
--    Receives a delivery: adds qty to inventory, creates
--    a RECEIVE txn for audit trail.
--
--    Validates: qty must be > 0.
--    Creates inventory_on_hand row if none exists.
--
--    Example:
--      supabase.rpc('receive_inventory', {
--        p_ingredient_id: '...', p_qty: 25, p_note: 'Sysco delivery'
--      })
-- ============================================================
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
BEGIN
  -- Validate
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN jsonb_build_object(
      'status', 'error',
      'message', 'qty must be greater than 0'
    );
  END IF;

  -- Verify ingredient exists
  IF NOT EXISTS (SELECT 1 FROM public.ingredients WHERE id = p_ingredient_id) THEN
    RETURN jsonb_build_object(
      'status', 'error',
      'message', 'ingredient not found'
    );
  END IF;

  -- Create RECEIVE txn
  INSERT INTO public.inventory_txns (ingredient_id, txn_type, qty_delta, note)
  VALUES (p_ingredient_id, 'RECEIVE', p_qty, p_note);

  -- Upsert inventory_on_hand
  INSERT INTO public.inventory_on_hand (ingredient_id, qty_on_hand, updated_at)
  VALUES (p_ingredient_id, p_qty, now())
  ON CONFLICT (ingredient_id)
  DO UPDATE SET
    qty_on_hand = inventory_on_hand.qty_on_hand + EXCLUDED.qty_on_hand,
    updated_at = now();

  -- Get new qty
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

-- ============================================================
-- 2. count_inventory
--
--    Physical count correction: sets inventory to the actual
--    counted qty. Computes delta from current on_hand,
--    records a COUNT txn.
--
--    Validates: actual_qty must be >= 0.
--    Creates inventory_on_hand row if none exists (treats
--    previous qty as 0).
--
--    Example:
--      supabase.rpc('count_inventory', {
--        p_ingredient_id: '...', p_actual_qty: 85
--      })
-- ============================================================
CREATE OR REPLACE FUNCTION public.count_inventory(
  p_ingredient_id uuid,
  p_actual_qty numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_qty numeric;
  v_delta numeric;
BEGIN
  -- Validate
  IF p_actual_qty IS NULL OR p_actual_qty < 0 THEN
    RETURN jsonb_build_object(
      'status', 'error',
      'message', 'actual_qty must be >= 0'
    );
  END IF;

  -- Verify ingredient exists
  IF NOT EXISTS (SELECT 1 FROM public.ingredients WHERE id = p_ingredient_id) THEN
    RETURN jsonb_build_object(
      'status', 'error',
      'message', 'ingredient not found'
    );
  END IF;

  -- Get current qty (0 if no row exists)
  SELECT COALESCE(qty_on_hand, 0) INTO v_current_qty
  FROM public.inventory_on_hand
  WHERE ingredient_id = p_ingredient_id;

  IF NOT FOUND THEN
    v_current_qty := 0;
  END IF;

  v_delta := p_actual_qty - v_current_qty;

  -- Create COUNT txn
  INSERT INTO public.inventory_txns (ingredient_id, txn_type, qty_delta, note)
  VALUES (
    p_ingredient_id,
    'COUNT',
    v_delta,
    'Physical count: ' || v_current_qty || ' → ' || p_actual_qty
  );

  -- Set inventory to actual qty
  INSERT INTO public.inventory_on_hand (ingredient_id, qty_on_hand, updated_at)
  VALUES (p_ingredient_id, p_actual_qty, now())
  ON CONFLICT (ingredient_id)
  DO UPDATE SET
    qty_on_hand = EXCLUDED.qty_on_hand,
    updated_at = now();

  RETURN jsonb_build_object(
    'status', 'success',
    'ingredient_id', p_ingredient_id,
    'previous_qty', v_current_qty,
    'actual_qty', p_actual_qty,
    'delta', v_delta,
    'new_qty_on_hand', p_actual_qty
  );
END;
$$;
