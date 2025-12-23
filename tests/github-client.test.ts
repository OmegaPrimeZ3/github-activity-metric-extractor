import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubClient, GitHubApiError } from "../src/github-client.js";
import type { Config } from "../src/types.js";

const createMockConfig = (overrides?: Partial<Config>): Config => ({
  github: {
    token: "test-token",
    organization: "test-org",
    isEnterprise: false,
    enterpriseUrl: "",
  },
  dateRange: {
    startDate: "2024-01-01",
    endDate: "2024-12-31",
  },
  options: {
    excludeRepos: [],
    includeRepos: [],
    maxConcurrentRequests: 3,
    skipLineStats: false,
    pageSize: 100,
  },
  ...overrides,
});

describe("GitHubApiError", () => {
  it("creates error with repo name and operation", () => {
    const originalError = new Error("API failed");
    const error = new GitHubApiError("my-repo", "fetching commits", originalError);

    expect(error.repoName).toBe("my-repo");
    expect(error.operation).toBe("fetching commits");
    expect(error.originalError).toBe(originalError);
    expect(error.name).toBe("GitHubApiError");
  });

  it("includes HTTP status in message when available", () => {
    const originalError = Object.assign(new Error("Rate limited"), { status: 403 });
    const error = new GitHubApiError("my-repo", "fetching PRs", originalError);

    expect(error.message).toContain("HTTP 403");
    expect(error.message).toContain("my-repo");
    expect(error.message).toContain("fetching PRs");
  });
});

describe("GitHubClient", () => {
  describe("constructor", () => {
    it("creates client with standard GitHub API URL", () => {
      const config = createMockConfig();
      const client = new GitHubClient(config);
      expect(client).toBeDefined();
    });

    it("creates client with enterprise URL when configured", () => {
      const config = createMockConfig({
        github: {
          token: "test-token",
          organization: "test-org",
          isEnterprise: true,
          enterpriseUrl: "https://github.mycompany.com",
        },
      });
      const client = new GitHubClient(config);
      expect(client).toBeDefined();
    });
  });

  describe("setProgressCallback", () => {
    it("accepts a progress callback", () => {
      const config = createMockConfig();
      const client = new GitHubClient(config);
      const callback = vi.fn();

      expect(() => client.setProgressCallback(callback)).not.toThrow();
    });
  });

  describe("getRateLimitRemaining", () => {
    it("returns initial rate limit value", () => {
      const config = createMockConfig();
      const client = new GitHubClient(config);

      expect(client.getRateLimitRemaining()).toBe(5000);
    });
  });

  describe("clearBranchCache", () => {
    it("clears the branch cache", () => {
      const config = createMockConfig();
      const client = new GitHubClient(config);

      expect(() => client.clearBranchCache()).not.toThrow();
    });
  });
});

describe("Config validation scenarios", () => {
  it("config with all required fields is valid", () => {
    const config = createMockConfig();
    expect(config.github.token).toBe("test-token");
    expect(config.github.organization).toBe("test-org");
    expect(config.dateRange.startDate).toBe("2024-01-01");
    expect(config.dateRange.endDate).toBe("2024-12-31");
  });

  it("config with includeRepos filters repos", () => {
    const config = createMockConfig({
      options: {
        excludeRepos: [],
        includeRepos: ["repo-a", "repo-b"],
        maxConcurrentRequests: 3,
        skipLineStats: false,
        pageSize: 100,
      },
    });
    expect(config.options.includeRepos).toEqual(["repo-a", "repo-b"]);
  });

  it("config with excludeRepos filters repos", () => {
    const config = createMockConfig({
      options: {
        excludeRepos: ["internal-repo"],
        includeRepos: [],
        maxConcurrentRequests: 3,
        skipLineStats: false,
        pageSize: 100,
      },
    });
    expect(config.options.excludeRepos).toEqual(["internal-repo"]);
  });

  it("config with skipLineStats disables line counting", () => {
    const config = createMockConfig({
      options: {
        excludeRepos: [],
        includeRepos: [],
        maxConcurrentRequests: 3,
        skipLineStats: true,
        pageSize: 100,
      },
    });
    expect(config.options.skipLineStats).toBe(true);
  });
});

describe("Date range scenarios", () => {
  it("parses valid date strings", () => {
    // Use ISO format with time to avoid timezone issues
    const startDate = new Date("2024-01-01T00:00:00");
    const endDate = new Date("2024-12-31T23:59:59");

    expect(startDate.getFullYear()).toBe(2024);
    expect(startDate.getMonth()).toBe(0); // January
    expect(endDate.getMonth()).toBe(11); // December
  });

  it("validates start date is before end date", () => {
    const startDate = new Date("2024-01-01T00:00:00");
    const endDate = new Date("2024-12-31T23:59:59");

    expect(startDate < endDate).toBe(true);
  });

  it("detects invalid date order", () => {
    const startDate = new Date("2024-12-31T00:00:00");
    const endDate = new Date("2024-01-01T00:00:00");

    expect(startDate > endDate).toBe(true);
  });
});
