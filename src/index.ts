import { readFileSync } from "fs";
import { resolve } from "path";
import { GitHubClient, GitHubApiError } from "./github-client.js";
import { printResults, initProgress, updateRepoStatus, completeRepo, clearProgress } from "./output.js";
import type { Config, TotalStats, RepoStats, RepoInfo } from "./types.js";

function loadConfig(configPath?: string): Config {
  const path = configPath ?? resolve(process.cwd(), "config.json");

  try {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content) as Config;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(`Error: Configuration file not found at ${path}`);
      console.error("Please create a config.json file based on the template.");
      process.exit(1);
    }
    throw error;
  }
}

function validateConfig(config: Config): void {
  if (!config.github.token || config.github.token === "YOUR_GITHUB_PERSONAL_ACCESS_TOKEN") {
    console.error("Error: GitHub token not configured in config.json");
    process.exit(1);
  }

  if (!config.github.organization || config.github.organization === "YOUR_ORG_NAME") {
    console.error("Error: GitHub organization not configured in config.json");
    process.exit(1);
  }

  const startDate = new Date(config.dateRange.startDate);
  const endDate = new Date(config.dateRange.endDate);

  if (isNaN(startDate.getTime())) {
    console.error("Error: Invalid start date format. Use YYYY-MM-DD");
    process.exit(1);
  }

  if (isNaN(endDate.getTime())) {
    console.error("Error: Invalid end date format. Use YYYY-MM-DD");
    process.exit(1);
  }

  if (startDate > endDate) {
    console.error("Error: Start date must be before end date");
    process.exit(1);
  }
}

async function processRepos(
  client: GitHubClient,
  repos: RepoInfo[],
  concurrency: number
): Promise<RepoStats[]> {
  const results: RepoStats[] = new Array(repos.length);

  // Initialize progress tracker
  initProgress(repos.length);

  // Set up progress callback - updates the multi-line display
  client.setProgressCallback((repoName, task) => {
    updateRepoStatus(repoName, task);
  });

  // Process in batches for concurrency
  for (let i = 0; i < repos.length; i += concurrency) {
    const batch = repos.slice(i, Math.min(i + concurrency, repos.length));
    const batchIndices = batch.map((_, idx) => i + idx);

    // Mark all batch repos as starting
    for (const repo of batch) {
      updateRepoStatus(repo.name, "starting...");
    }

    // Process batch concurrently
    const batchResults = await Promise.all(
      batch.map(async (repo, batchIdx) => {
        const stats = await client.getRepoStats(repo);

        // Mark this repo as done
        completeRepo(repo.name);

        return { index: batchIndices[batchIdx], stats };
      })
    );

    // Store results in correct order
    for (const { index, stats } of batchResults) {
      results[index] = stats;
    }
  }

  clearProgress();
  return results;
}

function calculateTotals(repos: RepoStats[]): TotalStats {
  // Collect unique contributors across all repos (including archived)
  const uniqueContributors = new Set<string>();

  // Count stats from all repos (including archived)
  const totals = repos.reduce(
    (acc, repo) => {
      // Add all contributors from this repo to the unique set
      for (const contributor of repo.contributorsList) {
        uniqueContributors.add(contributor);
      }

      return {
        commits: acc.commits + repo.commits,
        linesAdded: acc.linesAdded + repo.linesAdded,
        linesDeleted: acc.linesDeleted + repo.linesDeleted,
        totalLines: acc.totalLines + repo.totalLines,
        pullRequests: acc.pullRequests + repo.pullRequests,
        contributors: 0, // Will be set below
        issuesCreated: 0,
        issuesClosed: 0,
        releases: acc.releases + repo.releases,
        repoCount: acc.repoCount + 1,
      };
    },
    {
      commits: 0,
      linesAdded: 0,
      linesDeleted: 0,
      totalLines: 0,
      pullRequests: 0,
      contributors: 0,
      issuesCreated: 0,
      issuesClosed: 0,
      releases: 0,
      repoCount: 0,
    }
  );

  // Set unique contributor count across all active repos
  totals.contributors = uniqueContributors.size;

  return { repos, totals };
}

async function main(): Promise<void> {
  console.log("\n  GitHub Activity Metric Extractor");
  console.log("  ================================\n");

  // Parse command line arguments for optional config path and date override
  const args = process.argv.slice(2);
  let configPath: string | undefined;
  let startDateOverride: string | undefined;
  let endDateOverride: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--config" && args[i + 1]) {
      configPath = args[++i];
    } else if (arg === "--start" && args[i + 1]) {
      startDateOverride = args[++i];
    } else if (arg === "--end" && args[i + 1]) {
      endDateOverride = args[++i];
    } else if (arg === "--help") {
      printUsage();
      process.exit(0);
    }
  }

  // Load and validate configuration
  const config = loadConfig(configPath);

  // Apply command line date overrides
  if (startDateOverride) {
    config.dateRange.startDate = startDateOverride;
  }
  if (endDateOverride) {
    config.dateRange.endDate = endDateOverride;
  }

  validateConfig(config);

  console.log(`  Organization: ${config.github.organization}`);
  console.log(`  Date Range: ${config.dateRange.startDate} to ${config.dateRange.endDate}\n`);

  // Initialize GitHub client
  const client = new GitHubClient(config);

  // Fetch all repositories
  console.log("  Fetching repositories...");
  const repos = await client.getOrgRepos();

  if (repos.length === 0) {
    console.log("  No repositories found matching the criteria.");
    process.exit(0);
  }

  console.log(`  Found ${repos.length} repositories\n`);
  console.log("  Analyzing repositories...\n");

  // Process repositories with configured concurrency
  const repoStats = await processRepos(client, repos, config.options.maxConcurrentRequests);

  // Calculate and display results
  const totalStats = calculateTotals(repoStats);
  printResults(totalStats, config.dateRange.startDate, config.dateRange.endDate, config.options.skipLineStats);

  // Show rate limit status
  console.log(`  API Rate Limit: ${client.getRateLimitRemaining()} requests remaining\n`);
}

function printUsage(): void {
  console.log(`
  Usage: yarn start [options]

  Options:
    --config <path>   Path to configuration file (default: ./config.json)
    --start <date>    Override start date (YYYY-MM-DD)
    --end <date>      Override end date (YYYY-MM-DD)
    --help            Show this help message

  Examples:
    yarn start
    yarn start --config /path/to/config.json
    yarn start --start 2024-01-01 --end 2024-06-30
  `);
}

main().catch((error) => {
  clearProgress();
  if (error instanceof GitHubApiError) {
    console.error(`\n  Error in repository "${error.repoName}" during "${error.operation}":`);
    console.error(`    ${error.originalError.message}`);
    if ("status" in error.originalError) {
      console.error(`    HTTP Status: ${(error.originalError as { status: number }).status}`);
    }
  } else {
    console.error("\n  Error:", error instanceof Error ? error.message : error);
  }
  process.exit(1);
});
