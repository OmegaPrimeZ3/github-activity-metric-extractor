export type OutputFormat = "table" | "json" | "csv" | "markdown";

export interface Config {
  github: {
    token: string;
    organization: string;
    isEnterprise: boolean;
    enterpriseUrl: string;
  };
  dateRange: {
    startDate: string;
    endDate: string;
  };
  options: {
    excludeRepos: string[];
    includeRepos: string[];
    maxConcurrentRequests: number;
    skipLineStats: boolean;
    pageSize: number;
  };
}

export interface OutputOptions {
  format: OutputFormat;
  outputFile?: string;
  skipLineStats: boolean;
}

export interface UserStats {
  username: string;
  commits: number;
  linesAdded: number;
  linesDeleted: number;
  pullRequests: number;
  repos: string[];
}

export interface ComparisonStats {
  period1: TotalStats;
  period2: TotalStats;
  period1Range: { start: string; end: string };
  period2Range: { start: string; end: string };
}

export interface RepoInfo {
  name: string;
  isArchived: boolean;
}

export interface RepoStats {
  name: string;
  isArchived: boolean;
  commits: number;
  linesAdded: number;
  linesDeleted: number;
  totalLines: number;
  pullRequests: number;
  contributors: number;
  contributorsList: string[];
  issuesCreated: number;
  issuesClosed: number;
  releases: number;
}

export interface TotalStats {
  repos: RepoStats[];
  totals: {
    commits: number;
    linesAdded: number;
    linesDeleted: number;
    totalLines: number;
    pullRequests: number;
    contributors: number;
    issuesCreated: number;
    issuesClosed: number;
    releases: number;
    repoCount: number;
  };
}
