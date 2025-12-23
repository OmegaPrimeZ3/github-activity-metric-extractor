import cliProgress from "cli-progress";
import type { TotalStats, RepoStats, OutputOptions } from "./types.js";
import {
  formatNumber,
  formatAsJson,
  formatAsCsv,
  formatAsMarkdown,
  writeOutput,
} from "./formatters.js";

export { formatNumber } from "./formatters.js";

export function printResults(
  stats: TotalStats,
  startDate: string,
  endDate: string,
  skipLineStats = false,
  options?: OutputOptions
): void {
  const outputOptions: OutputOptions = options ?? {
    format: "table",
    skipLineStats,
  };

  switch (outputOptions.format) {
    case "json":
      writeOutput(formatAsJson(stats, startDate, endDate, outputOptions), outputOptions.outputFile);
      return;
    case "csv":
      writeOutput(formatAsCsv(stats, startDate, endDate, outputOptions), outputOptions.outputFile);
      return;
    case "markdown":
      writeOutput(formatAsMarkdown(stats, startDate, endDate, outputOptions), outputOptions.outputFile);
      return;
    case "table":
    default:
      printTableResults(stats, startDate, endDate, skipLineStats);
  }
}

function printTableResults(stats: TotalStats, startDate: string, endDate: string, skipLineStats: boolean): void {
  const divider = "═".repeat(100);
  const thinDivider = "─".repeat(100);

  const archivedCount = stats.repos.filter((r) => r.isArchived).length;
  const activeCount = stats.repos.length - archivedCount;

  console.log("\n" + divider);
  console.log("                            GITHUB ACTIVITY METRIC EXTRACTOR REPORT");
  console.log(divider);
  console.log(`  Date Range: ${startDate} to ${endDate}`);
  console.log(`  Repositories: ${stats.repos.length} total (${activeCount} active, ${archivedCount} archived)`);
  console.log(divider + "\n");

  // Table header
  console.log(
    "  " +
      padRight("Repository", 28) +
      padRight("Commits", 10) +
      padRight("Lines +", 12) +
      padRight("Lines -", 12) +
      padRight("Net", 10) +
      padRight("PRs", 8) +
      padRight("Contrib", 10) +
      padRight("Releases", 10)
  );
  console.log("  " + thinDivider);

  // Sort repos: active repos by commits (descending), then archived repos at the end
  const activeRepos = stats.repos.filter((r) => !r.isArchived).sort((a, b) => b.commits - a.commits);
  const archivedRepos = stats.repos.filter((r) => r.isArchived).sort((a, b) => a.name.localeCompare(b.name));
  const sortedRepos = [...activeRepos, ...archivedRepos];

  for (const repo of sortedRepos) {
    printRepoRow(repo);
  }

  // Totals
  console.log("  " + thinDivider);
  console.log(
    "  " +
      padRight("TOTALS", 28) +
      padRight(formatNumber(stats.totals.commits), 10) +
      padRight(formatNumber(stats.totals.linesAdded), 12) +
      padRight(formatNumber(stats.totals.linesDeleted), 12) +
      padRight(formatNumber(stats.totals.totalLines), 10) +
      padRight(formatNumber(stats.totals.pullRequests), 8) +
      padRight(formatNumber(stats.totals.contributors), 10) +
      padRight(formatNumber(stats.totals.releases), 10)
  );
  console.log("\n" + divider + "\n");

  // Summary
  console.log("  SUMMARY:");
  console.log(`    Total Commits:        ${formatNumber(stats.totals.commits)}`);
  if (!skipLineStats) {
    console.log(`    Total Lines Added:    ${formatNumber(stats.totals.linesAdded)}`);
    console.log(`    Total Lines Deleted:  ${formatNumber(stats.totals.linesDeleted)}`);
    console.log(`    Net Line Change:      ${formatNumber(stats.totals.totalLines)}`);
  } else {
    console.log(`    Total Lines Added:    (skipped)`);
    console.log(`    Total Lines Deleted:  (skipped)`);
    console.log(`    Net Line Change:      (skipped)`);
  }
  console.log(`    Total Pull Requests:  ${formatNumber(stats.totals.pullRequests)}`);
  console.log(`    Total Contributors:   ${formatNumber(stats.totals.contributors)}`);
  console.log(`    Releases:             ${formatNumber(stats.totals.releases)}`);
  console.log(`    Repositories:         ${formatNumber(stats.totals.repoCount)}`);
  console.log("\n" + divider + "\n");
}

function printRepoRow(repo: RepoStats): void {
  // For archived repos, show [archived] tag but still display stats
  let name: string;
  if (repo.isArchived) {
    const truncatedName = repo.name.length > 16 ? repo.name.substring(0, 13) + "..." : repo.name;
    name = `${truncatedName} [archived]`;
  } else {
    name = repo.name.length > 26 ? repo.name.substring(0, 23) + "..." : repo.name;
  }

  console.log(
    "  " +
      padRight(name, 28) +
      padRight(formatNumber(repo.commits), 10) +
      padRight(formatNumber(repo.linesAdded), 12) +
      padRight(formatNumber(repo.linesDeleted), 12) +
      padRight(formatNumber(repo.totalLines), 10) +
      padRight(formatNumber(repo.pullRequests), 8) +
      padRight(formatNumber(repo.contributors), 10) +
      padRight(formatNumber(repo.releases), 10)
  );
}

function padRight(str: string, length: number): string {
  return str.padEnd(length);
}

// Progress bar using cli-progress
class ProgressTracker {
  private bar: cliProgress.SingleBar | null = null;
  private multiBar: cliProgress.MultiBar | null = null;
  private repoBars: Map<string, cliProgress.SingleBar> = new Map();
  private totalRepos: number = 0;
  private completedRepos: number = 0;
  private currentRepo: string = "";
  private currentTask: string = "";
  private quietMode: boolean = false;

  setQuietMode(quiet: boolean): void {
    this.quietMode = quiet;
  }

  setTotal(total: number): void {
    this.totalRepos = total;
    this.completedRepos = 0;

    if (this.quietMode) return;

    // Create a multi-bar container
    this.multiBar = new cliProgress.MultiBar(
      {
        clearOnComplete: false,
        hideCursor: true,
        format: "  {bar} | {percentage}% | {value}/{total} repos | {task}",
        barCompleteChar: "\u2588",
        barIncompleteChar: "\u2591",
      },
      cliProgress.Presets.shades_classic
    );

    // Create main progress bar
    this.bar = this.multiBar.create(total, 0, { task: "Starting..." });
  }

  update(repoName: string, status: string): void {
    if (this.quietMode) return;

    this.currentRepo = repoName;
    this.currentTask = status;

    if (this.bar) {
      const truncatedRepo = repoName.length > 20 ? repoName.substring(0, 17) + "..." : repoName;
      const truncatedTask = status.length > 30 ? status.substring(0, 27) + "..." : status;
      this.bar.update(this.completedRepos, { task: `${truncatedRepo}: ${truncatedTask}` });
    }
  }

  complete(repoName: string): void {
    this.completedRepos++;

    if (this.quietMode) return;

    if (this.bar) {
      this.bar.update(this.completedRepos, { task: `${repoName} done` });
    }
  }

  clear(): void {
    if (this.multiBar) {
      this.multiBar.stop();
      this.multiBar = null;
      this.bar = null;
    }
    this.repoBars.clear();
  }

  stop(): void {
    this.clear();
  }
}

const progressTracker = new ProgressTracker();

export function setQuietMode(quiet: boolean): void {
  progressTracker.setQuietMode(quiet);
}

export function initProgress(totalRepos: number): void {
  progressTracker.setTotal(totalRepos);
}

export function updateRepoStatus(repoName: string, status: string): void {
  progressTracker.update(repoName, status);
}

export function completeRepo(repoName: string): void {
  progressTracker.complete(repoName);
}

export function clearProgress(): void {
  progressTracker.clear();
}

// Legacy exports for compatibility
export function updateStatus(message: string): void {
  // No-op, using new progress tracker
}

export function clearStatus(): void {
  clearProgress();
}
