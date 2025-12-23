import { describe, it, expect } from "vitest";
import {
  formatNumber,
  formatAsJson,
  formatAsCsv,
  formatAsMarkdown,
  formatUserStatsAsJson,
  formatUserStatsAsCsv,
  formatComparisonAsJson,
} from "../src/formatters.js";
import type { TotalStats, OutputOptions, UserStats, ComparisonStats } from "../src/types.js";

const mockRepoStats = [
  {
    name: "repo-alpha",
    isArchived: false,
    commits: 150,
    linesAdded: 5000,
    linesDeleted: 2000,
    totalLines: 3000,
    pullRequests: 25,
    contributors: 5,
    contributorsList: ["user1", "user2", "user3", "user4", "user5"],
    issuesCreated: 10,
    issuesClosed: 8,
    releases: 3,
  },
  {
    name: "repo-beta",
    isArchived: false,
    commits: 80,
    linesAdded: 3000,
    linesDeleted: 1500,
    totalLines: 1500,
    pullRequests: 15,
    contributors: 3,
    contributorsList: ["user1", "user2", "user6"],
    issuesCreated: 5,
    issuesClosed: 4,
    releases: 2,
  },
  {
    name: "repo-archived",
    isArchived: true,
    commits: 20,
    linesAdded: 500,
    linesDeleted: 100,
    totalLines: 400,
    pullRequests: 5,
    contributors: 2,
    contributorsList: ["user1", "user7"],
    issuesCreated: 2,
    issuesClosed: 2,
    releases: 1,
  },
];

const mockTotalStats: TotalStats = {
  repos: mockRepoStats,
  totals: {
    commits: 250,
    linesAdded: 8500,
    linesDeleted: 3600,
    totalLines: 4900,
    pullRequests: 45,
    contributors: 7,
    issuesCreated: 17,
    issuesClosed: 14,
    releases: 6,
    repoCount: 3,
  },
};

describe("formatNumber", () => {
  it("formats numbers with thousand separators", () => {
    expect(formatNumber(1000)).toBe("1,000");
    expect(formatNumber(1000000)).toBe("1,000,000");
  });

  it("handles small numbers", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(999)).toBe("999");
  });

  it("handles negative numbers", () => {
    expect(formatNumber(-1000)).toBe("-1,000");
  });
});

describe("formatAsJson", () => {
  const options: OutputOptions = {
    format: "json",
    skipLineStats: false,
  };

  it("returns valid JSON", () => {
    const result = formatAsJson(mockTotalStats, "2024-01-01", "2024-12-31", options);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it("includes metadata", () => {
    const result = JSON.parse(formatAsJson(mockTotalStats, "2024-01-01", "2024-12-31", options));
    expect(result.metadata).toBeDefined();
    expect(result.metadata.dateRange.startDate).toBe("2024-01-01");
    expect(result.metadata.dateRange.endDate).toBe("2024-12-31");
    expect(result.metadata.repositoryCount).toBe(3);
    expect(result.metadata.activeCount).toBe(2);
    expect(result.metadata.archivedCount).toBe(1);
  });

  it("includes totals", () => {
    const result = JSON.parse(formatAsJson(mockTotalStats, "2024-01-01", "2024-12-31", options));
    expect(result.totals.commits).toBe(250);
    expect(result.totals.linesAdded).toBe(8500);
    expect(result.totals.pullRequests).toBe(45);
  });

  it("includes all repositories", () => {
    const result = JSON.parse(formatAsJson(mockTotalStats, "2024-01-01", "2024-12-31", options));
    expect(result.repositories).toHaveLength(3);
    expect(result.repositories[0].name).toBe("repo-alpha");
  });

  it("sets line stats to null when skipLineStats is true", () => {
    const skipOptions: OutputOptions = { format: "json", skipLineStats: true };
    const result = JSON.parse(formatAsJson(mockTotalStats, "2024-01-01", "2024-12-31", skipOptions));
    expect(result.totals.linesAdded).toBeNull();
    expect(result.totals.linesDeleted).toBeNull();
    expect(result.repositories[0].linesAdded).toBeNull();
  });
});

describe("formatAsCsv", () => {
  const options: OutputOptions = {
    format: "csv",
    skipLineStats: false,
  };

  it("includes header row", () => {
    const result = formatAsCsv(mockTotalStats, "2024-01-01", "2024-12-31", options);
    const lines = result.split("\n");
    const headerLine = lines.find((l) => l.startsWith("Repository,"));
    expect(headerLine).toBeDefined();
    expect(headerLine).toContain("Commits");
    expect(headerLine).toContain("Lines Added");
    expect(headerLine).toContain("Pull Requests");
  });

  it("includes data rows for each repo", () => {
    const result = formatAsCsv(mockTotalStats, "2024-01-01", "2024-12-31", options);
    expect(result).toContain("repo-alpha");
    expect(result).toContain("repo-beta");
    expect(result).toContain("repo-archived");
  });

  it("includes totals row", () => {
    const result = formatAsCsv(mockTotalStats, "2024-01-01", "2024-12-31", options);
    expect(result).toContain("TOTALS");
  });

  it("excludes line stats columns when skipLineStats is true", () => {
    const skipOptions: OutputOptions = { format: "csv", skipLineStats: true };
    const result = formatAsCsv(mockTotalStats, "2024-01-01", "2024-12-31", skipOptions);
    expect(result).not.toContain("Lines Added");
    expect(result).not.toContain("Lines Deleted");
  });

  it("escapes fields with commas", () => {
    const statsWithComma: TotalStats = {
      ...mockTotalStats,
      repos: [
        {
          ...mockRepoStats[0],
          name: "repo,with,commas",
        },
      ],
    };
    const result = formatAsCsv(statsWithComma, "2024-01-01", "2024-12-31", options);
    expect(result).toContain('"repo,with,commas"');
  });
});

describe("formatAsMarkdown", () => {
  const options: OutputOptions = {
    format: "markdown",
    skipLineStats: false,
  };

  it("includes title header", () => {
    const result = formatAsMarkdown(mockTotalStats, "2024-01-01", "2024-12-31", options);
    expect(result).toContain("# GitHub Activity Metric Report");
  });

  it("includes date range", () => {
    const result = formatAsMarkdown(mockTotalStats, "2024-01-01", "2024-12-31", options);
    expect(result).toContain("2024-01-01 to 2024-12-31");
  });

  it("includes summary section", () => {
    const result = formatAsMarkdown(mockTotalStats, "2024-01-01", "2024-12-31", options);
    expect(result).toContain("## Summary");
    expect(result).toContain("Total Commits");
  });

  it("includes repository breakdown table", () => {
    const result = formatAsMarkdown(mockTotalStats, "2024-01-01", "2024-12-31", options);
    expect(result).toContain("## Repository Breakdown");
    expect(result).toContain("| Repository |");
    expect(result).toContain("| repo-alpha |");
  });

  it("marks archived repos", () => {
    const result = formatAsMarkdown(mockTotalStats, "2024-01-01", "2024-12-31", options);
    expect(result).toContain("*(archived)*");
  });

  it("excludes line stats when skipLineStats is true", () => {
    const skipOptions: OutputOptions = { format: "markdown", skipLineStats: true };
    const result = formatAsMarkdown(mockTotalStats, "2024-01-01", "2024-12-31", skipOptions);
    expect(result).not.toContain("Lines +");
    expect(result).not.toContain("Lines -");
  });
});

describe("formatUserStatsAsJson", () => {
  const mockUsers: UserStats[] = [
    {
      username: "user1",
      commits: 100,
      linesAdded: 5000,
      linesDeleted: 2000,
      pullRequests: 20,
      repos: ["repo-alpha", "repo-beta", "repo-archived"],
    },
    {
      username: "user2",
      commits: 50,
      linesAdded: 2000,
      linesDeleted: 1000,
      pullRequests: 10,
      repos: ["repo-alpha", "repo-beta"],
    },
  ];

  it("returns valid JSON", () => {
    const result = formatUserStatsAsJson(mockUsers, "2024-01-01", "2024-12-31");
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it("includes metadata", () => {
    const result = JSON.parse(formatUserStatsAsJson(mockUsers, "2024-01-01", "2024-12-31"));
    expect(result.metadata.userCount).toBe(2);
    expect(result.metadata.dateRange.startDate).toBe("2024-01-01");
  });

  it("sorts users by commits descending", () => {
    const result = JSON.parse(formatUserStatsAsJson(mockUsers, "2024-01-01", "2024-12-31"));
    expect(result.users[0].username).toBe("user1");
    expect(result.users[1].username).toBe("user2");
  });
});

describe("formatUserStatsAsCsv", () => {
  const mockUsers: UserStats[] = [
    {
      username: "user1",
      commits: 100,
      linesAdded: 5000,
      linesDeleted: 2000,
      pullRequests: 20,
      repos: ["repo-alpha", "repo-beta"],
    },
  ];

  it("includes header row", () => {
    const result = formatUserStatsAsCsv(mockUsers);
    expect(result).toContain("Username,Commits,Lines Added");
  });

  it("includes user data", () => {
    const result = formatUserStatsAsCsv(mockUsers);
    expect(result).toContain("user1,100,5000,2000,20");
  });
});

describe("formatComparisonAsJson", () => {
  const mockComparison: ComparisonStats = {
    period1: mockTotalStats,
    period2: {
      ...mockTotalStats,
      totals: {
        ...mockTotalStats.totals,
        commits: 300,
        pullRequests: 60,
      },
    },
    period1Range: { start: "2024-01-01", end: "2024-06-30" },
    period2Range: { start: "2024-07-01", end: "2024-12-31" },
  };

  it("returns valid JSON", () => {
    const result = formatComparisonAsJson(mockComparison);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it("includes both periods", () => {
    const result = JSON.parse(formatComparisonAsJson(mockComparison));
    expect(result.period1).toBeDefined();
    expect(result.period2).toBeDefined();
  });

  it("calculates changes correctly", () => {
    const result = JSON.parse(formatComparisonAsJson(mockComparison));
    expect(result.changes.commits.absolute).toBe(50); // 300 - 250
    expect(result.changes.commits.percentage).toBe(20); // (50/250) * 100
  });

  it("includes date ranges", () => {
    const result = JSON.parse(formatComparisonAsJson(mockComparison));
    expect(result.period1.range.start).toBe("2024-01-01");
    expect(result.period2.range.end).toBe("2024-12-31");
  });
});
