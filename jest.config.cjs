module.exports = {
  testEnvironment: "node",
  transform: {
    "^.+\\.ts$": "<rootDir>/tests/helpers/jest-ts-transform.cjs",
  },
  moduleFileExtensions: ["js", "cjs", "json", "ts"],
  setupFiles: ["<rootDir>/tests/copilot/jest.globals.cjs"],
  setupFilesAfterEnv: ["<rootDir>/tests/copilot/jest.after-env.cjs"],
  modulePathIgnorePatterns: ["<rootDir>/Untitled/"],
  testPathIgnorePatterns: ["<rootDir>/Untitled/"],
};
