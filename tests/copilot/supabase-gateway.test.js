const { createSupabaseGateway } = require("../../supabase/functions/copilot/supabase.ts");
const {
  createAuth,
  createRuntimeEnv,
  installFetchMock,
  jsonResponse,
} = require("./helpers.js");

describe("copilot supabase gateway hardening", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("allows approved RPC calls", async () => {
    const fetchMock = installFetchMock(async (url) => {
      expect(url).toBe("https://stockd-test.supabase.co/rest/v1/rpc/get_inventory_snapshot");
      return jsonResponse([{ ingredient_id: "test-ingredient" }]);
    });

    const gateway = createSupabaseGateway(createRuntimeEnv(), createAuth());
    const result = await gateway.rpc("get_inventory_snapshot", {});

    expect(result).toEqual([{ ingredient_id: "test-ingredient" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("rejects disallowed RPC targets before fetch", async () => {
    const fetchMock = installFetchMock(async () => jsonResponse({}));
    const gateway = createSupabaseGateway(createRuntimeEnv(), createAuth());

    await expect(gateway.rpc("pg_sleep", {})).rejects.toMatchObject({
      code: "invalid_supabase_target",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rejects unsupported select tables, filters, and sort fields", async () => {
    const fetchMock = installFetchMock(async () => jsonResponse([]));
    const gateway = createSupabaseGateway(createRuntimeEnv(), createAuth());

    await expect(gateway.select("users", {
      select: "*",
    })).rejects.toMatchObject({ code: "invalid_supabase_target" });

    await expect(gateway.select("ingredients", {
      select: "id,name",
      filters: { created_at: "gte.2026-04-01" },
    })).rejects.toMatchObject({ code: "invalid_supabase_filter" });

    await expect(gateway.select("ingredients", {
      select: "id,name",
      order: "created_at.desc",
    })).rejects.toMatchObject({ code: "invalid_supabase_order" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("allows approved table access with approved filters and sort fields", async () => {
    const fetchMock = installFetchMock(async (url) => {
      expect(url).toContain("/rest/v1/ingredients?");
      expect(url).toContain("select=id%2Cname");
      expect(url).toContain("name=ilike.*moz*");
      expect(url).toContain("order=name.asc");
      expect(url).toContain("limit=5");
      return jsonResponse([{ id: "ingredient-1", name: "Mozzarella" }]);
    });

    const gateway = createSupabaseGateway(createRuntimeEnv(), createAuth());
    const result = await gateway.select("ingredients", {
      select: "id,name",
      filters: { name: "ilike.*moz*" },
      order: "name.asc",
      limit: 5,
    });

    expect(result).toEqual([{ id: "ingredient-1", name: "Mozzarella" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
