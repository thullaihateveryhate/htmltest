afterEach(() => {
  if (global.__COPILOT_TEST_ENV__) {
    global.__COPILOT_TEST_ENV__.clear();
  }

  jest.restoreAllMocks();
});
