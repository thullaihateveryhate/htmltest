-- Minimal seed data for local/dev validation
with new_item as (
  insert into public.menu_items (name, category)
  values ('Cheeseburger', 'Entree')
  returning id
),
new_ing as (
  insert into public.ingredients (name, unit, reorder_point, lead_time_days, unit_cost)
  values ('Ground beef', 'lb', 10, 2, 3.50)
  returning id
)
insert into public.bom (menu_item_id, ingredient_id, qty_per_item)
select new_item.id, new_ing.id, 0.25
from new_item, new_ing;

insert into public.inventory_on_hand (ingredient_id, qty_on_hand)
select id, 20
from public.ingredients
where name = 'Ground beef';

insert into public.sales_line_items (business_date, menu_item_id, qty, net_sales, source)
select current_date, id, 8, 79.92, 'seed'
from public.menu_items
where name = 'Cheeseburger';
