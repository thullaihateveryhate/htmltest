const envStore = new Map();

global.__COPILOT_TEST_ENV__ = envStore;
global.Deno = {
  env: {
    get(name) {
      return envStore.has(name) ? envStore.get(name) : undefined;
    },
  },
};
