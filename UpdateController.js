const https = require("https");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const AdmZip = require("adm-zip");

class UpdateController {
  static instance = null;

  constructor(config) {
    // Enforce singleton pattern
    if (UpdateController.instance) {
      throw new Error(
        "UpdateController instance already exists. Only one updater is allowed per application."
      );
    }

    if (!config.owner || !config.repo) {
      throw new Error("GitHub owner and repo are required");
    }

    // Updater directory paths (must be set first)
    this.updaterDir = path.join(process.cwd(), ".gh-updater");
    this.downloadsDir = path.join(this.updaterDir, "downloads");
    this.backupsDir = path.join(this.updaterDir, "backups");
    this.rollbackDir = path.join(this.updaterDir, "rollback");

    // Build preserveOnUpdate list - always include .gh-updater
    const userPreserveFiles = config.preserveOnUpdate || [".env", ".git"];
    const preserveOnUpdate = userPreserveFiles.includes(".gh-updater")
      ? userPreserveFiles
      : [...userPreserveFiles, ".gh-updater"];

    this.config = {
      owner: config.owner,
      repo: config.repo,
      token: config.token || "",
      preserveOnUpdate,
    };

    // State management
    this.state = {
      current: "idle", // idle, checking, downloading, installing
      locked: false,   // Prevents concurrent operations
    };

    // Set the singleton instance
    UpdateController.instance = this;
  }

  /**
   * Check for available updates
   * @param {Function} callback - Callback (error, result)
   */
  check(callback) {
    this._validateCallback(callback, 'check');

    // Check if another operation is in progress
    if (this.state.locked) {
      callback(
        new Error(
          `Cannot check for updates: ${this.state.current} operation is in progress`
        ),
        null
      );
      return;
    }

    // Lock state
    this._setState("checking");

    const currentVersion = this._getCurrentVersion();

    // Find compatible upgrade path
    this._findUpgradePath(currentVersion, (error, upgradePathResult) => {
      // Unlock state
      this._setState("idle");

      if (error) {
        callback(error, null);
        return;
      }

      const downloadedUpdate = this._getDownloadedUpdate();
      const targetVersion = upgradePathResult.targetVersion || upgradePathResult.latestVersion;

      callback(null, {
        currentVersion,
        latestVersion: upgradePathResult.latestVersion,
        targetVersion: upgradePathResult.targetVersion,
        updateAvailable: upgradePathResult.updateAvailable,
        isLatestCompatible: upgradePathResult.isLatestCompatible,
        releaseName: upgradePathResult.releaseName,
        releaseNotes: upgradePathResult.releaseNotes,
        publishedAt: upgradePathResult.publishedAt,
        downloadUrl: upgradePathResult.downloadUrl,
        minimumVersionRequired: upgradePathResult.minimumVersionRequired,
        latestMinimumVersionRequired: upgradePathResult.latestMinimumVersionRequired,
        downloaded: downloadedUpdate?.version === targetVersion,
        downloadedVersion: downloadedUpdate?.version || null,
      });
    });
  }

  /**
   * Download the latest compatible update
   * @param {Function} callback - Callback (error, result)
   */
  download(callback) {
    this._validateCallback(callback, 'download');

    // Check if another operation is in progress
    if (this.state.locked) {
      callback(
        new Error(
          `Cannot download: ${this.state.current} operation is in progress`
        ),
        null
      );
      return;
    }

    // Lock state
    this._setState("downloading");

    const currentVersion = this._getCurrentVersion();

    // Find compatible upgrade path
    this._findUpgradePath(currentVersion, (error, upgradePathResult) => {
      if (error) {
        // Unlock state on error
        this._setState("idle");
        callback(error, null);
        return;
      }

      // Check if update is available
      if (!upgradePathResult.updateAvailable || !upgradePathResult.targetVersion) {
        this._setState("idle");
        callback(null, {
          success: false,
          message: upgradePathResult.targetVersion
            ? "Already running latest compatible version"
            : `Cannot upgrade from version ${currentVersion}. ${upgradePathResult.releaseNotes}`,
          isLatestCompatible: upgradePathResult.isLatestCompatible,
          latestVersion: upgradePathResult.latestVersion,
          minimumVersionRequired: upgradePathResult.minimumVersionRequired,
        });
        return;
      }

      const targetRelease = upgradePathResult.release;
      const targetVersion = upgradePathResult.targetVersion;

      // Download the target version (not necessarily the latest)
      this._downloadSourceCode(
        targetRelease.zipball_url,
        targetRelease.tag_name,
        targetVersion,
        (downloadError, result) => {
          // Unlock state when download completes
          this._setState("idle");

          if (downloadError) {
            callback(downloadError, null);
          } else {
            // Add upgrade path info to result
            callback(null, {
              ...result,
              targetVersion,
              latestVersion: upgradePathResult.latestVersion,
              isLatestCompatible: upgradePathResult.isLatestCompatible,
              isIntermediateVersion: targetVersion !== upgradePathResult.latestVersion,
            });
          }
        }
      );
    });
  }

  /**
   * Install the downloaded update
   * @param {Function} callback - Callback (error, result)
   */
  install(callback) {
    this._validateCallback(callback, 'install');

    // Check if another operation is in progress
    if (this.state.locked) {
      callback(
        new Error(
          `Cannot install: ${this.state.current} operation is in progress`
        ),
        null
      );
      return;
    }

    const downloadedUpdate = this._getDownloadedUpdate();

    if (!downloadedUpdate) {
      callback(new Error("No update downloaded"), null);
      return;
    }

    // Lock state
    this._setState("installing");

    const currentVersion = this._getCurrentVersion();
    this._installUpdate(downloadedUpdate, currentVersion, (error, result) => {
      // Unlock state when install completes
      this._setState("idle");
      callback(error, result);
    });
  }

  /**
   * Clear downloaded update files
   * @param {Function} callback - Callback (error, result)
   */
  clearDownloads(callback) {
    this._validateCallback(callback, 'clearDownloads');

    // Prevent clearing downloads during download or install
    if (this.state.current === "downloading") {
      callback(
        new Error("Cannot clear downloads: download operation is in progress"),
        null
      );
      return;
    }

    if (this.state.current === "installing") {
      callback(
        new Error("Cannot clear downloads: install operation is in progress"),
        null
      );
      return;
    }

    if (!fs.existsSync(this.downloadsDir)) {
      callback(null, {
        success: true,
        message: "No downloads to clear",
      });
      return;
    }

    try {
      const files = fs.readdirSync(this.downloadsDir);
      let deletedCount = 0;

      files.forEach((file) => {
        const filePath = path.join(this.downloadsDir, file);
        try {
          const stats = fs.statSync(filePath);
          if (stats.isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(filePath);
          }
          deletedCount++;
        } catch (error) {
          console.warn(`Failed to delete download file ${file}: ${error.message}`);
        }
      });

      callback(null, {
        success: true,
        message: `Cleared ${deletedCount} download(s)`,
        deletedCount,
      });
    } catch (error) {
      callback(error, null);
    }
  }

  /**
   * Get the current state of the updater
   * @returns {Object} State object with current status and locked flag
   */
  getState() {
    return {
      current: this.state.current,
      locked: this.state.locked,
      isBusy: this.state.locked,
    };
  }

  /**
   * Rollback to the previous version
   * @param {Function} callback - Callback (error, result)
   */
  rollback(callback) {
    this._validateCallback(callback, 'rollback');

    // Check if another operation is in progress
    if (this.state.locked) {
      callback(
        new Error(
          `Cannot rollback: ${this.state.current} operation is in progress`
        ),
        null
      );
      return;
    }

    // Lock state
    this._setState("installing");

    if (!fs.existsSync(this.rollbackDir)) {
      this._setState("idle");
      callback(new Error("No rollback archive found"), null);
      return;
    }

    // Find the most recent rollback ZIP
    const rollbackFiles = fs.readdirSync(this.rollbackDir).filter(f => f.endsWith(".zip"));

    if (rollbackFiles.length === 0) {
      this._setState("idle");
      callback(new Error("No rollback archive found"), null);
      return;
    }

    // Use the most recent rollback file (sorted by name which includes version)
    const rollbackZipName = rollbackFiles.sort().reverse()[0];
    const rollbackZipPath = path.join(this.rollbackDir, rollbackZipName);

    // Extract version from filename (e.g., "rollback-v1.0.0.zip")
    const versionMatch = rollbackZipName.match(/rollback-v(.+)\.zip/);
    const rollbackVersion = versionMatch ? versionMatch[1] : "unknown";

    console.log(`Rolling back to version ${rollbackVersion}...`);

    // Perform the rollback (no backup needed, this is already a rollback)
    this._performRollback(rollbackZipPath, null, (error) => {
      this._setState("idle");

      if (error) {
        callback(error, null);
      } else {
        // After successful rollback, remove the rollback ZIP
        try {
          fs.unlinkSync(rollbackZipPath);
        } catch (e) {
          // Ignore cleanup errors
        }

        callback(null, {
          success: true,
          message: `Successfully rolled back to version ${rollbackVersion}`,
          version: rollbackVersion,
        });
      }
    });
  }

  /**
   * Clear backup files
   * @param {Function} callback - Callback (error, result)
   */
  clearBackups(callback) {
    this._validateCallback(callback, 'clearBackups');

    // Prevent clearing backups during install (backups are being created)
    if (this.state.current === "installing") {
      callback(
        new Error("Cannot clear backups: install operation is in progress"),
        null
      );
      return;
    }

    // Clear both backups and rollback directories
    let totalDeleted = 0;

    try {
      // Clear backups directory
      if (fs.existsSync(this.backupsDir)) {
        const files = fs.readdirSync(this.backupsDir);
        files.forEach((file) => {
          const filePath = path.join(this.backupsDir, file);
          try {
            const stats = fs.statSync(filePath);
            if (stats.isDirectory()) {
              fs.rmSync(filePath, { recursive: true, force: true });
            } else {
              fs.unlinkSync(filePath);
            }
            totalDeleted++;
          } catch (error) {
            console.warn(`Failed to delete backup file ${file}: ${error.message}`);
          }
        });
      }

      // Clear rollback directory
      if (fs.existsSync(this.rollbackDir)) {
        const files = fs.readdirSync(this.rollbackDir);
        files.forEach((file) => {
          const filePath = path.join(this.rollbackDir, file);
          try {
            fs.unlinkSync(filePath);
            totalDeleted++;
          } catch (error) {
            console.warn(`Failed to delete rollback file ${file}: ${error.message}`);
          }
        });
      }

      if (totalDeleted === 0) {
        callback(null, {
          success: true,
          message: "No backups to clear",
        });
        return;
      }

      callback(null, {
        success: true,
        message: `Cleared ${totalDeleted} backup(s)`,
        deletedCount: totalDeleted,
      });
    } catch (error) {
      callback(error, null);
    }
  }

  /**
   * Get rollback information
   * @returns {Object|null} Rollback info or null if no rollback available
   */
  getRollbackInfo() {
    if (!fs.existsSync(this.rollbackDir)) {
      return null;
    }

    const rollbackFiles = fs.readdirSync(this.rollbackDir).filter(f => f.endsWith(".zip"));

    if (rollbackFiles.length === 0) {
      return null;
    }

    const rollbackZipName = rollbackFiles.sort().reverse()[0];
    const rollbackZipPath = path.join(this.rollbackDir, rollbackZipName);
    const versionMatch = rollbackZipName.match(/rollback-v(.+)\.zip/);
    const rollbackVersion = versionMatch ? versionMatch[1] : "unknown";

    const stats = fs.statSync(rollbackZipPath);

    return {
      available: true,
      version: rollbackVersion,
      path: rollbackZipPath,
      size: stats.size,
      createdAt: stats.mtime,
    };
  }

  // Private helper methods
  _validateCallback(callback, methodName) {
    if (typeof callback !== 'function') {
      throw new TypeError(`${methodName} requires a callback function, but received ${typeof callback}`);
    }
  }

  _setState(newState) {
    this.state.current = newState;
    this.state.locked = newState !== "idle";
  }

  _performRollback(rollbackZipPath, backupPath, callback) {
    try {
      console.log("Deleting current version files...");

      // Delete all files except preserveOnUpdate files
      const currentFiles = fs.readdirSync(process.cwd());
      currentFiles.forEach((file) => {
        if (this.config.preserveOnUpdate.includes(file)) {
          return;
        }

        const filePath = path.join(process.cwd(), file);
        try {
          const stats = fs.statSync(filePath);
          if (stats.isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(filePath);
          }
        } catch (error) {
          console.warn(`Failed to delete ${file} during rollback cleanup: ${error.message}`);
        }
      });

      console.log("Extracting rollback archive...");

      // Extract rollback ZIP
      const rollbackZip = new AdmZip(rollbackZipPath);
      rollbackZip.extractAllTo(process.cwd(), true);

      // If backup path provided, restore preserveOnUpdate files from backup
      if (backupPath && fs.existsSync(backupPath)) {
        console.log("Restoring preserved files from backup...");
        const backupFiles = fs.readdirSync(backupPath);

        backupFiles.forEach((file) => {
          const srcPath = path.join(backupPath, file);
          const destPath = path.join(process.cwd(), file);

          try {
            const stats = fs.statSync(srcPath);
            if (stats.isDirectory()) {
              if (fs.existsSync(destPath)) {
                fs.rmSync(destPath, { recursive: true, force: true });
              }
              this._copyDirectory(srcPath, destPath);
            } else {
              fs.copyFileSync(srcPath, destPath);
            }
          } catch (error) {
            console.error(`Failed to restore ${file}:`, error.message);
          }
        });
      }

      console.log("Running npm install for rolled back version...");

      // Run npm install for the rolled-back version
      try {
        execSync("npm install", {
          cwd: process.cwd(),
          stdio: "inherit"
        });
        console.log("Dependencies installed successfully");
      } catch (npmError) {
        console.error("Warning: npm install failed during rollback:", npmError.message);
        // Continue anyway - rollback partially succeeded
      }

      console.log("Rollback completed successfully");
      callback(null);
    } catch (error) {
      callback(error);
    }
  }


  _getCurrentVersion() {
    try {
      const packageJsonPath = path.join(process.cwd(), "package.json");

      // Check if package.json exists
      if (!fs.existsSync(packageJsonPath)) {
        throw new Error("package.json not found in current directory");
      }

      // Read and parse package.json
      const fileContent = fs.readFileSync(packageJsonPath, "utf8");
      const packageJson = JSON.parse(fileContent);

      // Validate that version field exists
      if (!packageJson.version || typeof packageJson.version !== "string") {
        throw new Error("package.json is missing or has invalid version field");
      }

      return packageJson.version;
    } catch (error) {
      // Re-throw with context
      if (error instanceof SyntaxError) {
        throw new Error(`Failed to parse package.json: Invalid JSON format - ${error.message}`);
      }
      throw new Error(`Failed to read current version: ${error.message}`);
    }
  }

  _getDownloadedUpdate() {
    const updateInfoPath = path.join(this.downloadsDir, "update-info.json");

    if (fs.existsSync(updateInfoPath)) {
      try {
        return JSON.parse(fs.readFileSync(updateInfoPath, "utf8"));
      } catch (error) {
        return null;
      }
    }
    return null;
  }

  _compareVersions(v1, v2) {
    const parts1 = v1.split(".").map(Number);
    const parts2 = v2.split(".").map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const part1 = parts1[i] || 0;
      const part2 = parts2[i] || 0;

      if (part1 > part2) return 1;
      if (part1 < part2) return -1;
    }

    return 0;
  }

  /**
   * Parse release body to separate release notes from metadata
   * @param {string} releaseBody - The release body text (markdown with HTML comment)
   * @returns {Object} Parsed release information
   */
  _parseReleaseBody(releaseBody) {
    if (!releaseBody) {
      return {
        releaseNotes: "",
        metadata: null,
      };
    }

    // Extract metadata from HTML comment
    const metadataMatch = releaseBody.match(/<!--\s*UPGRADE_METADATA\s+([\s\S]*?)\s*-->/);
    let metadata = null;

    if (metadataMatch) {
      try {
        metadata = JSON.parse(metadataMatch[1]);
      } catch (error) {
        console.warn("Failed to parse UPGRADE_METADATA:", error.message);
      }
    }

    // Remove HTML comment to get clean release notes
    const releaseNotes = releaseBody.replace(/<!--\s*UPGRADE_METADATA\s+[\s\S]*?\s*-->/, "").trim();

    return {
      releaseNotes,
      metadata,
    };
  }

  _makeGitHubRequest(url, callback) {
    const options = {
      headers: {
        "User-Agent": "GH-Updater",
      },
    };

    if (this.config.token) {
      options.headers.Authorization = `token ${this.config.token}`;
    }

    const req = https.get(url, options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        if (res.statusCode === 401) {
          callback(new Error("Authentication failed: Invalid GitHub token"), null);
          return;
        }

        if (res.statusCode === 403) {
          callback(new Error("GitHub API rate limit exceeded or access forbidden"), null);
          return;
        }

        if (res.statusCode === 404) {
          callback(new Error("No releases found for this repository"), null);
          return;
        }

        if (res.statusCode === 429) {
          callback(new Error("GitHub API rate limit exceeded - please try again later"), null);
          return;
        }

        if (res.statusCode !== 200) {
          callback(new Error(`GitHub API returned status ${res.statusCode}`), null);
          return;
        }

        try {
          callback(null, JSON.parse(data));
        } catch (error) {
          callback(new Error(`Failed to parse GitHub API response: ${error.message}`), null);
        }
      });
    });

    // Set timeout (30 seconds)
    req.setTimeout(30000, () => {
      req.destroy();
      callback(new Error("GitHub API request timed out after 30 seconds"), null);
    });

    req.on("error", (error) => {
      callback(error, null);
    });
  }

  _downloadSourceCode(zipballUrl, tagName, version, callback) {
    const fileName = `${this.config.repo}-${tagName}.zip`;
    const filePath = path.join(this.downloadsDir, fileName);

    // Create downloads directory
    if (!fs.existsSync(this.downloadsDir)) {
      fs.mkdirSync(this.downloadsDir, { recursive: true });
    }

    // Save version info
    const versionInfoPath = path.join(this.downloadsDir, "update-info.json");
    fs.writeFileSync(
      versionInfoPath,
      JSON.stringify(
        {
          version,
          tagName,
          fileName,
          downloadedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );

    const downloadOptions = {
      headers: {
        "User-Agent": "GH-Updater",
      },
    };

    if (this.config.token) {
      downloadOptions.headers.Authorization = `token ${this.config.token}`;
    }

    const downloadReq = https.get(zipballUrl, downloadOptions, (res) => {
      // Handle redirects
      if (res.statusCode === 302 || res.statusCode === 301) {
        const redirectUrl = res.headers.location;

        // Validate redirect URL to prevent SSRF attacks
        if (!redirectUrl) {
          callback(new Error("Redirect received but no location header provided"), null);
          return;
        }

        // Ensure redirect stays within GitHub's domain or AWS (where GitHub stores releases)
        const allowedDomains = [
          'github.com',
          'githubusercontent.com',
          'github-releases.githubusercontent.com',
          'objects.githubusercontent.com',
          'codeload.github.com'
        ];

        // Parse URL to properly validate hostname
        let parsedUrl;
        try {
          parsedUrl = new URL(redirectUrl);
        } catch (error) {
          callback(new Error(`Invalid redirect URL: ${error.message}`), null);
          return;
        }

        // Check if hostname ends with allowed domain or is exactly an allowed domain
        const hostname = parsedUrl.hostname.toLowerCase();
        const isAllowedDomain = allowedDomains.some(domain =>
          hostname === domain || hostname.endsWith('.' + domain)
        );

        // Also allow amazonaws.com for GitHub production release assets
        const isAWSAllowed = hostname.includes('github-production-release-asset') &&
                             hostname.endsWith('.amazonaws.com');

        if (!isAllowedDomain && !isAWSAllowed) {
          callback(
            new Error(`Redirect to untrusted domain blocked for security: ${hostname}`),
            null
          );
          return;
        }

        // Follow redirect with error handling and timeout
        const redirectReq = https.get(redirectUrl, (redirectRes) => {
          this._saveFile(redirectRes, filePath, callback);
        });

        // Set timeout on redirect request (60 seconds for downloads)
        redirectReq.setTimeout(60000, () => {
          redirectReq.destroy();
          callback(new Error("Download request timed out after 60 seconds"), null);
        });

        redirectReq.on("error", (error) => {
          callback(new Error(`Download failed: ${error.message}`), null);
        });
      } else {
        this._saveFile(res, filePath, callback);
      }
    });

    // Set timeout on initial request (30 seconds)
    downloadReq.setTimeout(30000, () => {
      downloadReq.destroy();
      callback(new Error("Download request timed out after 30 seconds"), null);
    });

    downloadReq.on("error", (error) => {
      callback(new Error(`Download failed: ${error.message}`), null);
    });
  }

  _saveFile(response, filePath, callback) {
    const fileStream = fs.createWriteStream(filePath);
    let downloadedSize = 0;

    response.on("data", (chunk) => {
      downloadedSize += chunk.length;
    });

    response.pipe(fileStream);

    fileStream.on("finish", () => {
      fileStream.close();
      callback(null, {
        success: true,
        message: "Update downloaded successfully",
        size: downloadedSize,
      });
    });

    fileStream.on("error", (error) => {
      callback(error, null);
    });
  }

  _installUpdate(updateInfo, currentVersion, callback) {
    const newVersionZipPath = path.join(this.downloadsDir, updateInfo.fileName);

    if (!fs.existsSync(newVersionZipPath)) {
      callback(new Error("Update file not found"), null);
      return;
    }

    const timestamp = Date.now();
    const backupName = `backup-v${currentVersion}-${timestamp}`;
    const backupPath = path.join(this.backupsDir, backupName);
    const rollbackZipPath = path.join(this.rollbackDir, `rollback-v${currentVersion}.zip`);

    try {
      console.log("Starting update installation...");

      // Step 0: Extract new version to temporary location for verification
      console.log("Extracting new version...");
      const extractDir = path.join(this.downloadsDir, "extracted");
      if (fs.existsSync(extractDir)) {
        fs.rmSync(extractDir, { recursive: true, force: true });
      }
      fs.mkdirSync(extractDir, { recursive: true });

      const newVersionZip = new AdmZip(newVersionZipPath);
      newVersionZip.extractAllTo(extractDir, true);

      // Find extracted folder
      const extractedContents = fs.readdirSync(extractDir);
      const extractedFolder = extractedContents.find((item) => {
        const itemPath = path.join(extractDir, item);
        const stats = fs.statSync(itemPath);
        // Validate folder name to prevent path traversal
        if (item.includes("..") || path.isAbsolute(item)) {
          throw new Error("Invalid folder name in archive: potential path traversal detected");
        }
        return stats.isDirectory();
      });

      if (!extractedFolder) {
        throw new Error("Could not find extracted folder in archive");
      }

      const extractedPath = path.join(extractDir, extractedFolder);

      // Step 1: Sanity check - verify minimum version requirement from new version's package.json
      console.log("Verifying compatibility with new version...");
      const newPackageJsonPath = path.join(extractedPath, "package.json");
      if (fs.existsSync(newPackageJsonPath)) {
        try {
          const newPackageJson = JSON.parse(fs.readFileSync(newPackageJsonPath, "utf8"));
          const minimumVersionRequired = newPackageJson.minimumVersionRequired;

          if (minimumVersionRequired) {
            const currentMeetsMinimum = this._compareVersions(currentVersion, minimumVersionRequired) >= 0;
            if (!currentMeetsMinimum) {
              // Current version doesn't meet minimum requirement
              fs.rmSync(extractDir, { recursive: true, force: true });
              callback(
                new Error(
                  `Cannot install version ${updateInfo.version}: requires minimum version ${minimumVersionRequired}, but current version is ${currentVersion}. Please upgrade to an intermediate version first.`
                ),
                null
              );
              return;
            }
            console.log(`Version compatibility verified: ${currentVersion} >= ${minimumVersionRequired}`);
          }
        } catch (pkgError) {
          console.warn("Warning: Could not verify minimum version requirement:", pkgError.message);
          // Continue with installation - this is just a sanity check
        }
      }

      // Step 2: Create backup of preserveOnUpdate files + package.json
      console.log("Creating backup of preserved files...");
      if (!fs.existsSync(this.backupsDir)) {
        fs.mkdirSync(this.backupsDir, { recursive: true });
      }
      fs.mkdirSync(backupPath, { recursive: true });

      // Always backup package.json + user's preserveOnUpdate files
      // Exclude updater directory (.gh-updater) from backup to prevent infinite nesting
      const filesToBackup = new Set([
        ...this.config.preserveOnUpdate.filter(f => f !== ".gh-updater"),
        "package.json"
      ]);

      filesToBackup.forEach((file) => {
        const srcPath = path.join(process.cwd(), file);
        if (fs.existsSync(srcPath)) {
          const destPath = path.join(backupPath, file);
          const destDir = path.dirname(destPath);
          if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
          }

          // Copy file or directory
          const stats = fs.statSync(srcPath);
          if (stats.isDirectory()) {
            this._copyDirectory(srcPath, destPath);
          } else {
            fs.copyFileSync(srcPath, destPath);
          }
        }
      });

      // Step 3: ZIP current version for rollback (excludes preserveOnUpdate files)
      console.log("Creating rollback archive...");
      if (!fs.existsSync(this.rollbackDir)) {
        fs.mkdirSync(this.rollbackDir, { recursive: true });
      }

      const rollbackZip = new AdmZip();
      const currentFiles = fs.readdirSync(process.cwd());

      currentFiles.forEach((file) => {
        // Skip preserved files
        if (this.config.preserveOnUpdate.includes(file)) {
          return;
        }

        const filePath = path.join(process.cwd(), file);
        try {
          const stats = fs.statSync(filePath);
          if (stats.isDirectory()) {
            rollbackZip.addLocalFolder(filePath, file);
          } else {
            rollbackZip.addLocalFile(filePath);
          }
        } catch (error) {
          console.warn(`Failed to add ${file} to rollback archive: ${error.message}`);
        }
      });

      rollbackZip.writeZip(rollbackZipPath);
      console.log(`Rollback archive created: ${rollbackZipPath}`);

      // Step 4: Delete old files (except preserved ones)
      console.log("Removing old version files...");
      currentFiles.forEach((file) => {
        // Skip preserved files/directories
        if (this.config.preserveOnUpdate.includes(file)) {
          return;
        }

        const filePath = path.join(process.cwd(), file);
        try {
          const stats = fs.statSync(filePath);
          if (stats.isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(filePath);
          }
        } catch (error) {
          console.warn(`Failed to delete old file ${file}: ${error.message}`);
        }
      });

      // Step 5: Copy new version files
      console.log("Installing new version files...");
      const filesToCopy = fs.readdirSync(extractedPath);

      filesToCopy.forEach((file) => {
        const srcPath = path.join(extractedPath, file);
        const destPath = path.join(process.cwd(), file);

        try {
          const stats = fs.statSync(srcPath);

          if (stats.isDirectory()) {
            this._copyDirectory(srcPath, destPath);
          } else {
            fs.copyFileSync(srcPath, destPath);
          }
        } catch (error) {
          console.error(`Failed to copy ${file}:`, error.message);
        }
      });

      // Step 6: Restore preserveOnUpdate files (except package.json - use new one)
      console.log("Restoring preserved files...");
      filesToBackup.forEach((file) => {
        if (file === "package.json") {
          return; // Use new package.json
        }

        const srcPath = path.join(backupPath, file);
        const destPath = path.join(process.cwd(), file);

        if (fs.existsSync(srcPath)) {
          try {
            const stats = fs.statSync(srcPath);
            if (stats.isDirectory()) {
              // Remove new version of this directory if it exists
              if (fs.existsSync(destPath)) {
                fs.rmSync(destPath, { recursive: true, force: true });
              }
              this._copyDirectory(srcPath, destPath);
            } else {
              fs.copyFileSync(srcPath, destPath);
            }
          } catch (error) {
            console.error(`Failed to restore ${file}:`, error.message);
          }
        }
      });

      // Step 7: Install dependencies
      console.log("Installing dependencies...");
      try {
        execSync("npm install", {
          cwd: process.cwd(),
          stdio: "inherit"
        });
        console.log("Dependencies installed successfully");
      } catch (npmError) {
        console.error("npm install failed:", npmError.message);
        console.error("Rolling back to previous version...");

        // Rollback on npm install failure
        this._performRollback(rollbackZipPath, backupPath, (rollbackError) => {
          if (rollbackError) {
            callback(
              new Error(`Update failed: npm install error AND rollback failed: ${rollbackError.message}`),
              null
            );
          } else {
            callback(
              new Error(`Update failed: npm install error. Successfully rolled back to v${currentVersion}`),
              null
            );
          }
        });
        return;
      }

      // Step 8: Cleanup on success
      console.log("Cleaning up...");
      fs.rmSync(extractDir, { recursive: true, force: true });
      fs.unlinkSync(newVersionZipPath);
      fs.unlinkSync(path.join(this.downloadsDir, "update-info.json"));

      // Delete the backup (preserveOnUpdate files) but keep rollback ZIP
      fs.rmSync(backupPath, { recursive: true, force: true });

      console.log("Update completed successfully!");
      callback(null, {
        success: true,
        message: "Update installed successfully",
        oldVersion: currentVersion,
        newVersion: updateInfo.version,
        rollbackAvailable: true,
        rollbackPath: rollbackZipPath,
      });
    } catch (error) {
      console.error("Update installation failed:", error.message);

      // Attempt rollback if rollback ZIP was created
      if (fs.existsSync(rollbackZipPath)) {
        console.error("Attempting to roll back...");
        this._performRollback(rollbackZipPath, backupPath, (rollbackError) => {
          if (rollbackError) {
            callback(
              new Error(`Update failed: ${error.message} AND rollback failed: ${rollbackError.message}`),
              null
            );
          } else {
            callback(
              new Error(`Update failed: ${error.message}. Successfully rolled back to v${currentVersion}`),
              null
            );
          }
        });
      } else {
        callback(error, null);
      }
    }
  }

  _copyDirectory(src, dest) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src);

    entries.forEach((entry) => {
      const srcPath = path.join(src, entry);
      const destPath = path.join(dest, entry);
      const stats = fs.statSync(srcPath);

      if (stats.isDirectory()) {
        this._copyDirectory(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    });
  }

  /**
   * Find compatible upgrade path for current version
   * @param {string} currentVersion - The current application version
   * @param {Function} callback - Callback (error, result)
   * @private
   */
  _findUpgradePath(currentVersion, callback) {
    // First, fetch latest release
    const latestApiUrl = `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/releases/latest`;

    this._makeGitHubRequest(latestApiUrl, (latestError, latestRelease) => {
      if (latestError) {
        callback(latestError, null);
        return;
      }

      const latestVersion = latestRelease.tag_name.replace(/^v/, "");
      const latestParsed = this._parseReleaseBody(latestRelease.body);
      const latestMinVersion = latestParsed.metadata?.minimumVersionRequired || null;

      // Check if we can upgrade directly to latest
      const canUpgradeToLatest = !latestMinVersion ||
                                  this._compareVersions(currentVersion, latestMinVersion) >= 0;

      if (canUpgradeToLatest) {
        // Can upgrade directly to latest
        callback(null, {
          latestVersion,
          targetVersion: latestVersion,
          updateAvailable: this._compareVersions(latestVersion, currentVersion) > 0,
          isLatestCompatible: true,
          releaseName: latestRelease.name,
          releaseNotes: latestParsed.releaseNotes,
          releaseMetadata: latestParsed.metadata,
          publishedAt: latestRelease.published_at,
          downloadUrl: latestRelease.html_url,
          minimumVersionRequired: latestMinVersion,
          release: latestRelease,
        });
        return;
      }

      // Cannot upgrade directly - need to find intermediate version
      // Fetch all releases to find compatible one
      const allReleasesUrl = `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/releases?per_page=30`;

      this._makeGitHubRequest(allReleasesUrl, (allError, allReleases) => {
        if (allError) {
          callback(allError, null);
          return;
        }

        // Sort releases by version (newest first)
        const sortedReleases = allReleases
          .map(release => {
            const parsed = this._parseReleaseBody(release.body);
            return {
              version: release.tag_name.replace(/^v/, ""),
              minimumVersionRequired: parsed.metadata?.minimumVersionRequired || null,
              parsed,
              release
            };
          })
          .sort((a, b) => this._compareVersions(b.version, a.version));

        // Find the highest version we can upgrade to
        let targetRelease = null;

        for (const rel of sortedReleases) {
          // Skip versions older than or equal to current
          if (this._compareVersions(rel.version, currentVersion) <= 0) {
            continue;
          }

          // Check if we meet minimum version requirement
          const canUpgrade = !rel.minimumVersionRequired ||
                            this._compareVersions(currentVersion, rel.minimumVersionRequired) >= 0;

          if (canUpgrade) {
            targetRelease = rel;
            break;
          }
        }

        if (targetRelease) {
          // Found a compatible intermediate version
          callback(null, {
            latestVersion,
            targetVersion: targetRelease.version,
            updateAvailable: true,
            isLatestCompatible: false,
            releaseName: targetRelease.release.name,
            releaseNotes: targetRelease.parsed.releaseNotes,
            releaseMetadata: targetRelease.parsed.metadata,
            publishedAt: targetRelease.release.published_at,
            downloadUrl: targetRelease.release.html_url,
            minimumVersionRequired: targetRelease.minimumVersionRequired,
            latestMinimumVersionRequired: latestMinVersion,
            release: targetRelease.release,
          });
        } else {
          // No compatible version found
          callback(null, {
            latestVersion,
            targetVersion: null,
            updateAvailable: false,
            isLatestCompatible: false,
            releaseName: latestRelease.name,
            releaseNotes: `Cannot upgrade from version ${currentVersion}. Minimum version required for latest release: ${latestMinVersion || 'unknown'}`,
            publishedAt: latestRelease.published_at,
            downloadUrl: latestRelease.html_url,
            minimumVersionRequired: latestMinVersion,
            release: null,
          });
        }
      });
    });
  }

  /**
   * Get the singleton instance
   * @returns {UpdateController|null} The UpdateController instance or null if not created
   */
  static getInstance() {
    return UpdateController.instance;
  }

  /**
   * Reset the singleton instance (useful for testing)
   * @private
   */
  static _resetInstance() {
    UpdateController.instance = null;
  }
}

module.exports = UpdateController;
