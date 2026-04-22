# Stockd Pitch

## One-Line Pitch

Stockd is an AI-powered restaurant operations platform that helps kitchens reduce food waste, avoid stockouts, and order smarter by turning sales, inventory, and forecasting into one live system.

## 30-Second Pitch

Restaurants are still making inventory decisions with spreadsheets, pen and paper, and gut feeling. That leads to waste, stockouts, lost revenue, and hours of manual work every week.

Stockd fixes that by connecting sales data to real inventory usage. We show managers what they have on hand, what is running low, what they will need over the next seven days, and what actions to take next. On top of that, we added an AI copilot so they can ask natural-language questions like, "What will I run out of this week?" or "How did Tuesday perform?"

In short, Stockd turns inventory management from a guessing game into a profit tool.

## Demo Day Pitch

Hi everyone, we are **Stockd**.

Our project started with a simple problem: restaurants lose an enormous amount of money because inventory is still managed reactively. Most small and medium restaurants do not have enterprise software, and the tools they do use are often disconnected. Sales live in one place, purchase decisions live in somebody's head, and inventory counts happen too late.

The result is expensive:

- Restaurants over-order and food spoils.
- They under-order and run out of key ingredients.
- Managers waste hours every week trying to reconcile what was sold with what is actually left in the kitchen.

We built Stockd to solve that.

Stockd is a restaurant operations platform that combines **inventory tracking, sales analytics, forecasting, and AI assistance** into one workflow. Instead of just showing raw numbers, it helps a restaurant decide what to do next.

Here is how it works.

First, the restaurant uploads sales history from their POS. In our case, that can come from Toast-style exports. Stockd ingests those sales, maps them to menu items, and links every item to its bill of materials, meaning the ingredients required to make it.

Once that relationship exists, the platform can automatically convert sales into ingredient consumption. That means we are not just tracking what was sold. We are tracking what was actually used.

From there, the dashboard becomes genuinely useful.

On the main dashboard, a manager can immediately see:

- revenue trends
- menu performance
- inventory health
- low-stock alerts
- reorder suggestions
- seven-day ingredient forecasts

So instead of asking, "How much cheese do we think we need?" they can ask, "How much cheese will we need over the next week, how much do we have, and what should we order right now?"

We also built two operational workflows that matter in a real kitchen.

The first is **Receive**. When inventory arrives, staff can record a delivery and update stock in real time.

The second is **Count**. If the team performs a physical count and the real quantity does not match the system, Stockd records the discrepancy and adjusts inventory cleanly.

That means the system does not drift further away from reality over time. It gets corrected continuously.

On top of the dashboard and operations workflows, we added an **AI Copilot** powered by Gemini. This gives restaurant managers a natural-language way to interact with their business. They can ask:

- What ingredients are running low?
- What is my forecast for the next seven days?
- Which items sold best this week?
- What happened on a specific day?

So instead of clicking through multiple screens, the manager can just ask the system directly and get a useful answer grounded in live business data.

Technically, Stockd is built on a full data pipeline:

- a vanilla JavaScript frontend for speed and simplicity
- Supabase and PostgreSQL for the backend, auth, and realtime data
- custom RPCs and database functions for inventory logic, sales aggregation, and forecasting
- Gemini for AI-powered analysis and conversational access to the data
- Vercel for deployment

One of the things we are most proud of is that this is not just a static analytics dashboard. It is an interactive operational system. We ingest sales, generate consumption, update on-hand quantities, record receives and counts, generate forecasts, and surface all of that in a clean interface that is actually demoable and actually useful.

The bigger vision is that restaurants should not need enterprise budgets to get enterprise-quality decision support. Stockd gives smaller operators the ability to manage waste, protect margins, and make smarter purchasing decisions with tools that feel modern and accessible.

So if I had to summarize Stockd in one sentence:

**Stockd helps restaurants buy smarter, waste less, and make more money by turning kitchen data into real-time decisions.**

Thank you.

## Live Demo Walkthrough

If you want to present while clicking through the product, use this flow:

1. Start on the dashboard.
Show revenue, alerts, inventory health, and the seven-day forecast. Frame this as the restaurant manager's command center.

2. Open Sales Analysis.
Explain that Stockd does not just track stock levels. It understands how the business is performing day by day and item by item.

3. Open Receive.
Show that deliveries can be recorded directly in the system, so inventory updates when food actually enters the kitchen.

4. Open Count.
Show that physical counts can correct the system and capture discrepancies, which is critical for real-world accuracy.

5. Show the AI Copilot.
Ask a question about inventory, forecasts, or sales. This is the easiest way to show that the platform is not just data storage, but decision support.

## Technical Explanation

For judges or technical Q and A, here is the concise version.

Stockd uses historical sales data as the system of record for demand. Each menu item is tied to ingredients through a bill of materials. When sales are ingested or orders are registered, Stockd can translate sold items into ingredient consumption. That feeds inventory movement, low-stock alerts, and forecasting.

Forecasting is built around historical patterns and day-of-week behavior, then surfaced both in the UI and through the AI copilot. Operational events like receiving inventory and physical counts are written back into the same data model, so the dashboard reflects both expected consumption and real-world corrections.

The result is a full feedback loop:

- sales create consumption
- consumption affects inventory
- inventory powers alerts
- history powers forecasts
- managers use receive and count flows to keep the system accurate
- the AI layer makes the whole system easier to query and understand

## Why It Matters

Stockd matters because restaurant margins are thin, and bad inventory decisions are expensive. Every missed order, spoiled ingredient, and emergency purchase cuts directly into profit.

We are not just building software for convenience. We are building software that helps restaurants:

- reduce food waste
- save manager time
- avoid stockouts
- make better purchasing decisions
- improve profitability

## Strong Closing Line

Restaurants should not have to choose between intuition and expensive software. Stockd gives them a smarter third option: live inventory intelligence that is practical, fast, and actionable.
