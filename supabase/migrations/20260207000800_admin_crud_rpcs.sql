-- ============================================================
-- Migration: Admin CRUD RPCs (Module 7 backend)
--
-- Validated RPCs for managing menu items, ingredients, and BOM.
-- Prevents bad data from reaching the DB.
-- ============================================================

-- ============================================================
-- 1. upsert_menu_item
-- ============================================================
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
  v_id   uuid;
  v_name text;
BEGIN
  -- Validate
  IF p_name IS NULL OR TRIM(p_name) = '' THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'name is required');
  END IF;

  IF p_id IS NOT NULL THEN
    -- Update existing
    UPDATE public.menu_items
    SET name     = TRIM(p_name),
        category = p_category,
        active   = p_active
    WHERE id = p_id
    RETURNING id, name INTO v_id, v_name;

    IF v_id IS NULL THEN
      RETURN jsonb_build_object('status', 'error', 'message', 'menu item not found');
    END IF;

    RETURN jsonb_build_object('status', 'success', 'action', 'updated',
      'id', v_id, 'name', v_name);
  ELSE
    -- Check duplicate name
    SELECT id INTO v_id FROM public.menu_items WHERE LOWER(name) = LOWER(TRIM(p_name));
    IF v_id IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'error', 'message',
        'menu item with this name already exists', 'existing_id', v_id);
    END IF;

    -- Insert new
    INSERT INTO public.menu_items (name, category, active)
    VALUES (TRIM(p_name), p_category, p_active)
    RETURNING id, name INTO v_id, v_name;

    RETURN jsonb_build_object('status', 'success', 'action', 'created',
      'id', v_id, 'name', v_name);
  END IF;
END;
$$;

-- ============================================================
-- 2. deactivate_menu_item
-- ============================================================
CREATE OR REPLACE FUNCTION public.deactivate_menu_item(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  UPDATE public.menu_items SET active = false WHERE id = p_id RETURNING name INTO v_name;

  IF v_name IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'menu item not found');
  END IF;

  RETURN jsonb_build_object('status', 'success', 'id', p_id, 'name', v_name, 'active', false);
END;
$$;

-- ============================================================
-- 3. upsert_ingredient
-- ============================================================
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
  v_id   uuid;
  v_name text;
BEGIN
  IF p_name IS NULL OR TRIM(p_name) = '' THEN
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
    SET name           = TRIM(p_name),
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
    SELECT id INTO v_id FROM public.ingredients WHERE LOWER(name) = LOWER(TRIM(p_name));
    IF v_id IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'error', 'message',
        'ingredient with this name already exists', 'existing_id', v_id);
    END IF;

    INSERT INTO public.ingredients (name, unit, reorder_point, lead_time_days, unit_cost)
    VALUES (TRIM(p_name), p_unit, p_reorder_point, p_lead_time_days, p_unit_cost)
    RETURNING id, name INTO v_id, v_name;

    RETURN jsonb_build_object('status', 'success', 'action', 'created',
      'id', v_id, 'name', v_name);
  END IF;
END;
$$;

-- ============================================================
-- 4. upsert_bom_entry
-- ============================================================
CREATE OR REPLACE FUNCTION public.upsert_bom_entry(
  p_menu_item_id  uuid,
  p_ingredient_id uuid,
  p_qty_per_item  numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mi_name  text;
  v_ing_name text;
BEGIN
  IF p_qty_per_item IS NULL OR p_qty_per_item <= 0 THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'qty_per_item must be > 0');
  END IF;

  -- Validate FK references exist
  SELECT name INTO v_mi_name FROM public.menu_items WHERE id = p_menu_item_id;
  IF v_mi_name IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'menu item not found');
  END IF;

  SELECT name INTO v_ing_name FROM public.ingredients WHERE id = p_ingredient_id;
  IF v_ing_name IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'ingredient not found');
  END IF;

  INSERT INTO public.bom (menu_item_id, ingredient_id, qty_per_item)
  VALUES (p_menu_item_id, p_ingredient_id, p_qty_per_item)
  ON CONFLICT (menu_item_id, ingredient_id) DO UPDATE
    SET qty_per_item = EXCLUDED.qty_per_item;

  RETURN jsonb_build_object(
    'status',        'success',
    'menu_item',     v_mi_name,
    'ingredient',    v_ing_name,
    'qty_per_item',  p_qty_per_item
  );
END;
$$;

-- ============================================================
-- 5. delete_bom_entry
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_bom_entry(
  p_menu_item_id  uuid,
  p_ingredient_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.bom
  WHERE menu_item_id = p_menu_item_id
    AND ingredient_id = p_ingredient_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 0 THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'BOM entry not found');
  END IF;

  RETURN jsonb_build_object('status', 'success', 'deleted', true);
END;
$$;

-- ============================================================
-- 6. get_bom_for_item(p_menu_item_id uuid)
--    Returns BOM entries for a specific menu item.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_bom_for_item(p_menu_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_name   text;
BEGIN
  SELECT name INTO v_name FROM public.menu_items WHERE id = p_menu_item_id;
  IF v_name IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'menu item not found');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'ingredient_id', b.ingredient_id,
    'ingredient_name', i.name,
    'unit', i.unit,
    'qty_per_item', b.qty_per_item,
    'unit_cost', i.unit_cost,
    'cost_per_item', ROUND(b.qty_per_item * i.unit_cost, 4)
  ) ORDER BY i.name), '[]'::jsonb)
  INTO v_result
  FROM public.bom b
  JOIN public.ingredients i ON i.id = b.ingredient_id
  WHERE b.menu_item_id = p_menu_item_id;

  RETURN jsonb_build_object(
    'status', 'success',
    'menu_item_id', p_menu_item_id,
    'menu_item_name', v_name,
    'ingredients', v_result,
    'total_cost', (SELECT COALESCE(SUM(b.qty_per_item * i.unit_cost), 0)
                   FROM public.bom b JOIN public.ingredients i ON i.id = b.ingredient_id
                   WHERE b.menu_item_id = p_menu_item_id)
  );
END;
$$;
