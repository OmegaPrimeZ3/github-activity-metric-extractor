import type { TotalStats, RepoStats } from "./types.js";

export function formatNumber(num: number): string {
  return num.toLocaleString();
}

export function printResults(stats: TotalStats, startDate: string, endDate: string, skipLineStats = false): void {
  const divider = "═".repeat(100);
  const thinDivider = "─".repeat(100);

  const archivedCount = stats.repos.filter(r => r.isArchived).length;
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
  const activeRepos = stats.repos.filter(r => !r.isArchived).sort((a, b) => b.commits - a.commits);
  const archivedRepos = stats.repos.filter(r => r.isArchived).sort((a, b) => a.name.localeCompare(b.name));
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

// Multi-line progress tracker for concurrent operations
class ProgressTracker {
  private activeRepos: Map<string, string> = new Map(); // repo -> status
  private displayedLines: number = 0;
  private totalRepos: number = 0;
  private completedRepos: number = 0;

  setTotal(total: number): void {
    this.totalRepos = total;
  }

  update(repoName: string, status: string): void {
    this.activeRepos.set(repoName, status);
    this.render();
  }

  complete(repoName: string): void {
    this.activeRepos.delete(repoName);
    this.completedRepos++;
    // Clear progress area, print completion, then re-render
    this.clearDisplay();
    console.log(`  [${this.completedRepos}/${this.totalRepos}] ${repoName} - done`);
    this.render();
  }

  private clearDisplay(): void {
    // Move up and clear each displayed line
    for (let i = 0; i < this.displayedLines; i++) {
      process.stdout.write("\x1b[1A"); // Move up one line
      process.stdout.write("\x1b[2K"); // Clear the line
    }
    this.displayedLines = 0;
  }

  private render(): void {
    this.clearDisplay();

    const repos = Array.from(this.activeRepos.entries());
    if (repos.length === 0) return;

    // Show each active repo on its own line
    for (const [repo, status] of repos) {
      const truncatedRepo = repo.length > 25 ? repo.substring(0, 22) + "..." : repo;
      const truncatedStatus = status.length > 50 ? status.substring(0, 47) + "..." : status;
      process.stdout.write(`  \x1b[36m→\x1b[0m ${truncatedRepo}: ${truncatedStatus}\n`);
      this.displayedLines++;
    }
  }

  clear(): void {
    this.clearDisplay();
    this.activeRepos.clear();
  }
}

const progressTracker = new ProgressTracker();

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
