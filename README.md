# GitHub Updater

A clean, simple update system that uses GitHub Releases to distribute updates for Node.js applications.

## Features

- ✅ Check for updates from GitHub Releases
- ✅ Download updates automatically
- ✅ Install updates with automatic backups
- ✅ **Intelligent upgrade paths** with minimum version requirements
- ✅ Automatic rollback on update failure
- ✅ Cross-platform support (Windows, Linux, macOS, Raspberry Pi)
- ✅ Clean OOP design with minimal dependencies
- ✅ Private repository support with GitHub tokens
- ✅ Configurable file exclusions and backups
- ✅ Standard Node.js callback pattern
- ✅ State management to prevent conflicting operations

## Installation

### Option 1: Copy to your project

Copy the package files (`index.js`, `UpdateController.js`, `package.json`) into your project directory.

### Option 2: Install from Git

```bash
npm install git+https://github.com/your-username/gh-updater.git
```

## Quick Start

```javascript
const { createUpdater } = require("@your-org/gh-updater");
require("dotenv").config();

// Initialize the updater (singleton - only one instance allowed)
const updater = createUpdater({
  owner: "your-github-username",
  repo: "your-repo-name",
  token: process.env.GITHUB_TOKEN, // For private repos
});

// Check for updates
updater.check((error, result) => {
  if (error) {
    console.error("Error checking for updates:", error);
    return;
  }

  console.log("Current version:", result.currentVersion);
  console.log("Latest version:", result.latestVersion);
  console.log("Update available:", result.updateAvailable);
});

// Download update
updater.download((error, result) => {
  if (error) {
    console.error("Error downloading update:", error);
    return;
  }

  console.log("Download complete:", result.message);
});

// Install update
updater.install((error, result) => {
  if (error) {
    console.error("Error installing update:", error);
    return;
  }

  console.log("Update installed:", result.message);
  console.log("Updated from", result.oldVersion, "to", result.newVersion);
  console.log("Rollback available at:", result.rollbackPath);
});

// Clear downloads after successful update (optional)
updater.clearDownloads((error, result) => {
  if (error) {
    console.error("Error clearing downloads:", error);
    return;
  }
  console.log(result.message);
});

// Rollback to previous version if something goes wrong (optional)
updater.rollback((error, result) => {
  if (error) {
    console.error("Error rolling back:", error);
    return;
  }
  console.log("Rolled back to version:", result.version);
});

// Check if rollback is available (optional)
const rollbackInfo = updater.getRollbackInfo();
if (rollbackInfo) {
  console.log("Rollback available for version:", rollbackInfo.version);
} else {
  console.log("No rollback available");
}

// Clear backups after verifying update works (optional)
updater.clearBackups((error, result) => {
  if (error) {
    console.error("Error clearing backups:", error);
    return;
  }
  console.log(result.message);
});
```

## Configuration

### Singleton Pattern

The UpdateController uses a **singleton pattern** - only one instance can exist per application. This prevents conflicts when managing downloads, backups, and installations.

```javascript
// First call creates the instance
const updater = createUpdater({ owner: "user", repo: "repo" });

// Attempting to create another instance will throw an error
const updater2 = createUpdater({ owner: "other", repo: "other" }); // ❌ Error!

// Use getUpdater() to access the existing instance
const { getUpdater } = require("@your-org/gh-updater");
const existingUpdater = getUpdater(); // ✅ Returns the existing instance or null
```

### Required

- `owner` - GitHub repository owner (username or organization)
- `repo` - GitHub repository name

### Optional

- `token` - GitHub Personal Access Token (required for private repos)
- `preserveOnUpdate` - Array of files/folders to preserve during clean install
- `backupFiles` - Array of files to backup before updating

### Default Behavior

By default, the updater:

- **Preserves during update**: `.env`, `.git`, `.gh-updater/` (updater internal directory)
- **Backs up before update**: `package.json` and other `preserveOnUpdate` files
- **Deletes during update**: `node_modules/` and all other files/folders
- **Update method**: Clean install (fresh copy of new version)
- **Internal directory**: `.gh-updater/` contains downloads, backups, and rollback files

### Example with custom options

```javascript
const updater = createUpdater({
  owner: "your-github-username",
  repo: "your-app",
  token: process.env.GITHUB_TOKEN,
  preserveOnUpdate: [
    ".env",         // Default: Environment variables
    ".git",         // Default: Git repository
    ".gh-updater",  // Default: Updater internal directory (downloads, backups, rollback)
    "user-data",    // Custom: Your user data folder
    "database.db",  // Custom: SQLite database
    "uploads",      // Custom: User uploads
  ],
  backupFiles: [
    "package.json", // Default: Package configuration
    "config.json",  // Custom: Your config file
    "database.db",  // Custom: Your database file
  ],
});
```

**Note**: The installer automatically runs `npm install` after updating files to install new/updated dependencies.

## API Reference

### `createUpdater(config)`

Creates a new update controller instance (singleton).

**Parameters:**

- `config.owner` (string, required) - GitHub repository owner
- `config.repo` (string, required) - GitHub repository name
- `config.token` (string, optional) - GitHub Personal Access Token
- `config.preserveOnUpdate` (array, optional) - Files/folders to preserve during clean install

**Returns:** UpdateController instance

**Throws:** Error if an instance already exists

### `getUpdater()`

Get the existing UpdateController instance.

**Returns:** UpdateController instance or null if not created yet

**Example:**
```javascript
const { getUpdater } = require("@your-org/gh-updater");

const updater = getUpdater();
if (updater) {
  // Use existing instance
  updater.check((error, result) => { /* ... */ });
} else {
  console.log("No updater instance exists yet");
}
```

### `updater.check(callback)`

Check for available updates with intelligent upgrade path detection.

**Note:** Cannot run while another operation is in progress. Use `getState()` to check if busy.

**Callback:** `(error, result)`

- `error` - Error object if failed, null if successful
- `result.currentVersion` - Current application version
- `result.latestVersion` - Latest available version on GitHub
- `result.targetVersion` - Version you should upgrade to (may be different from latest)
- `result.updateAvailable` - Boolean indicating if update is available
- `result.isLatestCompatible` - Boolean indicating if you can upgrade directly to latest
- `result.minimumVersionRequired` - Minimum version required for the target release
- `result.releaseName` - Release name from GitHub
- `result.releaseNotes` - Release notes (markdown text without metadata comment)
- `result.releaseMetadata` - Parsed metadata object from release (contains `minimumVersionRequired`, `changelog`, etc.)
- `result.publishedAt` - Release publish date
- `result.downloaded` - Boolean indicating if target version already downloaded
- `result.downloadedVersion` - Version of downloaded update (if any)

**How upgrade paths work:**

The updater automatically determines the best upgrade path:
- If `isLatestCompatible: true` → You can upgrade directly to the latest version
- If `isLatestCompatible: false` → You need to upgrade to an intermediate version first (see `targetVersion`)

Example response when intermediate upgrade is needed:
```javascript
{
  currentVersion: "1.0.0",
  latestVersion: "2.0.0",
  targetVersion: "1.5.0",  // Upgrade to this first
  isLatestCompatible: false,
  minimumVersionRequired: "1.5.0",
  updateAvailable: true
}
```

### `updater.download(callback)`

Download the latest compatible update (respects minimum version requirements).

**Note:** Cannot run while another operation is in progress. Use `getState()` to check if busy.

**Callback:** `(error, result)`

- `error` - Error object if failed, null if successful
- `result.success` - Boolean indicating success
- `result.message` - Success/info message
- `result.size` - Downloaded file size in bytes
- `result.targetVersion` - Version that was downloaded
- `result.latestVersion` - Latest version on GitHub
- `result.isLatestCompatible` - Whether the target is the latest version
- `result.isIntermediateVersion` - True if an intermediate version was downloaded

**Example:**
```javascript
updater.download((error, result) => {
  if (error) {
    console.error("Download failed:", error);
    return;
  }

  if (result.isIntermediateVersion) {
    console.log(`Downloaded intermediate version ${result.targetVersion}`);
    console.log(`You can upgrade to ${result.latestVersion} after installing this.`);
  } else {
    console.log(`Downloaded latest version ${result.targetVersion}`);
  }
});
```

### `updater.install(callback)`

Install the downloaded update.

**Note:** Cannot run while another operation is in progress. Use `getState()` to check if busy.

**Important:** After successful installation, you must **restart your application** for the new version to take effect. The install process updates files on disk but doesn't reload code in memory. Call `process.exit(0)` in the callback and use a process manager (PM2, systemd, etc.) to automatically restart the application.

**Callback:** `(error, result)`

- `error` - Error object if failed, null if successful
- `result.success` - Boolean indicating success
- `result.message` - Success message
- `result.oldVersion` - Previous version
- `result.newVersion` - New version
- `result.rollbackAvailable` - Boolean indicating if rollback is available
- `result.rollbackPath` - Path to rollback archive

**Example with restart:**
```javascript
updater.install((error, result) => {
  if (error) {
    console.error("Install failed:", error);
    return;
  }

  console.log(`Updated from ${result.oldVersion} to ${result.newVersion}`);
  console.log("Restarting application in 3 seconds...");

  setTimeout(() => {
    process.exit(0); // Process manager will restart the app
  }, 3000);
});
```

### `updater.clearDownloads(callback)`

Clear downloaded update files to free up disk space.

**Note:** Cannot run during download or install operations.

**Callback:** `(error, result)`

- `error` - Error object if failed, null if successful
- `result.success` - Boolean indicating success
- `result.message` - Success message
- `result.deletedCount` - Number of files/folders deleted

**Use case:** After successfully installing and verifying an update, clear downloads to free space.

### `updater.clearBackups(callback)`

Clear backup files to free up disk space.

**Note:** Cannot run during install operation (when backups are being created).

**Callback:** `(error, result)`

- `error` - Error object if failed, null if successful
- `result.success` - Boolean indicating success
- `result.message` - Success message
- `result.deletedCount` - Number of backups deleted

**Use case:** After verifying the update works correctly, clear old backups and rollback archives to free space.

**Warning:** Only clear backups after confirming the update is stable. You won't be able to rollback without the rollback archive.

### `updater.rollback(callback)`

Rollback to the previous version if an update causes issues.

**Note:** Cannot run while another operation is in progress. Requires a rollback archive from a previous update.

**Callback:** `(error, result)`

- `error` - Error object if failed, null if successful
- `result.success` - Boolean indicating success
- `result.message` - Success message
- `result.version` - Version that was rolled back to

**How it works:**
1. Deletes all current files (except preserved ones)
2. Extracts the rollback archive
3. Runs `npm install` for the previous version's dependencies
4. Deletes the rollback archive after successful rollback

**Use case:** If an update breaks functionality, quickly rollback to the previous working version.

**Example:**
```javascript
updater.rollback((error, result) => {
  if (error) {
    console.error("Rollback failed:", error);
    return;
  }
  console.log("Successfully rolled back to version:", result.version);
  // Restart application to run the previous version
});
```

### `updater.getRollbackInfo()`

Get information about the available rollback archive (synchronous).

**Returns:** Object with rollback information, or null if no rollback available

- `available` - Boolean indicating if rollback is available
- `version` - Version of the rollback archive
- `path` - Path to the rollback archive
- `size` - Size of the rollback archive in bytes
- `createdAt` - Date when rollback was created

**Example:**
```javascript
const rollbackInfo = updater.getRollbackInfo();
if (rollbackInfo) {
  console.log("Rollback available for version:", rollbackInfo.version);
  console.log("Archive size:", (rollbackInfo.size / 1024 / 1024).toFixed(2), "MB");
} else {
  console.log("No rollback available");
}
```

### `updater.getState()`

Get the current state of the updater to check if an operation is in progress.

**Returns:** Object with state information

- `current` - Current state: "idle", "checking", "downloading", or "installing"
- `locked` - Boolean indicating if an operation is in progress
- `isBusy` - Same as `locked` (convenience property)

**Example:**
```javascript
const state = updater.getState();
console.log("Current state:", state.current);
console.log("Is busy:", state.isBusy);

if (!state.isBusy) {
  // Safe to start a new operation
  updater.download((error, result) => { /* ... */ });
}
```

## State Management

The UpdateController automatically manages its state to **prevent conflicting operations**:

### Protected Operations

- **Cannot run multiple operations simultaneously**: Only one operation (check, download, install) can run at a time
- **Cannot clear downloads during download/install**: Prevents deleting files currently being used
- **Cannot clear backups during install**: Prevents deleting backups being created

### Error Messages

When attempting a conflicting operation, you'll receive clear error messages:

```javascript
// If download is in progress and you try to install:
updater.install((error, result) => {
  console.log(error.message);
  // "Cannot install: downloading operation is in progress"
});
```

### State Values

- `idle` - No operations in progress, ready for new operations
- `checking` - Checking for updates via GitHub API
- `downloading` - Downloading update from GitHub
- `installing` - Installing update (backup, extract, copy, npm install)

### Best Practice

Check state before starting operations, especially in UI applications:

```javascript
const state = updater.getState();
if (state.isBusy) {
  console.log(`Please wait: ${state.current}...`);
} else {
  updater.check((error, result) => { /* ... */ });
}
```

## GitHub Token Setup

For private repositories, create a GitHub Personal Access Token:

1. Go to GitHub → Settings → Developer settings → Personal access tokens
2. Click "Fine-grained tokens" → "Generate new token"
3. Select your repository under "Repository access"
4. Set permissions: **Contents** → **Read-only**
5. Generate token and copy it
6. Add to your `.env` file:

```
GITHUB_TOKEN=github_pat_your_token_here
```

## Integration Example

The [examples/app.js](examples/app.js) file contains **reference code** showing how to integrate the updater into your application. Copy and adapt this code to your own project - it's not meant to be run directly from this package.

```javascript
const http = require("http");
const { createUpdater } = require("@your-org/gh-updater");
require("dotenv").config();

// Initialize updater
const updater = createUpdater({
  owner: "your-github-username",
  repo: "your-app",
  token: process.env.GITHUB_TOKEN,
});

// Create HTTP server with update endpoints
const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (req.url === "/api/update/check" && req.method === "GET") {
    updater.check((error, result) => {
      if (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: error.message }));
      } else {
        res.writeHead(200);
        res.end(JSON.stringify(result));
      }
    });
  } else if (req.url === "/api/update/download" && req.method === "POST") {
    updater.download((error, result) => {
      if (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: error.message }));
      } else {
        res.writeHead(200);
        res.end(JSON.stringify(result));
      }
    });
  } else if (req.url === "/api/update/install" && req.method === "POST") {
    updater.install((error, result) => {
      if (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: error.message }));
      } else {
        res.writeHead(200);
        res.end(JSON.stringify(result));
      }
    });
  } else if (req.url === "/api/update/clear-downloads" && req.method === "DELETE") {
    updater.clearDownloads((error, result) => {
      if (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: error.message }));
      } else {
        res.writeHead(200);
        res.end(JSON.stringify(result));
      }
    });
  } else if (req.url === "/api/update/clear-backups" && req.method === "DELETE") {
    updater.clearBackups((error, result) => {
      if (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: error.message }));
      } else {
        res.writeHead(200);
        res.end(JSON.stringify(result));
      }
    });
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  }
});

server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
```

## Minimum Version Requirements

The updater supports **intelligent upgrade paths** to handle breaking changes between versions.

### Why Use Minimum Versions?

Sometimes a new version requires database migrations, configuration changes, or other breaking changes that don't work when upgrading from very old versions. The minimum version feature allows you to:

1. Require users to upgrade to intermediate versions before jumping to the latest
2. Ensure smooth upgrades without breaking changes
3. Control the upgrade path for major architectural changes

### How It Works

Add a `minimumVersionRequired` field to your `package.json`:

```json
{
  "name": "my-app",
  "version": "2.0.0",
  "minimumVersionRequired": "1.5.0"
}
```

This tells the updater: "You must be on version 1.5.0 or newer to upgrade to version 2.0.0"

### Automatic Handling

The updater automatically handles upgrade paths:

**Scenario 1: Compatible upgrade (can go directly to latest)**
```
Current: 1.5.0
Latest: 2.0.0 (requires ≥1.5.0)
Action: Downloads and installs 2.0.0 directly
```

**Scenario 2: Incompatible upgrade (need intermediate version)**
```
Current: 1.0.0
Latest: 2.0.0 (requires ≥1.5.0)
Action: Downloads 1.5.0 first
After installing 1.5.0: Can then upgrade to 2.0.0
```

### Setting Up Minimum Version Metadata

#### Manual Releases

When creating releases through GitHub's web interface, add the metadata comment to the release description:

1. Go to your repository → Releases → Draft a new release
2. Write your release notes
3. At the end of the description, add the metadata comment:
   ```markdown
   ## Release Notes

   ### Fixed
   - Fixed authentication timeout bug
   - Fixed crash when uploading large files

   ### Added
   - Added dark mode support
   - Added export to PDF feature

   ### Changed
   - Improved search performance

   <!-- UPGRADE_METADATA {
     "minimumVersionRequired": "1.5.0",
     "changelog": {
       "fixed": [
         "Fixed authentication timeout bug",
         "Fixed crash when uploading large files"
       ],
       "added": [
         "Added dark mode support",
         "Added export to PDF feature"
       ],
       "changed": [
         "Improved search performance"
       ],
       "removed": [],
       "security": []
     }
   } -->
   ```
4. Publish the release

**The comment is invisible to users** but the updater can read it.

**Metadata Structure:**
- `minimumVersionRequired` (string, optional) - Minimum version needed to upgrade to this release
- `changelog` (object, optional) - Structured changelog with categories:
  - `fixed` - Bug fixes
  - `added` - New features
  - `changed` - Changes to existing features
  - `removed` - Removed features
  - `security` - Security updates

Access the parsed metadata via `result.releaseMetadata` from the `check()` callback.

#### Fallback: package.json Check

If you forget to add the metadata comment to a release, the updater has a **safety check** during installation:

- During the install process, it reads the `minimumVersionRequired` from the new version's package.json
- If the current version doesn't meet the requirement, installation is blocked with a clear error message
- This prevents accidental incompatible upgrades even if metadata wasn't added to the release

**However**, it's still recommended to add metadata to releases because:
- The check happens during download, not just install (saves bandwidth)
- Users get informed earlier in the process
- Better user experience with clear messaging upfront

#### No Metadata (Backward Compatible)

If you don't add metadata to the release AND don't set `minimumVersionRequired` in package.json, the updater assumes **any version can upgrade to this release**. This is the default behavior and maintains backward compatibility with existing releases.

### Example Upgrade Path

```javascript
// Current version: 1.0.0
updater.check((error, result) => {
  console.log("Current:", result.currentVersion);      // 1.0.0
  console.log("Latest:", result.latestVersion);        // 2.0.0
  console.log("Target:", result.targetVersion);        // 1.5.0
  console.log("Compatible:", result.isLatestCompatible); // false

  if (!result.isLatestCompatible) {
    console.log(`Need to upgrade to ${result.targetVersion} first`);
  }
});

// Downloads 1.5.0 (not 2.0.0)
updater.download((error, result) => {
  console.log("Downloaded:", result.targetVersion);        // 1.5.0
  console.log("Is intermediate:", result.isIntermediateVersion); // true
});

// After installing 1.5.0 and checking again:
updater.check((error, result) => {
  console.log("Current:", result.currentVersion);      // 1.5.0
  console.log("Target:", result.targetVersion);        // 2.0.0
  console.log("Compatible:", result.isLatestCompatible); // true
});
```

### Best Practices

1. **Set minimum version when**:
   - Database schema changes
   - Configuration format changes
   - Breaking API changes
   - Major refactors

2. **Don't set minimum version for**:
   - Bug fixes
   - New features (backward compatible)
   - Performance improvements

3. **Version progression example**:
   ```json
   // v1.0.0 - Initial release
   { "version": "1.0.0" }

   // v1.5.0 - New features, backward compatible
   { "version": "1.5.0" }

   // v2.0.0 - Database migration required
   { "version": "2.0.0", "minimumVersionRequired": "1.5.0" }

   // v2.5.0 - More features, compatible with 2.0.0+
   { "version": "2.5.0", "minimumVersionRequired": "2.0.0" }
   ```

## How It Works

1. **Check**: Queries GitHub Releases API and determines upgrade path
2. **Download**: Downloads the appropriate version (respecting minimum requirements)
3. **Install** (Clean Install Method):
   - Extracts new files from ZIP
   - **Sanity check**: Verifies minimum version requirement from new version's package.json
   - Creates timestamped backup of important files
   - Creates rollback archive of current version
   - **Deletes all existing files/folders** (except preserved ones)
   - Copies all new files from the release
   - **Automatically runs `npm install`** to install dependencies
   - Cleans up temporary files

### Clean Install Method

The updater uses a **clean install** approach:
- All files and directories are deleted except those in `preserveOnUpdate`
- This ensures no orphaned files from previous versions remain
- Preserved files (`.env`, `node_modules`, `.git`, etc.) are never touched
- Critical data is backed up before deletion

**After Update:**
- Dependencies are automatically installed via `npm install`
- Restart your application to use the new version
- If something goes wrong, restore from the backup folder

## Security

- No HTTP server required (uses direct function calls)
- Configuration stored in memory only
- Automatic backups before every update
- Configurable file exclusions to protect sensitive data

## Platform Support

- **Windows**: ✅ Full support
- **Linux**: ✅ Full support
- **macOS**: ✅ Full support
- **Raspberry Pi OS**: ✅ Full support

The updater uses `adm-zip` for cross-platform ZIP extraction, ensuring it works reliably on all Node.js supported platforms without requiring external utilities.

## Error Handling

All methods use standard Node.js error-first callbacks:

```javascript
updater.check((error, result) => {
  if (error) {
    // Handle error
    console.error("Failed to check for updates:", error.message);
    return;
  }

  // Use result
  console.log("Update check successful:", result);
});
```

## Restoring from Backup

If an update fails or causes issues, restore from backup:

1. Find the backup folder in `.gh-updater/backups/backup-v{version}-{timestamp}/`
2. Copy files from the backup folder to your project root
3. Restart your application

**Note:** The `.gh-updater/` directory contains all updater-related files:
- `.gh-updater/downloads/` - Downloaded update files
- `.gh-updater/backups/` - Backup copies of preserved files
- `.gh-updater/rollback/` - Rollback archives for reverting updates

## License

MIT

## Contributing

This is a simple, self-contained package. Feel free to modify for your needs!
