# GitHub Activity Metric Extractor

A Node.js/TypeScript utility that connects to GitHub and extracts activity metrics from repositories within an organization. It calculates and displays development activity metrics for a specified date range.

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Output](#output)
- [Troubleshooting](#troubleshooting)

## Features

- Fetches all repositories from a GitHub organization
- Tracks the following metrics within a date range:
  - **Commits** - Total commits on the default branch
  - **Lines of Code** - Lines added and deleted
  - **Pull Requests** - PRs created against the default branch
  - **Contributors** - Unique contributors who made commits
  - **Issues** - Issues created and closed
  - **Releases** - Releases published
- Provides per-repository breakdown and totals
- Supports GitHub.com and GitHub Enterprise Server
- Supports filtering repositories (include/exclude lists)
- Progress indicator during analysis
- Command-line date overrides

## Prerequisites

- **Node.js**: Version 22.x or higher (LTS recommended - v22.x or v24.x)
- **Yarn**: Version 1.22.x or higher (`npm install -g yarn`)
- **GitHub Personal Access Token**: With appropriate permissions

### Creating a GitHub Personal Access Token

1. Go to GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Give it a descriptive name (e.g., "Org Statistics Tool")
4. Select the following scopes:
   - `repo` (Full control of private repositories) - required for private repos
   - `read:org` (Read org and team membership) - required to list org repos
5. Click "Generate token"
6. **Copy the token immediately** - you won't be able to see it again

> **Note**: For public repositories only, the `public_repo` scope is sufficient instead of full `repo` access.

## Installation

1. **Clone or download the repository**

   ```bash
   git clone <repository-url>
   cd github-activity-metric-extractor
   ```

2. **Install dependencies**

   ```bash
   yarn install
   ```

3. **Create your configuration file**

   ```bash
   cp config.example.json config.json
   ```

4. **Build the project** (optional, for production use)

   ```bash
   yarn build
   ```

## Configuration

Edit `config.json` with your settings:

```json
{
  "github": {
    "token": "ghp_xxxxxxxxxxxxxxxxxxxx",
    "organization": "your-org-name",
    "isEnterprise": false,
    "enterpriseUrl": "https://github.yourcompany.com"
  },
  "dateRange": {
    "startDate": "2024-01-01",
    "endDate": "2024-12-31"
  },
  "options": {
    "excludeRepos": [],
    "includeRepos": [],
    "maxConcurrentRequests": 3,
    "skipLineStats": false
  }
}
```

### Configuration Options

| Option | Description | Required |
|--------|-------------|----------|
| `github.token` | Your GitHub Personal Access Token | Yes |
| `github.organization` | The GitHub organization name to analyze | Yes |
| `github.isEnterprise` | Set to `true` for GitHub Enterprise Server | Yes |
| `github.enterpriseUrl` | Your GitHub Enterprise Server URL (only used when `isEnterprise` is `true`) | No |
| `dateRange.startDate` | Start date for analysis (YYYY-MM-DD) | Yes |
| `dateRange.endDate` | End date for analysis (YYYY-MM-DD) | Yes |
| `options.excludeRepos` | Array of repository names to skip | No |
| `options.includeRepos` | If set, only analyze these repositories | No |
| `options.maxConcurrentRequests` | Number of repos to process in parallel (default: 3) | No |
| `options.skipLineStats` | Skip line statistics to save API calls (default: false) | No |
| `options.pageSize` | Number of items per API request (default: 100, max: 100) | No |

### Filtering Repositories

**Exclude specific repositories:**
```json
{
  "options": {
    "excludeRepos": ["archived-repo", "test-repo", "deprecated-project"]
  }
}
```

**Analyze only specific repositories:**
```json
{
  "options": {
    "includeRepos": ["main-app", "api-service", "web-frontend"]
  }
}
```

> **Note**: If `includeRepos` is set (non-empty array), only those repositories will be analyzed. `excludeRepos` is ignored in this case.

### GitHub Enterprise Configuration

For GitHub Enterprise Server, set `isEnterprise` to `true` and provide your Enterprise URL:

```json
{
  "github": {
    "token": "ghp_xxxxxxxxxxxxxxxxxxxx",
    "organization": "your-org-name",
    "isEnterprise": true,
    "enterpriseUrl": "https://github.yourcompany.com"
  }
}
```

The tool automatically appends `/api/v3` to your Enterprise URL when making API calls. You only need to provide the base URL of your GitHub Enterprise Server.

**Standard GitHub.com:**
```json
{
  "github": {
    "isEnterprise": false,
    "enterpriseUrl": ""
  }
}
```
When `isEnterprise` is `false`, the `enterpriseUrl` is ignored and the tool connects to `https://api.github.com`.

### API Rate Limits & Optimization

GitHub API has a rate limit of 5,000 requests per hour. For large organizations, consider these optimizations:

**1. Skip Line Statistics** (biggest impact)
```json
{
  "options": {
    "skipLineStats": true
  }
}
```
Line statistics use GitHub's Statistics API, which is efficient but may still consume calls for repos with complex histories.

**2. Reduce Concurrency**
```json
{
  "options": {
    "maxConcurrentRequests": 2
  }
}
```
Lower concurrency helps stay under rate limits and provides more predictable API usage.

**3. Use Include Filter**
```json
{
  "options": {
    "includeRepos": ["important-repo-1", "important-repo-2"]
  }
}
```
Only analyze the repositories you care about.

**Rate Limit Handling:**
- The tool monitors rate limit headers and automatically pauses when approaching limits
- If rate limited (403), retries with exponential backoff (60+ seconds)
- Shows remaining API calls at the end of the run

## Usage

### Basic Usage

Run the tool with default configuration:

```bash
# Using tsx (development)
yarn start

# Using compiled JavaScript (production)
yarn build
yarn run
```

### Command-Line Options

```bash
yarn start [options]
```

| Option | Description | Example |
|--------|-------------|---------|
| `--config <path>` | Path to a custom config file | `--config ./my-config.json` |
| `--start <date>` | Override start date | `--start 2024-06-01` |
| `--end <date>` | Override end date | `--end 2024-06-30` |
| `--help` | Display help message | `--help` |

### Examples

**Analyze a specific quarter:**
```bash
yarn start --start 2024-07-01 --end 2024-09-30
```

**Use a different configuration file:**
```bash
yarn start --config /path/to/production-config.json
```

**Combine options:**
```bash
yarn start --config ./config-prod.json --start 2024-01-01 --end 2024-03-31
```

## Output

The tool produces a formatted report showing statistics for each repository and organization totals.

### Sample Output

```
  GitHub Activity Metric Extractor
  ================================

  Organization: my-org
  Date Range: 2024-01-01 to 2024-12-31

  Fetching repositories...
  Found 12 repositories

  Analyzing repositories...

══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
                                        GITHUB ACTIVITY METRIC EXTRACTOR REPORT
══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  Date Range: 2024-01-01 to 2024-12-31
  Repositories Analyzed: 12
══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

  Repository                  Commits   Lines +     Lines -     Net       PRs     Contrib   Issues+   Issues-   Releases
  ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  platform-api                487       62,340      18,920      43,420    156     24        89        72        12
  web-dashboard               312       41,200      12,650      28,550    98      18        56        48        8
  mobile-app                  245       33,800      9,400       24,400    87      15        42        35        6
  auth-service                198       18,500      5,200       13,300    64      12        28        24        5
  data-pipeline               156       22,100      8,900       13,200    52      9         18        15        4
  shared-components           134       15,600      4,100       11,500    45      11        22        19        3
  ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  TOTALS                      1,532     193,540     59,170      134,370   502     89        255       213       38

══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

  SUMMARY:
    Total Commits:        1,532
    Total Lines Added:    193,540
    Total Lines Deleted:  59,170
    Net Line Change:      134,370
    Total Pull Requests:  502
    Total Contributors:   89
    Issues Created:       255
    Issues Closed:        213
    Releases:             38
    Repositories:         12

══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
```

### Output Metrics Explained

| Metric | Description |
|--------|-------------|
| **Commits** | Number of commits to the default branch within the date range |
| **Lines +** | Total lines of code added across all commits |
| **Lines -** | Total lines of code removed across all commits |
| **Net** | Lines Added minus Lines Deleted (net change in codebase size) |
| **PRs** | Pull requests created against the default branch within the date range |
| **Contrib** | Unique contributors who made commits in the date range |
| **Issues+** | Issues created within the date range |
| **Issues-** | Issues closed within the date range |
| **Releases** | Releases published within the date range |

## Troubleshooting

### Common Errors

**"Error: GitHub token not configured"**
- Ensure you've added your token to `config.json`
- Verify the token hasn't expired

**"Error: Bad credentials"**
- Your token may be invalid or expired
- Generate a new token and update `config.json`

**"Error: Not Found" when fetching repositories**
- Verify the organization name is correct
- Ensure your token has `read:org` scope
- Check if you have access to the organization

**"Error: API rate limit exceeded"**
- GitHub limits API requests (5,000/hour for authenticated requests)
- Reduce `maxConcurrentRequests` in config
- Wait for the rate limit to reset (shown in error message)
- Consider using a GitHub App token for higher limits

**Empty results for a repository**
- The repository may be empty or have no commits in the date range
- The repository's default branch is detected automatically from GitHub

### Rate Limiting Considerations

The GitHub API has rate limits:
- **Authenticated requests**: 5,000 per hour
- **Per-repository operations**: Each repo requires multiple API calls

For large organizations (100+ repos), consider:
1. Reducing `maxConcurrentRequests` to 2-3
2. Running analysis in smaller date ranges
3. Using `includeRepos` to analyze subsets

### Performance Tips

- **Large organizations**: Use `includeRepos` to analyze specific repositories
- **Many commits**: Larger date ranges with many commits take longer due to per-commit API calls for line statistics
- **Parallel processing**: Increase `maxConcurrentRequests` (up to 10) if you have rate limit headroom

## Security Notes

- **Never commit `config.json`** to version control (it's in `.gitignore`)
- Use environment-specific config files for different environments
- Rotate your GitHub token periodically
- Use tokens with minimal required scopes

## License

ISC
