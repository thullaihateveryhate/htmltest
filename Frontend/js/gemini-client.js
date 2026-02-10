// ═══════════════════════════════════════════════════════════════
// gemini-client.js — Gemini AI Client with Function Calling
// ═══════════════════════════════════════════════════════════════

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// ─── Tool Definitions for Function Calling ─────────────────────

const GEMINI_TOOLS = [
    {
        function_declarations: [
            // READ-ONLY TOOLS
            {
                name: "get_inventory_snapshot",
                description: "Get current inventory levels for all ingredients with stock status, days of supply, and reorder recommendations. Use this when the user asks about inventory, stock levels, what's running low, or what needs to be ordered.",
                parameters: {
                    type: "object",
                    properties: {}
                }
            },
            {
                name: "get_forecast",
                description: "Get ingredient demand forecast for the next 7 days based on historical sales patterns. Shows quantity needed, current stock, and potential shortfalls. Use when user asks about future needs, prep, or planning.",
                parameters: {
                    type: "object",
                    properties: {
                        p_reference_date: {
                            type: "string",
                            description: "Starting date for forecast in YYYY-MM-DD format. Defaults to today."
                        }
                    }
                }
            },
            {
                name: "get_revenue_trend",
                description: "Get daily revenue, order count, and average order value for the past N days. Use for business performance questions like 'how are we doing' or 'show me sales'.",
                parameters: {
                    type: "object",
                    properties: {
                        p_days: {
                            type: "integer",
                            description: "Number of days to look back. Default is 30. Use 3650 for 'all time'."
                        }
                    }
                }
            },
            {
                name: "get_daily_analytics",
                description: "Get detailed analytics for a specific date including revenue breakdown by service period (Lunch/Dinner), dining option (Dine-in/Takeout/Delivery), peak hours, and top servers. Use for questions about specific days.",
                parameters: {
                    type: "object",
                    properties: {
                        p_business_date: {
                            type: "string",
                            description: "Date to analyze in YYYY-MM-DD format. If not provided, uses most recent date with data."
                        }
                    }
                }
            },
            {
                name: "get_bom_for_item",
                description: "Get the bill of materials (recipe/ingredients) for a specific menu item. Use when user asks about what goes into a dish or recipe details.",
                parameters: {
                    type: "object",
                    properties: {
                        p_menu_item_id: {
                            type: "string",
                            description: "UUID of the menu item"
                        }
                    },
                    required: ["p_menu_item_id"]
                }
            },
            {
                name: "search_ingredient",
                description: "Search for an ingredient by name to find its ID. Use this BEFORE calling receive_inventory or count_inventory when the user mentions an ingredient by name.",
                parameters: {
                    type: "object",
                    properties: {
                        ingredient_name: {
                            type: "string",
                            description: "Name or partial name of the ingredient to search for"
                        }
                    },
                    required: ["ingredient_name"]
                }
            },
            {
                name: "search_menu_item",
                description: "Search for a menu item by name to find its ID. Use this before operations that need a menu_item_id.",
                parameters: {
                    type: "object",
                    properties: {
                        item_name: {
                            type: "string",
                            description: "Name or partial name of the menu item"
                        }
                    },
                    required: ["item_name"]
                }
            },
            {
                name: "get_top_selling_items",
                description: "Get top selling items based on quantity sold. Use for questions like 'most popular', 'best sellers', 'most liked', or 'favorites'.",
                parameters: {
                    type: "object",
                    properties: {
                        limit: {
                            type: "integer",
                            description: "Number of items to return (default 5)"
                        },
                        category: {
                            type: "string",
                            description: "Optional category filter (e.g. 'Pizza', 'Beverage')"
                        },
                        sort: {
                            type: "string",
                            description: "Sort order: 'desc' (default) for most sold, 'asc' for least sold.",
                            enum: ["asc", "desc"]
                        }
                    }
                }
            },
            {
                name: "get_menu_items_by_ingredient",
                description: "Find menu items that contain a specific ingredient. Use when asked 'What dishes use X?' or 'items with X'.",
                parameters: {
                    type: "object",
                    properties: {
                        ingredient_name: {
                            type: "string",
                            description: "Name of the ingredient"
                        }
                    },
                    required: ["ingredient_name"]
                }
            },

            // WRITE TOOLS (require confirmation)
            {
                name: "receive_inventory",
                description: "Record a delivery/receipt of inventory. IMPORTANT: Always ask the user to confirm before executing this. Use when user says they received a shipment or delivery.",
                parameters: {
                    type: "object",
                    properties: {
                        p_ingredient_id: {
                            type: "string",
                            description: "UUID of the ingredient"
                        },
                        p_qty: {
                            type: "number",
                            description: "Quantity received (must be positive)"
                        },
                        p_note: {
                            type: "string",
                            description: "Optional note about the delivery"
                        }
                    },
                    required: ["p_ingredient_id", "p_qty"]
                }
            },
            {
                name: "count_inventory",
                description: "Record a physical inventory count (correction). IMPORTANT: Always ask the user to confirm before executing. Use when user does a physical count and wants to correct the system.",
                parameters: {
                    type: "object",
                    properties: {
                        p_ingredient_id: {
                            type: "string",
                            description: "UUID of the ingredient"
                        },
                        p_actual_qty: {
                            type: "number",
                            description: "Actual counted quantity (must be >= 0)"
                        }
                    },
                    required: ["p_ingredient_id", "p_actual_qty"]
                }
            },
            {
                name: "generate_forecast",
                description: "Run the forecasting engine to generate predictions for the next N days. Use when user wants to refresh or generate new forecasts.",
                parameters: {
                    type: "object",
                    properties: {
                        p_days_ahead: {
                            type: "integer",
                            description: "Number of days to forecast ahead (default 7)"
                        },
                        p_reference_date: {
                            type: "string",
                            description: "Starting date for forecast in YYYY-MM-DD format"
                        }
                    }
                }
            },
            {
                name: "predict_revenue",
                description: "Forecasts future revenue for the next N days based on historical sales trends. Use this when the user asks for income, revenue, or sales projections.",
                parameters: {
                    type: "object",
                    properties: {
                        days_ahead: {
                            type: "integer",
                            description: "Number of days to forecast (default 7)"
                        }
                    }
                }
            },
            {
                name: "upsert_bom_entry",
                description: "Update or create a recipe ingredient entry. IMPORTANT: Always ask user to confirm. Use when user wants to modify a recipe.",
                parameters: {
                    type: "object",
                    properties: {
                        p_menu_item_id: {
                            type: "string",
                            description: "UUID of the menu item"
                        },
                        p_ingredient_id: {
                            type: "string",
                            description: "UUID of the ingredient"
                        },
                        p_qty_per_item: {
                            type: "number",
                            description: "Quantity of ingredient per menu item (must be > 0)"
                        }
                    },
                    required: ["p_menu_item_id", "p_ingredient_id", "p_qty_per_item"]
                }
            }
        ]
    }
];

// ─── System Prompt ─────────────────────────────────────────────

function getSystemPrompt() {
    const today = new Date().toISOString().split('T')[0];

    return `You are Stockd AI, an intelligent assistant for restaurant managers. You help with inventory management, sales analytics, and forecasting.

CURRENT DATE: ${today}

BUSINESS CONTEXT:
- Location: Atlanta, GA
- Business Type: Pizza Restaurant & Italian Kitchen

CAPABILITIES:
- Check inventory levels and identify items running low
- Analyze revenue trends and business performance
- Generate and view demand forecasts (ingredients) AND revenue projections (income)
- Help record inventory receipts and counts
- Look up menu item recipes (BOM)

GUIDELINES:
1. Be concise and professional. Restaurant managers are busy.
2. When showing numbers, format them nicely (currency, percentages).
3. For inventory questions, highlight CRITICAL items first (red status).
4. Always search for ingredients/menu items by name before using their IDs.
5. For any operation that MODIFIES data (receive_inventory, count_inventory, upsert_bom_entry), you MUST ask for confirmation first. Say something like "I'll record [X]. Should I proceed?"
6. If an RPC returns an error, explain it in plain English.
7. When asked "what's running low", use get_inventory_snapshot and filter for critical/reorder_soon status.
8. For "how did we do", use get_daily_analytics or get_revenue_trend.
9. For future income/revenue questions, use predict_revenue. Explain that it is an ESTIMATE based on recent trends.
10. For "most liked" or "popular" items, use get_top_selling_items. Interpret "most liked" as "most sold".
11. For "most disliked" or "least popular", use get_top_selling_items with sort='asc'. Interpret "disliked" as "least sold".
12. For "how many X can I make" (production capacity), follow this sequence: A) Search menu item to get ID. B) Call get_bom_for_item. C) Call get_inventory_snapshot to check stock of those ingredients. D) Calculate the limiting factor and answer.
13. For "how to boost sales" or business advice, PROACTIVELY call get_top_selling_items (best & worst) and get_revenue_trend. Analyze the data to suggest promoting high-margin items or bundling low-performing ones.
14. For "what uses X" or "dishes with X", use get_menu_items_by_ingredient.
15. For "average items per order", use get_revenue_trend. Look for 'summary.avg_items_per_order' in the response. If user asks for "whole data" or "all time", set p_days to 3650.
16. **EVENT ANALYSIS**: If the user mentions an event (e.g., "Super Bowl", "Election", "Concert"), assume the location is **Atlanta, GA**. Analyze the specific impact on a **Pizza Restaurant**. Suggest specific inventory buffs (e.g., +30% wings/pepperoni for sports) and staffing adjustments (e.g., +2 drivers).

RESPONSE FORMAT:
- Use bullet points for lists
- Use **bold** for important numbers
- Keep responses under 200 words unless user asks for details`;
}

// ─── Chat Session Class ────────────────────────────────────────

class GeminiChat {
    constructor() {
        this.history = [];
        this.pendingAction = null; // For confirmation flow
    }

    async sendMessage(userMessage) {
        // Add user message to history
        this.history.push({
            role: "user",
            parts: [{ text: userMessage }]
        });

        try {
            const response = await this._callGemini();
            return response;
        } catch (error) {
            console.error('Gemini error:', error);
            return { text: `Sorry, I encountered an error: ${error.message}`, error: true };
        }
    }

    async _callGemini() {
        const requestBody = {
            contents: this.history,
            tools: GEMINI_TOOLS,
            systemInstruction: {
                parts: [{ text: getSystemPrompt() }]
            },
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 1024
            }
        };

        const response = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const candidate = data.candidates?.[0];

        if (!candidate) {
            throw new Error('No response from Gemini');
        }

        const content = candidate.content;

        // Check for function calls
        const functionCall = content.parts?.find(p => p.functionCall);

        if (functionCall) {
            return await this._handleFunctionCall(functionCall.functionCall, content);
        }

        // Regular text response
        const textPart = content.parts?.find(p => p.text);
        const responseText = textPart?.text || "I'm not sure how to respond to that.";

        // Add to history
        this.history.push({
            role: "model",
            parts: [{ text: responseText }]
        });

        return { text: responseText };
    }

    async _handleFunctionCall(functionCall, originalContent) {
        const { name, args } = functionCall;
        console.log(`🔧 Function call: ${name}`, args);

        // Add the function call to history
        this.history.push({
            role: "model",
            parts: [{ functionCall: { name, args } }]
        });

        // Execute the function
        let result;
        try {
            result = await this._executeFunction(name, args || {});
        } catch (error) {
            result = { status: 'error', message: error.message };
        }

        console.log(`📤 Function result:`, result);

        // Add function response to history
        this.history.push({
            role: "function",
            parts: [{
                functionResponse: {
                    name: name,
                    response: { content: result }
                }
            }]
        });

        // Get final response from Gemini
        return await this._callGemini();
    }

    async _executeFunction(name, args) {
        switch (name) {
            case 'get_inventory_snapshot':
                return await sb.rpc('get_inventory_snapshot').then(r => r.data || r.error);

            case 'get_forecast':
                return await sb.rpc('get_forecast', args).then(r => r.data || r.error);

            case 'get_revenue_trend':
                const trendData = await sb.rpc('get_revenue_trend', args).then(r => r.data || []);
                if (!Array.isArray(trendData)) return trendData; // Return error or object if not array

                // Enhance with Item Counts
                const days = args.p_days || 30;
                const startDate = new Date();
                startDate.setDate(startDate.getDate() - days);

                const { data: sales } = await sb.from('sales_line_items')
                    .select('business_date, qty')
                    .gte('business_date', startDate.toISOString().split('T')[0]);

                if (sales) {
                    const qtyMap = {};
                    sales.forEach(s => {
                        const d = s.business_date.split('T')[0]; // Normalize
                        if (!qtyMap[d]) qtyMap[d] = 0;
                        qtyMap[d] += Number(s.qty || 0);
                    });

                    let totalTrendItems = 0;
                    let totalTrendOrders = 0;

                    trendData.forEach(day => {
                        // Normalize date from RPC if needed
                        const d = day.business_date.split('T')[0];
                        const qty = qtyMap[d] || 0;

                        day.total_items_sold = qty;
                        day.avg_items_per_order = day.order_count > 0 ? (qty / day.order_count).toFixed(2) : 0;

                        totalTrendItems += qty;
                        totalTrendOrders += day.order_count;
                    });

                    // Automatic Fallback: If < 5 orders OR 0 items (suspicious), try 3650 days (All Time)
                    const suspicious = totalTrendOrders < 5 || totalTrendItems === 0;
                    console.log(`[DEBUG] Orders: ${totalTrendOrders}, Items: ${totalTrendItems}, Suspicious: ${suspicious}`);

                    if (suspicious && (!args.p_days || args.p_days < 3650)) {
                        console.log("Stats low, retrying with 3650 days...");

                        // Recursive call (simulated) or just re-fetch
                        const fallbackDays = 3650;
                        const fallbackArgs = { ...args, p_days: fallbackDays };

                        // 1. Re-fetch RPC
                        const fallbackTrend = await sb.rpc('get_revenue_trend', fallbackArgs).then(r => r.data || []);
                        console.log(`[DEBUG] Fallback Trend Length: ${fallbackTrend.length}`);

                        if (Array.isArray(fallbackTrend) && fallbackTrend.length > 0) {
                            // 2. Re-fetch Sales
                            const fallbackStart = new Date();
                            fallbackStart.setDate(fallbackStart.getDate() - fallbackDays);

                            const { data: fallbackSales, error: fbError } = await sb.from('sales_line_items')
                                .select('business_date, qty')
                                .gte('business_date', fallbackStart.toISOString().split('T')[0]);

                            console.log(`[DEBUG] Fallback Sales: ${fallbackSales?.length}, Error: ${fbError?.message}`);

                            if (fallbackSales) {
                                const fbQtyMap = {};
                                fallbackSales.forEach(s => {
                                    const d = s.business_date.split('T')[0];
                                    if (!fbQtyMap[d]) fbQtyMap[d] = 0;
                                    fbQtyMap[d] += Number(s.qty || 0);
                                });

                                let fbItems = 0;
                                let fbOrders = 0;

                                fallbackTrend.forEach(day => {
                                    const d = day.business_date.split('T')[0];
                                    const qty = fbQtyMap[d] || 0;
                                    fbItems += qty;
                                    fbOrders += day.order_count;
                                });

                                // Return FALLBACK summary
                                return {
                                    trend: fallbackTrend, // Return COMPLETE trend
                                    summary: {
                                        total_orders: fbOrders,
                                        total_items: fbItems,
                                        avg_items_per_order: fbOrders > 0 ? (fbItems / fbOrders).toFixed(2) : 0,
                                        period_days: fallbackDays,
                                        note: `All-time (3650d): ${fbOrders} orders, ${fbItems} items. Sales Rows: ${fallbackSales?.length || 0}.`
                                    }
                                };
                            }
                        }
                    }

                    // Return object with summary
                    return {
                        trend: trendData,
                        summary: {
                            total_orders: totalTrendOrders,
                            total_items: totalTrendItems,
                            avg_items_per_order: totalTrendOrders > 0 ? (totalTrendItems / totalTrendOrders).toFixed(2) : 0,
                            period_days: days
                        }
                    };
                }

                return { trend: trendData, summary: null };

            case 'get_daily_analytics':
                return await sb.rpc('get_daily_analytics', args).then(r => r.data || r.error);

            case 'get_bom_for_item':
                return await sb.rpc('get_bom_for_item', args).then(r => r.data || r.error);

            case 'search_ingredient':
                const { data: ingredients } = await sb
                    .from('ingredients')
                    .select('id, name, unit')
                    .ilike('name', `%${args.ingredient_name}%`)
                    .limit(5);
                return ingredients || [];

            case 'search_menu_item':
                const { data: menuItems } = await sb
                    .from('menu_items')
                    .select('id, name, category')
                    .ilike('name', `%${args.item_name}%`)
                    .limit(5);
                return menuItems || [];

            case 'receive_inventory':
                return await sb.rpc('receive_inventory', args).then(r => r.data || r.error);

            case 'count_inventory':
                return await sb.rpc('count_inventory', args).then(r => r.data || r.error);

            case 'generate_forecast':
                return await sb.rpc('generate_forecast', args).then(r => r.data || r.error);

            case 'predict_revenue':
                // 1. Fetch all sales data (matching dashboard source of truth)
                const allSales = await fetchAllGeneric('sales_line_items', 'business_date, net_sales');

                if (!allSales || allSales.length === 0) {
                    return { error: "No sales data found to generate forecast." };
                }

                // 2. Aggregate by date
                const salesByDate = {};
                allSales.forEach(row => {
                    const date = row.business_date;
                    if (!salesByDate[date]) salesByDate[date] = 0;
                    salesByDate[date] += (row.net_sales || 0);
                });

                // 3. Convert to array and sort
                const history = Object.keys(salesByDate)
                    .map(date => ({ date, revenue: salesByDate[date] }))
                    .sort((a, b) => a.date.localeCompare(b.date));

                // Need at least a few data points
                if (history.length < 5) return { error: "Not enough historical data points to generate a forecast." };

                // 4. Linear Regression
                const n = history.length;
                let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;

                // Use last 90 days max to keep trend relevant
                const recentHistory = history.slice(-90);
                const m = recentHistory.length;

                recentHistory.forEach((day, index) => {
                    const x = index;
                    const y = day.revenue;
                    sumX += x;
                    sumY += y;
                    sumXY += (x * y);
                    sumXX += (x * x);
                });

                const slope = (m * sumXY - sumX * sumY) / (m * sumXX - sumX * sumX);
                const intercept = (sumY - slope * sumX) / m;

                const daysAhead = args.days_ahead || 7;
                const predictions = [];
                // Start predicting from the day AFTER the last data point
                const lastDateStr = recentHistory[recentHistory.length - 1].date;
                let runningDate = new Date(lastDateStr);

                for (let i = 1; i <= daysAhead; i++) {
                    const x = m - 1 + i; // Predict next x
                    const predictedRevenue = Math.max(0, slope * x + intercept);

                    runningDate.setDate(runningDate.getDate() + 1);
                    predictions.push({
                        date: runningDate.toISOString().split('T')[0],
                        predicted_revenue: Math.round(predictedRevenue)
                    });
                }

                const trend = slope > 10 ? "increasing" : slope < -10 ? "decreasing" : "stable";
                const slopeStr = Math.abs(Math.round(slope));

                return {
                    summary: `Forecast based on ${m} days of history. Revenue trend is ${trend} (~$${slopeStr}/day).`,
                    predictions: predictions
                };

            case 'upsert_bom_entry':
                return await sb.rpc('upsert_bom_entry', args).then(r => r.data || r.error);

            case 'get_top_selling_items':
                // Fetch sales with menu item details
                const saleItems = await fetchAllGeneric('sales_line_items', 'menu_item_id, qty, net_sales, menu_items(name, category)');

                // Aggregate
                const itemMap = {};
                saleItems.forEach(r => {
                    const id = r.menu_item_id;
                    if (!itemMap[id]) {
                        itemMap[id] = {
                            name: r.menu_items?.name || 'Unknown',
                            category: r.menu_items?.category || '',
                            total_qty: 0,
                            total_sales: 0
                        };
                    }
                    itemMap[id].total_qty += r.qty;
                    itemMap[id].total_sales += r.net_sales;
                });

                // Convert to array
                let topItems = Object.values(itemMap);

                // Filter out test items before sorting
                topItems = topItems.filter(i =>
                    !i.name.startsWith('__') &&
                    !(i.category && i.category.toLowerCase().includes('test'))
                );

                if (args.sort === 'asc') {
                    topItems.sort((a, b) => a.total_qty - b.total_qty);
                } else {
                    topItems.sort((a, b) => b.total_qty - a.total_qty);
                }

                // Collect available categories for hint
                const availableCategories = [...new Set(topItems.map(i => i.category).filter(Boolean))];

                // Filter (optional)
                if (args.category) {
                    const catLower = args.category.toLowerCase();
                    // Fuzzy match: check if category *includes* the search term OR is included IN the search term
                    const filtered = topItems.filter(i =>
                        i.category && (
                            i.category.toLowerCase().includes(catLower) ||
                            catLower.includes(i.category.toLowerCase())
                        )
                    );

                    if (filtered.length === 0) {
                        return {
                            info: `No items found matching category '${args.category}'.`,
                            available_categories: availableCategories.slice(0, 10)
                        };
                    }
                    topItems = filtered;
                }

                return topItems.slice(0, args.limit || 5);

            case 'get_menu_items_by_ingredient':
                // 1. Search ingredient
                const { data: ings } = await sb.from('ingredients').select('id, name').ilike('name', `%${args.ingredient_name}%`).limit(1);

                if (!ings || ings.length === 0) {
                    return { error: `Ingredient '${args.ingredient_name}' not found.` };
                }

                const ingId = ings[0].id;
                const ingName = ings[0].name;

                // 2. Query join table (assuming 'menu_item_ingredients')
                const { data: links, error: linkError } = await sb
                    .from('menu_item_ingredients')
                    .select('menu_item_id')
                    .eq('ingredient_id', ingId);

                if (linkError) {
                    return { error: "Database error: Could not access recipe data (menu_item_ingredients table missing?)." };
                }

                if (!links || links.length === 0) {
                    return { info: `No menu items found using ${ingName}.` };
                }

                const itemIds = links.map(l => l.menu_item_id);

                // 3. Get item details
                const { data: items } = await sb
                    .from('menu_items')
                    .select('name, category')
                    .in('id', itemIds);

                return {
                    ingredient: ingName,
                    used_in: items.map(i => `${i.name} (${i.category})`)
                };

            default:
                return { error: `Unknown function: ${name}` };
        }
    }

    clearHistory() {
        this.history = [];
        this.pendingAction = null;
    }
}

// ─── Helpers ───────────────────────────────────────────────────

async function fetchAllGeneric(tableName, selectColumns) {
    const PAGE_SIZE = 1000;
    let allData = [];
    let from = 0;

    while (true) {
        const { data, error } = await sb
            .from(tableName)
            .select(selectColumns)
            .range(from, from + PAGE_SIZE - 1);

        if (error) throw error;
        const batch = data || [];
        allData = allData.concat(batch);

        if (batch.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
    }
    return allData;
}

// Export singleton instance (wrapped in try-catch)
let geminiChat;
try {
    geminiChat = new GeminiChat();
} catch (e) {
    console.warn('GeminiChat init failed:', e);
    geminiChat = null;
}

