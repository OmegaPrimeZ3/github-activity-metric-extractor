import { writeFileSync } from "fs";
import type { TotalStats, RepoStats, OutputOptions, UserStats, ComparisonStats } from "./types.js";

export function formatNumber(num: number): string {
  return num.toLocaleString();
}

// JSON Formatter
export function formatAsJson(
  stats: TotalStats,
  startDate: string,
  endDate: string,
  options: OutputOptions
): string {
  const output = {
    metadata: {
      dateRange: { startDate, endDate },
      generatedAt: new Date().toISOString(),
      repositoryCount: stats.repos.length,
      activeCount: stats.repos.filter((r) => !r.isArchived).length,
      archivedCount: stats.repos.filter((r) => r.isArchived).length,
    },
    totals: {
      commits: stats.totals.commits,
      linesAdded: options.skipLineStats ? null : stats.totals.linesAdded,
      linesDeleted: options.skipLineStats ? null : stats.totals.linesDeleted,
      netLines: options.skipLineStats ? null : stats.totals.totalLines,
      pullRequests: stats.totals.pullRequests,
      contributors: stats.totals.contributors,
      releases: stats.totals.releases,
    },
    repositories: stats.repos.map((repo) => ({
      name: repo.name,
      isArchived: repo.isArchived,
      commits: repo.commits,
      linesAdded: options.skipLineStats ? null : repo.linesAdded,
      linesDeleted: options.skipLineStats ? null : repo.linesDeleted,
      netLines: options.skipLineStats ? null : repo.totalLines,
      pullRequests: repo.pullRequests,
      contributors: repo.contributors,
      contributorsList: repo.contributorsList,
      releases: repo.releases,
    })),
  };

  return JSON.stringify(output, null, 2);
}

// CSV Formatter
export function formatAsCsv(
  stats: TotalStats,
  startDate: string,
  endDate: string,
  options: OutputOptions
): string {
  const headers = [
    "Repository",
    "Archived",
    "Commits",
    ...(options.skipLineStats ? [] : ["Lines Added", "Lines Deleted", "Net Lines"]),
    "Pull Requests",
    "Contributors",
    "Releases",
  ];

  const rows: string[][] = [];

  // Add metadata as comments
  rows.push([`# Date Range: ${startDate} to ${endDate}`]);
  rows.push([`# Generated: ${new Date().toISOString()}`]);
  rows.push([]);

  // Add headers
  rows.push(headers);

  // Sort repos: active by commits desc, then archived alphabetically
  const activeRepos = stats.repos.filter((r) => !r.isArchived).sort((a, b) => b.commits - a.commits);
  const archivedRepos = stats.repos.filter((r) => r.isArchived).sort((a, b) => a.name.localeCompare(b.name));
  const sortedRepos = [...activeRepos, ...archivedRepos];

  // Add repo rows
  for (const repo of sortedRepos) {
    const row = [
      escapeCsvField(repo.name),
      repo.isArchived ? "Yes" : "No",
      repo.commits.toString(),
      ...(options.skipLineStats
        ? []
        : [repo.linesAdded.toString(), repo.linesDeleted.toString(), repo.totalLines.toString()]),
      repo.pullRequests.toString(),
      repo.contributors.toString(),
      repo.releases.toString(),
    ];
    rows.push(row);
  }

  // Add totals row
  rows.push([]);
  const totalsRow = [
    "TOTALS",
    "",
    stats.totals.commits.toString(),
    ...(options.skipLineStats
      ? []
      : [
          stats.totals.linesAdded.toString(),
          stats.totals.linesDeleted.toString(),
          stats.totals.totalLines.toString(),
        ]),
    stats.totals.pullRequests.toString(),
    stats.totals.contributors.toString(),
    stats.totals.releases.toString(),
  ];
  rows.push(totalsRow);

  return rows.map((row) => row.join(",")).join("\n");
}

function escapeCsvField(field: string): string {
  if (field.includes(",") || field.includes('"') || field.includes("\n")) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

// Markdown Formatter
export function formatAsMarkdown(
  stats: TotalStats,
  startDate: string,
  endDate: string,
  options: OutputOptions
): string {
  const lines: string[] = [];

  const archivedCount = stats.repos.filter((r) => r.isArchived).length;
  const activeCount = stats.repos.length - archivedCount;

  // Header
  lines.push("# GitHub Activity Metric Report");
  lines.push("");
  lines.push(`**Date Range:** ${startDate} to ${endDate}`);
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Repositories:** ${stats.repos.length} total (${activeCount} active, ${archivedCount} archived)`);
  lines.push("");

  // Summary
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Commits | ${formatNumber(stats.totals.commits)} |`);
  if (!options.skipLineStats) {
    lines.push(`| Lines Added | ${formatNumber(stats.totals.linesAdded)} |`);
    lines.push(`| Lines Deleted | ${formatNumber(stats.totals.linesDeleted)} |`);
    lines.push(`| Net Line Change | ${formatNumber(stats.totals.totalLines)} |`);
  }
  lines.push(`| Pull Requests | ${formatNumber(stats.totals.pullRequests)} |`);
  lines.push(`| Unique Contributors | ${formatNumber(stats.totals.contributors)} |`);
  lines.push(`| Releases | ${formatNumber(stats.totals.releases)} |`);
  lines.push("");

  // Repository breakdown
  lines.push("## Repository Breakdown");
  lines.push("");

  // Table header
  const headerCols = [
    "Repository",
    "Commits",
    ...(options.skipLineStats ? [] : ["Lines +", "Lines -", "Net"]),
    "PRs",
    "Contributors",
    "Releases",
  ];
  lines.push(`| ${headerCols.join(" | ")} |`);
  lines.push(`|${headerCols.map(() => "---").join("|")}|`);

  // Sort repos
  const activeRepos = stats.repos.filter((r) => !r.isArchived).sort((a, b) => b.commits - a.commits);
  const archivedRepos = stats.repos.filter((r) => r.isArchived).sort((a, b) => a.name.localeCompare(b.name));
  const sortedRepos = [...activeRepos, ...archivedRepos];

  for (const repo of sortedRepos) {
    const name = repo.isArchived ? `${repo.name} *(archived)*` : repo.name;
    const cols = [
      name,
      formatNumber(repo.commits),
      ...(options.skipLineStats
        ? []
        : [formatNumber(repo.linesAdded), formatNumber(repo.linesDeleted), formatNumber(repo.totalLines)]),
      formatNumber(repo.pullRequests),
      formatNumber(repo.contributors),
      formatNumber(repo.releases),
    ];
    lines.push(`| ${cols.join(" | ")} |`);
  }

  lines.push("");

  return lines.join("\n");
}

// User stats formatters
export function formatUserStatsAsJson(users: UserStats[], startDate: string, endDate: string): string {
  return JSON.stringify(
    {
      metadata: {
        dateRange: { startDate, endDate },
        generatedAt: new Date().toISOString(),
        userCount: users.length,
      },
      users: users.sort((a, b) => b.commits - a.commits),
    },
    null,
    2
  );
}

export function formatUserStatsAsCsv(users: UserStats[]): string {
  const headers = ["Username", "Commits", "Lines Added", "Lines Deleted", "Pull Requests", "Repositories"];
  const rows = [headers.join(",")];

  const sortedUsers = users.sort((a, b) => b.commits - a.commits);
  for (const user of sortedUsers) {
    rows.push(
      [
        escapeCsvField(user.username),
        user.commits,
        user.linesAdded,
        user.linesDeleted,
        user.pullRequests,
        `"${user.repos.join("; ")}"`,
      ].join(",")
    );
  }

  return rows.join("\n");
}

export function formatUserStatsAsMarkdown(users: UserStats[], startDate: string, endDate: string): string {
  const lines: string[] = [];

  lines.push("# Contributor Activity Report");
  lines.push("");
  lines.push(`**Date Range:** ${startDate} to ${endDate}`);
  lines.push(`**Total Contributors:** ${users.length}`);
  lines.push("");
  lines.push("| Contributor | Commits | Lines + | Lines - | PRs | Repos |");
  lines.push("|-------------|---------|---------|---------|-----|-------|");

  const sortedUsers = users.sort((a, b) => b.commits - a.commits);
  for (const user of sortedUsers) {
    lines.push(
      `| ${user.username} | ${formatNumber(user.commits)} | ${formatNumber(user.linesAdded)} | ${formatNumber(user.linesDeleted)} | ${formatNumber(user.pullRequests)} | ${user.repos.length} |`
    );
  }

  return lines.join("\n");
}

export function formatUserStatsAsTable(users: UserStats[], startDate: string, endDate: string): void {
  const divider = "═".repeat(90);
  const thinDivider = "─".repeat(90);

  console.log("\n" + divider);
  console.log("                         CONTRIBUTOR ACTIVITY REPORT");
  console.log(divider);
  console.log(`  Date Range: ${startDate} to ${endDate}`);
  console.log(`  Total Contributors: ${users.length}`);
  console.log(divider + "\n");

  console.log(
    "  " +
      padRight("Contributor", 25) +
      padRight("Commits", 12) +
      padRight("Lines +", 12) +
      padRight("Lines -", 12) +
      padRight("PRs", 8) +
      padRight("Repos", 10)
  );
  console.log("  " + thinDivider);

  const sortedUsers = users.sort((a, b) => b.commits - a.commits);
  for (const user of sortedUsers) {
    const name = user.username.length > 23 ? user.username.substring(0, 20) + "..." : user.username;
    console.log(
      "  " +
        padRight(name, 25) +
        padRight(formatNumber(user.commits), 12) +
        padRight(formatNumber(user.linesAdded), 12) +
        padRight(formatNumber(user.linesDeleted), 12) +
        padRight(formatNumber(user.pullRequests), 8) +
        padRight(user.repos.length.toString(), 10)
    );
  }

  console.log("\n" + divider + "\n");
}

// Comparison formatters
export function formatComparisonAsJson(comparison: ComparisonStats): string {
  const calcChange = (p1: number, p2: number) => {
    if (p1 === 0) return p2 === 0 ? 0 : 100;
    return Math.round(((p2 - p1) / p1) * 100);
  };

  return JSON.stringify(
    {
      period1: {
        range: comparison.period1Range,
        totals: comparison.period1.totals,
      },
      period2: {
        range: comparison.period2Range,
        totals: comparison.period2.totals,
      },
      changes: {
        commits: {
          absolute: comparison.period2.totals.commits - comparison.period1.totals.commits,
          percentage: calcChange(comparison.period1.totals.commits, comparison.period2.totals.commits),
        },
        pullRequests: {
          absolute: comparison.period2.totals.pullRequests - comparison.period1.totals.pullRequests,
          percentage: calcChange(comparison.period1.totals.pullRequests, comparison.period2.totals.pullRequests),
        },
        contributors: {
          absolute: comparison.period2.totals.contributors - comparison.period1.totals.contributors,
          percentage: calcChange(comparison.period1.totals.contributors, comparison.period2.totals.contributors),
        },
        releases: {
          absolute: comparison.period2.totals.releases - comparison.period1.totals.releases,
          percentage: calcChange(comparison.period1.totals.releases, comparison.period2.totals.releases),
        },
      },
    },
    null,
    2
  );
}

export function formatComparisonAsTable(comparison: ComparisonStats): void {
  const divider = "═".repeat(100);
  const thinDivider = "─".repeat(100);

  const calcChange = (p1: number, p2: number) => {
    if (p1 === 0) return p2 === 0 ? "0%" : "+100%";
    const pct = Math.round(((p2 - p1) / p1) * 100);
    return pct >= 0 ? `+${pct}%` : `${pct}%`;
  };

  const p1 = comparison.period1.totals;
  const p2 = comparison.period2.totals;

  console.log("\n" + divider);
  console.log("                            PERIOD COMPARISON REPORT");
  console.log(divider);
  console.log(`  Period 1: ${comparison.period1Range.start} to ${comparison.period1Range.end}`);
  console.log(`  Period 2: ${comparison.period2Range.start} to ${comparison.period2Range.end}`);
  console.log(divider + "\n");

  console.log(
    "  " +
      padRight("Metric", 20) +
      padRight("Period 1", 15) +
      padRight("Period 2", 15) +
      padRight("Change", 15) +
      padRight("% Change", 12)
  );
  console.log("  " + thinDivider);

  const metrics = [
    { name: "Commits", v1: p1.commits, v2: p2.commits },
    { name: "Lines Added", v1: p1.linesAdded, v2: p2.linesAdded },
    { name: "Lines Deleted", v1: p1.linesDeleted, v2: p2.linesDeleted },
    { name: "Pull Requests", v1: p1.pullRequests, v2: p2.pullRequests },
    { name: "Contributors", v1: p1.contributors, v2: p2.contributors },
    { name: "Releases", v1: p1.releases, v2: p2.releases },
  ];

  for (const m of metrics) {
    const change = m.v2 - m.v1;
    const changeStr = change >= 0 ? `+${formatNumber(change)}` : formatNumber(change);
    console.log(
      "  " +
        padRight(m.name, 20) +
        padRight(formatNumber(m.v1), 15) +
        padRight(formatNumber(m.v2), 15) +
        padRight(changeStr, 15) +
        padRight(calcChange(m.v1, m.v2), 12)
    );
  }

  console.log("\n" + divider + "\n");
}

function padRight(str: string, length: number): string {
  return str.padEnd(length);
}

// Output to file or console
export function writeOutput(content: string, outputFile?: string): void {
  if (outputFile) {
    writeFileSync(outputFile, content, "utf-8");
    console.log(`  Output written to: ${outputFile}`);
  } else {
    console.log(content);
  }
}
