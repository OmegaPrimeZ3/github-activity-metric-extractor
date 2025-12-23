import { Octokit } from "@octokit/rest";
import type { Config, RepoInfo, RepoStats } from "./types.js";

const GITHUB_STANDARD_API_URL = "https://api.github.com";
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

function getApiBaseUrl(config: Config): string {
  if (config.github.isEnterprise) {
    const enterpriseUrl = config.github.enterpriseUrl.replace(/\/$/, "");
    return `${enterpriseUrl}/api/v3`;
  }
  return GITHUB_STANDARD_API_URL;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Connection errors that are retryable
    if (
      message.includes("other side closed") ||
      message.includes("econnreset") ||
      message.includes("socket hang up") ||
      message.includes("etimedout") ||
      message.includes("enotfound") ||
      message.includes("network") ||
      message.includes("timeout")
    ) {
      return true;
    }
    // Rate limit errors
    if ("status" in error) {
      const status = (error as { status: number }).status;
      if (status === 403 || status === 429 || status === 502 || status === 503 || status === 504) {
        return true;
      }
    }
  }
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GitHubApiError extends Error {
  constructor(
    public readonly repoName: string,
    public readonly operation: string,
    public readonly originalError: Error
  ) {
    const statusInfo = "status" in originalError ? ` (HTTP ${(originalError as { status: number }).status})` : "";
    super(`[${repoName}] ${operation}: ${originalError.message}${statusInfo}`);
    this.name = "GitHubApiError";
  }
}

export type ProgressCallback = (repoName: string, task: string) => void;

export class GitHubClient {
  private octokit: Octokit;
  private config: Config;
  private repoBranchCache: Map<string, string> = new Map();
  private onProgress: ProgressCallback | null = null;
  private rateLimitRemaining: number = 5000;
  private rateLimitReset: number = 0;

  constructor(config: Config) {
    this.config = config;
    this.octokit = new Octokit({
      auth: config.github.token,
      baseUrl: getApiBaseUrl(config),
      request: {
        timeout: 30000, // 30 second timeout
      },
    });
  }

  setProgressCallback(callback: ProgressCallback): void {
    this.onProgress = callback;
  }

  private reportProgress(repoName: string, task: string): void {
    if (this.onProgress) {
      this.onProgress(repoName, task);
    }
  }

  // Check and update rate limit from response headers
  private updateRateLimit(headers: { "x-ratelimit-remaining"?: string; "x-ratelimit-reset"?: string }): void {
    if (headers["x-ratelimit-remaining"]) {
      this.rateLimitRemaining = parseInt(headers["x-ratelimit-remaining"], 10);
    }
    if (headers["x-ratelimit-reset"]) {
      this.rateLimitReset = parseInt(headers["x-ratelimit-reset"], 10);
    }
  }

  // Wait if we're running low on rate limit
  private async checkRateLimit(repoName: string): Promise<void> {
    if (this.rateLimitRemaining < 100) {
      const now = Math.floor(Date.now() / 1000);
      const waitSeconds = Math.max(0, this.rateLimitReset - now) + 5;
      if (waitSeconds > 0 && waitSeconds < 3600) {
        this.reportProgress(repoName, `rate limit low (${this.rateLimitRemaining} remaining), waiting ${waitSeconds}s...`);
        await sleep(waitSeconds * 1000);
      }
    }
  }

  getRateLimitRemaining(): number {
    return this.rateLimitRemaining;
  }

  clearBranchCache(): void {
    this.repoBranchCache.clear();
  }

  private async withRetry<T>(
    operation: () => Promise<T>,
    repoName: string,
    operationName: string
  ): Promise<T> {
    let lastError: unknown;

    await this.checkRateLimit(repoName);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await operation();
        // Update rate limit from response if available
        if (result && typeof result === "object" && "headers" in result) {
          this.updateRateLimit((result as { headers: Record<string, string> }).headers);
        }
        return result;
      } catch (error) {
        lastError = error;

        if (!isRetryableError(error) || attempt === MAX_RETRIES) {
          // Wrap the error with context before throwing
          if (error instanceof Error) {
            throw new GitHubApiError(repoName, operationName, error);
          }
          throw error;
        }

        // Check if it's a rate limit error (403 with rate limit message)
        let delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        if (error instanceof Error && "status" in error && (error as { status: number }).status === 403) {
          // Rate limited - wait longer
          delayMs = Math.max(delayMs, 60000); // At least 60 seconds
        }

        this.reportProgress(
          repoName,
          `${operationName} failed, retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt}/${MAX_RETRIES})...`
        );
        await sleep(delayMs);
      }
    }

    // Wrap the final error with context
    if (lastError instanceof Error) {
      throw new GitHubApiError(repoName, operationName, lastError);
    }
    throw lastError;
  }

  private async getDefaultBranch(repoName: string): Promise<string> {
    // Check cache first
    const cached = this.repoBranchCache.get(repoName);
    if (cached) return cached;

    // Fetch the repo metadata to get the default branch set in GitHub
    const response = await this.withRetry(
      () =>
        this.octokit.repos.get({
          owner: this.config.github.organization,
          repo: repoName,
        }),
      repoName,
      "fetching default branch"
    );

    this.updateRateLimit(response.headers as { "x-ratelimit-remaining"?: string; "x-ratelimit-reset"?: string });

    const defaultBranch = response.data.default_branch;
    this.repoBranchCache.set(repoName, defaultBranch);
    return defaultBranch;
  }

  private get pageSize(): number {
    return this.config.options.pageSize || 100;
  }

  async getOrgRepos(): Promise<RepoInfo[]> {
    const repos: RepoInfo[] = [];
    let page = 1;

    while (true) {
      const response = await this.withRetry(
        () =>
          this.octokit.repos.listForOrg({
            org: this.config.github.organization,
            per_page: this.pageSize,
            page,
            type: "all",
          }),
        this.config.github.organization,
        "fetching repositories"
      );

      if (response.data.length === 0) break;

      for (const repo of response.data) {
        const repoName = repo.name;

        // Apply include/exclude filters
        if (this.config.options.includeRepos.length > 0) {
          if (!this.config.options.includeRepos.includes(repoName)) continue;
        }
        if (this.config.options.excludeRepos.includes(repoName)) continue;

        repos.push({
          name: repoName,
          isArchived: repo.archived ?? false,
        });
      }

      if (response.data.length < this.pageSize) break;
      page++;
    }

    return repos;
  }

  async getCommitCount(repoName: string, branch?: string): Promise<number> {
    const { startDate, endDate } = this.config.dateRange;
    const targetBranch = branch ?? await this.getDefaultBranch(repoName);
    let count = 0;
    let page = 1;

    while (true) {
      try {
        this.reportProgress(repoName, `fetching commits (page ${page})...`);
        const response = await this.withRetry(
          () =>
            this.octokit.repos.listCommits({
              owner: this.config.github.organization,
              repo: repoName,
              sha: targetBranch,
              since: new Date(startDate).toISOString(),
              until: new Date(endDate + "T23:59:59").toISOString(),
              per_page: this.pageSize,
              page,
            }),
          repoName,
          "fetching commits"
        );

        count += response.data.length;

        if (response.data.length < this.pageSize) break;
        page++;
      } catch (error: unknown) {
        if (error instanceof Error && "status" in error && (error as { status: number }).status === 409) {
          // Empty repository
          return 0;
        }
        throw error;
      }
    }

    return count;
  }

  async getLinesOfCode(
    repoName: string,
    branch?: string
  ): Promise<{ added: number; deleted: number }> {
    // Skip if configured
    if (this.config.options.skipLineStats) {
      return { added: 0, deleted: 0 };
    }

    const { startDate, endDate } = this.config.dateRange;
    const targetBranch = branch ?? await this.getDefaultBranch(repoName);

    try {
      // Strategy: Compare the last commit before start date with the last commit in range
      // This gives us the total diff for the date range in just 2-3 API calls

      this.reportProgress(repoName, "finding commits for line stats...");

      // Get the last commit in the date range (or latest if none)
      const endCommitsResponse = await this.withRetry(
        () =>
          this.octokit.repos.listCommits({
            owner: this.config.github.organization,
            repo: repoName,
            sha: targetBranch,
            until: new Date(endDate + "T23:59:59").toISOString(),
            per_page: 1,
          }),
        repoName,
        "finding end commit"
      );

      if (endCommitsResponse.data.length === 0) {
        // No commits up to end date
        return { added: 0, deleted: 0 };
      }

      const endCommitSha = endCommitsResponse.data[0].sha;

      // Get the last commit BEFORE the start date (this is our baseline)
      const baseCommitsResponse = await this.withRetry(
        () =>
          this.octokit.repos.listCommits({
            owner: this.config.github.organization,
            repo: repoName,
            sha: targetBranch,
            until: new Date(new Date(startDate).getTime() - 1).toISOString(), // 1ms before start
            per_page: 1,
          }),
        repoName,
        "finding base commit"
      );

      // If there's no commit before start date, compare against the first commit's parent
      // or get stats for all commits up to end date
      let baseSha: string;

      if (baseCommitsResponse.data.length > 0) {
        baseSha = baseCommitsResponse.data[0].sha;
      } else {
        // No commits before start date - get the first commit in range and use its parent
        const firstCommitsResponse = await this.withRetry(
          () =>
            this.octokit.repos.listCommits({
              owner: this.config.github.organization,
              repo: repoName,
              sha: targetBranch,
              since: new Date(startDate).toISOString(),
              until: new Date(endDate + "T23:59:59").toISOString(),
              per_page: this.pageSize,
            }),
          repoName,
          "finding first commit"
        );

        if (firstCommitsResponse.data.length === 0) {
          return { added: 0, deleted: 0 };
        }

        // Get the oldest commit in the range (last in the array since it's sorted desc)
        const oldestCommit = firstCommitsResponse.data[firstCommitsResponse.data.length - 1];

        // Try to get its parent
        const commitDetail = await this.withRetry(
          () =>
            this.octokit.repos.getCommit({
              owner: this.config.github.organization,
              repo: repoName,
              ref: oldestCommit.sha,
            }),
          repoName,
          "getting commit parent"
        );

        if (commitDetail.data.parents && commitDetail.data.parents.length > 0) {
          baseSha = commitDetail.data.parents[0].sha;
        } else {
          // This is the initial commit - just return its stats
          return {
            added: commitDetail.data.stats?.additions ?? 0,
            deleted: commitDetail.data.stats?.deletions ?? 0,
          };
        }
      }

      // If base and end are the same, no changes in range
      if (baseSha === endCommitSha) {
        return { added: 0, deleted: 0 };
      }

      // Compare the two commits - this gives us the total diff
      this.reportProgress(repoName, "comparing commits for line stats...");

      const compareResponse = await this.withRetry(
        () =>
          this.octokit.repos.compareCommits({
            owner: this.config.github.organization,
            repo: repoName,
            base: baseSha,
            head: endCommitSha,
          }),
        repoName,
        "comparing commits"
      );

      // Sum up additions and deletions from all files in the diff
      let linesAdded = 0;
      let linesDeleted = 0;

      if (compareResponse.data.files) {
        for (const file of compareResponse.data.files) {
          linesAdded += file.additions ?? 0;
          linesDeleted += file.deletions ?? 0;
        }
      }

      return { added: linesAdded, deleted: linesDeleted };
    } catch (error: unknown) {
      if (error instanceof Error && "status" in error) {
        const status = (error as { status: number }).status;
        if (status === 409 || status === 404) {
          // Empty repository or commits not available
          return { added: 0, deleted: 0 };
        }
      }
      throw error;
    }
  }

  async getPullRequestCount(repoName: string, branch?: string): Promise<number> {
    const { startDate, endDate } = this.config.dateRange;
    const targetBranch = branch ?? await this.getDefaultBranch(repoName);
    const start = new Date(startDate);
    const end = new Date(endDate + "T23:59:59");
    let count = 0;
    let page = 1;

    while (true) {
      this.reportProgress(repoName, `fetching pull requests (page ${page}, found ${count})...`);
      const response = await this.withRetry(
        () =>
          this.octokit.pulls.list({
            owner: this.config.github.organization,
            repo: repoName,
            state: "all",
            base: targetBranch,
            per_page: this.pageSize,
            page,
            sort: "created",
            direction: "desc",
          }),
        repoName,
        "fetching pull requests"
      );

      if (response.data.length === 0) break;

      for (const pr of response.data) {
        const createdAt = new Date(pr.created_at);

        // Since sorted by created desc, if we're past the start date, we can stop
        if (createdAt < start) {
          return count;
        }

        if (createdAt >= start && createdAt <= end) {
          count++;
        }
      }

      if (response.data.length < this.pageSize) break;
      page++;
    }

    return count;
  }

  async getContributors(repoName: string, branch?: string): Promise<string[]> {
    const { startDate, endDate } = this.config.dateRange;
    const targetBranch = branch ?? await this.getDefaultBranch(repoName);
    const contributors = new Set<string>();
    let page = 1;

    while (true) {
      try {
        this.reportProgress(repoName, `fetching contributors (page ${page}, found ${contributors.size})...`);
        const response = await this.withRetry(
          () =>
            this.octokit.repos.listCommits({
              owner: this.config.github.organization,
              repo: repoName,
              sha: targetBranch,
              since: new Date(startDate).toISOString(),
              until: new Date(endDate + "T23:59:59").toISOString(),
              per_page: this.pageSize,
              page,
            }),
          repoName,
          "fetching contributors"
        );

        if (response.data.length === 0) break;

        for (const commit of response.data) {
          const author = commit.author?.login ?? commit.commit.author?.email;
          if (author) {
            contributors.add(author);
          }
        }

        if (response.data.length < this.pageSize) break;
        page++;
      } catch (error: unknown) {
        if (error instanceof Error && "status" in error && (error as { status: number }).status === 409) {
          return [];
        }
        throw error;
      }
    }

    return Array.from(contributors);
  }

  async getIssueStats(repoName: string): Promise<{ created: number; closed: number }> {
    const { startDate, endDate } = this.config.dateRange;
    const start = new Date(startDate);
    const end = new Date(endDate + "T23:59:59");
    let created = 0;
    let closed = 0;
    let page = 1;

    // Use 'since' parameter to only fetch issues updated after start date
    // This dramatically reduces API calls for repos with many old issues
    const sinceDate = new Date(startDate).toISOString();

    while (true) {
      this.reportProgress(repoName, `fetching issues (page ${page}, found ${created} created, ${closed} closed)...`);
      const response = await this.withRetry(
        () =>
          this.octokit.issues.listForRepo({
            owner: this.config.github.organization,
            repo: repoName,
            state: "all",
            since: sinceDate,
            per_page: this.pageSize,
            page,
            sort: "updated",
            direction: "desc",
          }),
        repoName,
        "fetching issues"
      );

      if (response.data.length === 0) break;

      for (const issue of response.data) {
        // Skip pull requests (they show up in issues API too)
        if (issue.pull_request) continue;

        // Count issues created in range
        const createdAt = new Date(issue.created_at);
        if (createdAt >= start && createdAt <= end) {
          created++;
        }

        // Count issues closed in range
        if (issue.closed_at) {
          const closedAt = new Date(issue.closed_at);
          if (closedAt >= start && closedAt <= end) {
            closed++;
          }
        }
      }

      if (response.data.length < this.pageSize) break;
      page++;
    }

    return { created, closed };
  }

  async getReleaseCount(repoName: string): Promise<number> {
    const { startDate, endDate } = this.config.dateRange;
    const start = new Date(startDate);
    const end = new Date(endDate + "T23:59:59");
    let count = 0;
    let page = 1;

    while (true) {
      try {
        this.reportProgress(repoName, `fetching releases (page ${page}, found ${count})...`);
        const response = await this.withRetry(
          () =>
            this.octokit.repos.listReleases({
              owner: this.config.github.organization,
              repo: repoName,
              per_page: this.pageSize,
              page,
            }),
          repoName,
          "fetching releases"
        );

        if (response.data.length === 0) break;

        for (const release of response.data) {
          const publishedAt = release.published_at
            ? new Date(release.published_at)
            : new Date(release.created_at);

          if (publishedAt >= start && publishedAt <= end) {
            count++;
          }

          // Releases are sorted by created_at desc, so we can stop early
          if (publishedAt < start) {
            return count;
          }
        }

        if (response.data.length < this.pageSize) break;
        page++;
      } catch {
        // Some repos may not have releases enabled
        return 0;
      }
    }

    return count;
  }

  async getRepoStats(repoInfo: RepoInfo): Promise<RepoStats> {
    const { name: repoName, isArchived } = repoInfo;

    // Helper to check if an error indicates an empty/missing repo
    const isEmptyRepoError = (error: unknown): boolean => {
      if (error instanceof GitHubApiError && "status" in error.originalError) {
        const status = (error.originalError as { status: number }).status;
        // 404 = not found, 409 = empty repository, 422 = validation failed (e.g., no commits)
        if (status === 404 || status === 409 || status === 422) {
          return true;
        }
      }
      if (error instanceof Error && "status" in error) {
        const status = (error as { status: number }).status;
        if (status === 404 || status === 409 || status === 422) {
          return true;
        }
      }
      return false;
    };

    // Helper to return zero stats for empty repos
    const emptyStats = (): RepoStats => ({
      name: repoName,
      isArchived,
      commits: 0,
      linesAdded: 0,
      linesDeleted: 0,
      totalLines: 0,
      pullRequests: 0,
      contributors: 0,
      contributorsList: [],
      issuesCreated: 0,
      issuesClosed: 0,
      releases: 0,
    });

    // Resolve the branch once for this repo
    this.reportProgress(repoName, isArchived ? "detecting branch (archived)..." : "detecting branch...");
    let branch: string;
    try {
      branch = await this.getDefaultBranch(repoName);
    } catch (error) {
      if (isEmptyRepoError(error)) {
        this.reportProgress(repoName, "empty repository");
        return emptyStats();
      }
      throw error;
    }

    // Helper to handle empty/missing repo errors gracefully - treat as zero/empty
    const safe = async <T>(fn: () => Promise<T>, defaultValue: T): Promise<T> => {
      try {
        return await fn();
      } catch (error) {
        if (isEmptyRepoError(error)) {
          return defaultValue;
        }
        throw error;
      }
    };

    // Fetch all stats in parallel for better performance
    this.reportProgress(repoName, "fetching stats...");
    const [commits, lines, pullRequests, contributorsList, releases] = await Promise.all([
      safe(() => this.getCommitCount(repoName, branch), 0),
      safe(() => this.getLinesOfCode(repoName, branch), { added: 0, deleted: 0 }),
      safe(() => this.getPullRequestCount(repoName, branch), 0),
      safe(() => this.getContributors(repoName, branch), []),
      safe(() => this.getReleaseCount(repoName), 0),
    ]);

    this.reportProgress(repoName, isArchived ? "complete (archived)" : "complete");

    return {
      name: repoName,
      isArchived,
      commits,
      linesAdded: lines.added,
      linesDeleted: lines.deleted,
      totalLines: lines.added - lines.deleted,
      pullRequests,
      contributors: contributorsList.length,
      contributorsList,
      issuesCreated: 0,
      issuesClosed: 0,
      releases,
    };
  }
}
