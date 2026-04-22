(function initStockdDatabase(globalScope) {
  function toSafeString(value) {
    if (value === null || value === undefined) {
      return "";
    }

    return typeof value === "string" ? value : String(value);
  }

  function toNumber(value, fallback = 0) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    const parsed = Number(toSafeString(value).trim());
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function toDateKey(value) {
    const raw = toSafeString(value).trim();
    if (!raw) {
      return null;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return raw;
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed.toISOString().slice(0, 10);
  }

  function addDays(dateKey, days) {
    const safeDateKey = toDateKey(dateKey);
    if (!safeDateKey) {
      return null;
    }

    const date = new Date(`${safeDateKey}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function shouldExcludeMenuEntry(name, category) {
    const safeName = toSafeString(name).trim().toLowerCase();
    const safeCategory = toSafeString(category).trim().toLowerCase();
    return safeName.startsWith("__") || safeCategory.includes("test");
  }

  function buildSalesTrend(rows) {
    const byDate = new Map();

    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const businessDate = toDateKey(row && row.business_date);
      if (!businessDate) {
        return;
      }

      if (!byDate.has(businessDate)) {
        byDate.set(businessDate, {
          date: businessDate,
          revenue: 0,
          orders: 0,
        });
      }

      const current = byDate.get(businessDate);
      current.revenue += toNumber(row && row.net_sales);
      current.orders += toNumber(row && row.qty);
    });

    return Array.from(byDate.values()).sort((left, right) => left.date.localeCompare(right.date));
  }

  function buildTopSellerStats(rows, options = {}) {
    const settings = options || {};
    const limit = typeof settings.limit === "number" ? settings.limit : null;
    const excludeTests = settings.excludeTests !== false;
    const itemMap = new Map();

    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const menuItemId = toSafeString(row && row.menu_item_id).trim();
      if (!menuItemId) {
        return;
      }

      const embeddedItem = row && typeof row.menu_items === "object" ? row.menu_items : null;
      const name = toSafeString(embeddedItem && embeddedItem.name).trim() || "Unknown";
      const category = toSafeString(embeddedItem && embeddedItem.category).trim();

      if (excludeTests && shouldExcludeMenuEntry(name, category)) {
        return;
      }

      if (!itemMap.has(menuItemId)) {
        itemMap.set(menuItemId, {
          id: menuItemId,
          name,
          category,
          totalQty: 0,
          totalSales: 0,
        });
      }

      const current = itemMap.get(menuItemId);
      current.totalQty += toNumber(row && row.qty);
      current.totalSales += toNumber(row && row.net_sales);
    });

    const results = Array.from(itemMap.values())
      .map((item) => ({
        ...item,
        avgUnitPrice: item.totalQty > 0
          ? Number((item.totalSales / item.totalQty).toFixed(2))
          : 0,
      }))
      .sort((left, right) => right.totalQty - left.totalQty);

    return limit === null ? results : results.slice(0, limit);
  }

  function buildCategoryStats(rows, options = {}) {
    const settings = options || {};
    const excludeTests = settings.excludeTests !== false;
    const categoryMap = new Map();

    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const embeddedItem = row && typeof row.menu_items === "object" ? row.menu_items : null;
      const name = toSafeString(embeddedItem && embeddedItem.name).trim() || "Unknown";
      const category = toSafeString(embeddedItem && embeddedItem.category).trim() || "Other";

      if (excludeTests && shouldExcludeMenuEntry(name, category)) {
        return;
      }

      if (!categoryMap.has(category)) {
        categoryMap.set(category, {
          name: category,
          sales: 0,
          qty: 0,
        });
      }

      const current = categoryMap.get(category);
      current.sales += toNumber(row && row.net_sales);
      current.qty += toNumber(row && row.qty);
    });

    return Array.from(categoryMap.values()).sort((left, right) => right.sales - left.sales);
  }

  function buildRecentSalesDays(rows, options = {}) {
    const settings = options || {};
    const limit = typeof settings.limit === "number" ? settings.limit : null;
    const maxDate = toDateKey(settings.maxDate);
    const byDate = new Map();

    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const businessDate = toDateKey(row && row.business_date);
      const menuItemId = toSafeString(row && row.menu_item_id).trim();
      if (!businessDate || !menuItemId) {
        return;
      }

      if (maxDate && businessDate > maxDate) {
        return;
      }

      if (!byDate.has(businessDate)) {
        byDate.set(businessDate, {
          date: businessDate,
          qty: 0,
          sales: 0,
          itemIds: new Set(),
        });
      }

      const current = byDate.get(businessDate);
      current.qty += toNumber(row && row.qty);
      current.sales += toNumber(row && row.net_sales);
      current.itemIds.add(menuItemId);
    });

    const results = Array.from(byDate.values())
      .map((entry) => ({
        date: entry.date,
        qty: Number(entry.qty.toFixed(2)),
        sales: Number(entry.sales.toFixed(2)),
        itemCount: entry.itemIds.size,
      }))
      .sort((left, right) => right.date.localeCompare(left.date));

    return limit === null ? results : results.slice(0, limit);
  }

  function buildDashboardForecastData(input = {}) {
    const forecastRows = Array.isArray(input.forecastRows) ? input.forecastRows : [];
    const salesRows = Array.isArray(input.salesRows) ? input.salesRows : [];
    const referenceDate = toDateKey(input.referenceDate) || toDateKey(new Date()) || null;
    const tomorrowDate = referenceDate ? addDays(referenceDate, 1) : null;

    const salesByItem = new Map();
    let latestSalesDate = null;

    salesRows.forEach((row) => {
      const menuItemId = toSafeString(row && row.menu_item_id).trim();
      const businessDate = toDateKey(row && row.business_date);
      const embeddedItem = row && typeof row.menu_items === "object" ? row.menu_items : null;

      if (!menuItemId || !businessDate) {
        return;
      }

      if (!latestSalesDate || businessDate > latestSalesDate) {
        latestSalesDate = businessDate;
      }

      if (!salesByItem.has(menuItemId)) {
        salesByItem.set(menuItemId, {
          menu_item_id: menuItemId,
          name: toSafeString(embeddedItem && embeddedItem.name).trim() || "Unknown",
          category: toSafeString(embeddedItem && embeddedItem.category).trim(),
          totalQty: 0,
          totalSales: 0,
          saleDates: new Set(),
        });
      }

      const current = salesByItem.get(menuItemId);
      current.totalQty += toNumber(row && row.qty);
      current.totalSales += toNumber(row && row.net_sales);
      current.saleDates.add(businessDate);
    });

    const forecastByDate = new Map();
    const menuItems = [];

    forecastRows.forEach((row) => {
      const forecastDate = toDateKey(row && row.forecast_date);
      const menuItemId = toSafeString(row && row.menu_item_id).trim();
      const qty = toNumber(row && row.qty);
      const embeddedItem = row && typeof row.menu_items === "object" ? row.menu_items : null;
      const salesEntry = salesByItem.get(menuItemId);
      const name = toSafeString((embeddedItem && embeddedItem.name) || (salesEntry && salesEntry.name)).trim() || "Unknown";
      const category = toSafeString((embeddedItem && embeddedItem.category) || (salesEntry && salesEntry.category)).trim();

      if (!forecastDate || !menuItemId) {
        return;
      }

      const totalQty = salesEntry ? salesEntry.totalQty : 0;
      const totalSales = salesEntry ? salesEntry.totalSales : 0;
      const saleDays = salesEntry ? salesEntry.saleDates.size : 0;
      const avgUnitPrice = totalQty > 0 ? totalSales / totalQty : 0;
      const avgDailySales = saleDays > 0 ? totalQty / saleDays : 0;

      if (!forecastByDate.has(forecastDate)) {
        forecastByDate.set(forecastDate, {
          date: forecastDate,
          revenue: 0,
        });
      }

      const forecastDay = forecastByDate.get(forecastDate);
      forecastDay.revenue += qty * avgUnitPrice;

      if (tomorrowDate && forecastDate === tomorrowDate) {
        menuItems.push({
          menu_item_id: menuItemId,
          forecast_date: forecastDate,
          name,
          category,
          price: Number(avgUnitPrice.toFixed(2)),
          avg_daily_sales: Number(avgDailySales.toFixed(2)),
          forecast_tomorrow: Number(qty.toFixed(2)),
          forecast_revenue: Number((qty * avgUnitPrice).toFixed(2)),
        });
      }
    });

    const dailyRevenue = Array.from(forecastByDate.values())
      .map((entry) => ({
        date: entry.date,
        revenue: Number(entry.revenue.toFixed(2)),
      }))
      .sort((left, right) => left.date.localeCompare(right.date));

    menuItems.sort((left, right) => {
      if (right.forecast_tomorrow !== left.forecast_tomorrow) {
        return right.forecast_tomorrow - left.forecast_tomorrow;
      }
      return left.name.localeCompare(right.name);
    });

    return {
      source: "forecast_items",
      reference_date: referenceDate,
      tomorrow_date: tomorrowDate,
      latest_sales_date: latestSalesDate,
      menu_items: menuItems,
      daily_revenue: dailyRevenue,
    };
  }

  function parseInventoryCountNote(note) {
    const match = toSafeString(note).match(
      /Physical count:\s*([+-]?\d+(?:\.\d+)?)\s*(?:→|->)\s*([+-]?\d+(?:\.\d+)?)(.*)$/i,
    );

    if (!match) {
      return null;
    }

    return {
      previousQty: toNumber(match[1], null),
      actualQty: toNumber(match[2], null),
      suffix: toSafeString(match[3]).trim(),
    };
  }

  function getCountVariancePercent(previousQty, delta) {
    const safePrevious = toNumber(previousQty, null);
    const safeDelta = toNumber(delta, null);

    if (safePrevious === null || safeDelta === null) {
      return null;
    }

    if (safePrevious === 0) {
      return safeDelta === 0 ? 0 : null;
    }

    return Number(((Math.abs(safeDelta) / Math.abs(safePrevious)) * 100).toFixed(2));
  }

  function summarizeCountMetrics(rows) {
    const safeRows = Array.isArray(rows) ? rows : [];
    let accurateCount = 0;
    let varianceSampleCount = 0;
    let totalVariance = 0;
    let needsAttention = 0;
    let worstDiscrepancy = null;
    const perfectItems = new Set();

    safeRows.forEach((row) => {
      const delta = toNumber(row && row.qty_delta);
      const parsed = parseInventoryCountNote(row && row.note);
      const variance = parsed ? getCountVariancePercent(parsed.previousQty, delta) : null;
      const ingredientName = toSafeString(row && row.ingredients && row.ingredients.name).trim();

      if (variance !== null) {
        varianceSampleCount += 1;
        totalVariance += variance;

        if (variance <= 5) {
          accurateCount += 1;
        }

        if (variance > 10) {
          needsAttention += 1;
        }
      }

      if (delta === 0 && ingredientName) {
        perfectItems.add(ingredientName);
      }

      if (!worstDiscrepancy || Math.abs(delta) > Math.abs(toNumber(worstDiscrepancy.qty_delta))) {
        worstDiscrepancy = row;
      }
    });

    return {
      totalCounts: safeRows.length,
      accuracyRate: varianceSampleCount > 0
        ? Number(((accurateCount / varianceSampleCount) * 100).toFixed(1))
        : 0,
      avgDiscrepancy: varianceSampleCount > 0
        ? Number((totalVariance / varianceSampleCount).toFixed(1))
        : 0,
      needsAttention,
      varianceSampleCount,
      perfectItems: Array.from(perfectItems),
      lastCount: safeRows[0] || null,
      worstDiscrepancy,
    };
  }

  const api = {
    addDays,
    buildCategoryStats,
    buildDashboardForecastData,
    buildRecentSalesDays,
    buildSalesTrend,
    buildTopSellerStats,
    getCountVariancePercent,
    parseInventoryCountNote,
    summarizeCountMetrics,
    toDateKey,
    toNumber,
    toSafeString,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  globalScope.StockdDatabase = api;
})(typeof window !== "undefined" ? window : globalThis);
