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
