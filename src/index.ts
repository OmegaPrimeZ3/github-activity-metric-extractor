import { readFileSync } from "fs";
import { resolve } from "path";
import { GitHubClient, GitHubApiError } from "./github-client.js";
import {
  printResults,
  initProgress,
  updateRepoStatus,
  completeRepo,
  clearProgress,
  setQuietMode,
} from "./output.js";
import {
  formatUserStatsAsJson,
  formatUserStatsAsCsv,
  formatUserStatsAsMarkdown,
  formatUserStatsAsTable,
  formatComparisonAsJson,
  formatComparisonAsTable,
  writeOutput,
} from "./formatters.js";
import type {
  Config,
  TotalStats,
  RepoStats,
  RepoInfo,
  OutputFormat,
  OutputOptions,
  UserStats,
  ComparisonStats,
} from "./types.js";

interface CliOptions {
  configPath?: string;
  startDate?: string;
  endDate?: string;
  format: OutputFormat;
  outputFile?: string;
  dryRun: boolean;
  byUser: boolean;
  compare?: { start1: string; end1: string; start2: string; end2: string };
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    format: "table",
    dryRun: false,
    byUser: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--config":
        options.configPath = args[++i];
        break;
      case "--start":
        options.startDate = args[++i];
        break;
      case "--end":
        options.endDate = args[++i];
        break;
      case "--format":
        const format = args[++i];
        if (["table", "json", "csv", "markdown"].includes(format)) {
          options.format = format as OutputFormat;
        } else {
          console.error(`Error: Invalid format "${format}". Valid options: table, json, csv, markdown`);
          process.exit(1);
        }
        break;
      case "--output":
      case "-o":
        options.outputFile = args[++i];
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--by-user":
        options.byUser = true;
        break;
      case "--compare":
        // Expects format: --compare start1 end1 start2 end2
        const start1 = args[++i];
        const end1 = args[++i];
        const start2 = args[++i];
        const end2 = args[++i];
        if (!start1 || !end1 || !start2 || !end2) {
          console.error("Error: --compare requires 4 dates: start1 end1 start2 end2");
          process.exit(1);
        }
        options.compare = { start1, end1, start2, end2 };
        break;
      case "--help":
        printUsage();
        process.exit(0);
    }
  }

  return options;
}

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

function calculateUserStats(repos: RepoStats[]): UserStats[] {
  const userMap = new Map<string, UserStats>();

  for (const repo of repos) {
    for (const contributor of repo.contributorsList) {
      if (!userMap.has(contributor)) {
        userMap.set(contributor, {
          username: contributor,
          commits: 0,
          linesAdded: 0,
          linesDeleted: 0,
          pullRequests: 0,
          repos: [],
        });
      }
      const user = userMap.get(contributor)!;
      user.repos.push(repo.name);
    }
  }

  // Note: Per-user line stats and PR counts require additional API calls
  // For now, we track which repos each user contributed to
  // Commit counts per user would require iterating through commits

  return Array.from(userMap.values());
}

async function runDryRun(config: Config, client: GitHubClient): Promise<void> {
  console.log("\n  DRY RUN - No API calls will be made to fetch statistics\n");
  console.log(`  Organization: ${config.github.organization}`);
  console.log(`  Date Range: ${config.dateRange.startDate} to ${config.dateRange.endDate}\n`);

  console.log("  Fetching repository list...\n");
  const repos = await client.getOrgRepos();

  if (repos.length === 0) {
    console.log("  No repositories found matching the criteria.");
    return;
  }

  const archivedCount = repos.filter((r) => r.isArchived).length;
  const activeCount = repos.length - archivedCount;

  console.log(`  Found ${repos.length} repositories (${activeCount} active, ${archivedCount} archived):\n`);

  // Sort and display
  const activeRepos = repos.filter((r) => !r.isArchived).sort((a, b) => a.name.localeCompare(b.name));
  const archivedRepos = repos.filter((r) => r.isArchived).sort((a, b) => a.name.localeCompare(b.name));

  if (activeRepos.length > 0) {
    console.log("  Active repositories:");
    for (const repo of activeRepos) {
      console.log(`    - ${repo.name}`);
    }
    console.log();
  }

  if (archivedRepos.length > 0) {
    console.log("  Archived repositories:");
    for (const repo of archivedRepos) {
      console.log(`    - ${repo.name} [archived]`);
    }
    console.log();
  }

  // Show what would be analyzed
  console.log("  Analysis would include:");
  console.log(`    - Commits on default branch within date range`);
  if (!config.options.skipLineStats) {
    console.log(`    - Lines of code added/deleted`);
  }
  console.log(`    - Pull requests created`);
  console.log(`    - Unique contributors`);
  console.log(`    - Releases published`);
  console.log();

  // Show configuration
  console.log("  Configuration:");
  console.log(`    - Max concurrent requests: ${config.options.maxConcurrentRequests}`);
  console.log(`    - Page size: ${config.options.pageSize}`);
  console.log(`    - Skip line stats: ${config.options.skipLineStats}`);
  if (config.options.includeRepos.length > 0) {
    console.log(`    - Include only: ${config.options.includeRepos.join(", ")}`);
  }
  if (config.options.excludeRepos.length > 0) {
    console.log(`    - Exclude: ${config.options.excludeRepos.join(", ")}`);
  }
  console.log();
}

async function runComparison(
  config: Config,
  client: GitHubClient,
  compare: { start1: string; end1: string; start2: string; end2: string },
  cliOptions: CliOptions
): Promise<void> {
  console.log("\n  Running Period Comparison...\n");

  // Period 1
  console.log(`  Analyzing Period 1: ${compare.start1} to ${compare.end1}`);
  config.dateRange.startDate = compare.start1;
  config.dateRange.endDate = compare.end1;

  const repos1 = await client.getOrgRepos();
  const repoStats1 = await processRepos(client, repos1, config.options.maxConcurrentRequests);
  const period1 = calculateTotals(repoStats1);

  // Period 2
  console.log(`\n  Analyzing Period 2: ${compare.start2} to ${compare.end2}`);
  config.dateRange.startDate = compare.start2;
  config.dateRange.endDate = compare.end2;

  // Clear caches for fresh data
  client.clearBranchCache();

  const repos2 = await client.getOrgRepos();
  const repoStats2 = await processRepos(client, repos2, config.options.maxConcurrentRequests);
  const period2 = calculateTotals(repoStats2);

  const comparison: ComparisonStats = {
    period1,
    period2,
    period1Range: { start: compare.start1, end: compare.end1 },
    period2Range: { start: compare.start2, end: compare.end2 },
  };

  // Output comparison
  if (cliOptions.format === "json") {
    writeOutput(formatComparisonAsJson(comparison), cliOptions.outputFile);
  } else {
    formatComparisonAsTable(comparison);
  }

  console.log(`  API Rate Limit: ${client.getRateLimitRemaining()} requests remaining\n`);
}

async function runByUser(
  config: Config,
  repoStats: RepoStats[],
  cliOptions: CliOptions
): Promise<void> {
  const userStats = calculateUserStats(repoStats);

  switch (cliOptions.format) {
    case "json":
      writeOutput(
        formatUserStatsAsJson(userStats, config.dateRange.startDate, config.dateRange.endDate),
        cliOptions.outputFile
      );
      break;
    case "csv":
      writeOutput(formatUserStatsAsCsv(userStats), cliOptions.outputFile);
      break;
    case "markdown":
      writeOutput(
        formatUserStatsAsMarkdown(userStats, config.dateRange.startDate, config.dateRange.endDate),
        cliOptions.outputFile
      );
      break;
    case "table":
    default:
      formatUserStatsAsTable(userStats, config.dateRange.startDate, config.dateRange.endDate);
  }
}

async function main(): Promise<void> {
  console.log("\n  GitHub Activity Metric Extractor");
  console.log("  ================================\n");

  const cliOptions = parseArgs();

  // Set quiet mode for non-table formats
  if (cliOptions.format !== "table") {
    setQuietMode(true);
  }

  // Load and validate configuration
  const config = loadConfig(cliOptions.configPath);

  // Apply command line date overrides
  if (cliOptions.startDate) {
    config.dateRange.startDate = cliOptions.startDate;
  }
  if (cliOptions.endDate) {
    config.dateRange.endDate = cliOptions.endDate;
  }

  validateConfig(config);

  // Initialize GitHub client
  const client = new GitHubClient(config);

  // Handle dry run
  if (cliOptions.dryRun) {
    await runDryRun(config, client);
    return;
  }

  // Handle comparison mode
  if (cliOptions.compare) {
    await runComparison(config, client, cliOptions.compare, cliOptions);
    return;
  }

  // Standard run
  if (cliOptions.format === "table") {
    console.log(`  Organization: ${config.github.organization}`);
    console.log(`  Date Range: ${config.dateRange.startDate} to ${config.dateRange.endDate}\n`);
    console.log("  Fetching repositories...");
  }

  const repos = await client.getOrgRepos();

  if (repos.length === 0) {
    console.log("  No repositories found matching the criteria.");
    process.exit(0);
  }

  if (cliOptions.format === "table") {
    console.log(`  Found ${repos.length} repositories\n`);
    console.log("  Analyzing repositories...\n");
  }

  // Process repositories with configured concurrency
  const repoStats = await processRepos(client, repos, config.options.maxConcurrentRequests);

  // Handle by-user mode
  if (cliOptions.byUser) {
    await runByUser(config, repoStats, cliOptions);
    if (cliOptions.format === "table") {
      console.log(`  API Rate Limit: ${client.getRateLimitRemaining()} requests remaining\n`);
    }
    return;
  }

  // Calculate and display results
  const totalStats = calculateTotals(repoStats);

  const outputOptions: OutputOptions = {
    format: cliOptions.format,
    outputFile: cliOptions.outputFile,
    skipLineStats: config.options.skipLineStats,
  };

  printResults(
    totalStats,
    config.dateRange.startDate,
    config.dateRange.endDate,
    config.options.skipLineStats,
    outputOptions
  );

  // Show rate limit status for table format
  if (cliOptions.format === "table") {
    console.log(`  API Rate Limit: ${client.getRateLimitRemaining()} requests remaining\n`);
  }
}

function printUsage(): void {
  console.log(`
  Usage: yarn start [options]

  Options:
    --config <path>       Path to configuration file (default: ./config.json)
    --start <date>        Override start date (YYYY-MM-DD)
    --end <date>          Override end date (YYYY-MM-DD)
    --format <format>     Output format: table, json, csv, markdown (default: table)
    --output, -o <file>   Write output to file instead of stdout
    --dry-run             Show what would be analyzed without making API calls
    --by-user             Show metrics broken down by contributor
    --compare <dates>     Compare two periods (start1 end1 start2 end2)
    --help                Show this help message

  Examples:
    yarn start
    yarn start --config /path/to/config.json
    yarn start --start 2024-01-01 --end 2024-06-30
    yarn start --format json --output report.json
    yarn start --format csv -o metrics.csv
    yarn start --format markdown -o report.md
    yarn start --dry-run
    yarn start --by-user
    yarn start --by-user --format json -o users.json
    yarn start --compare 2024-01-01 2024-06-30 2024-07-01 2024-12-31
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
