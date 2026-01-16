const UpdateController = require("./UpdateController");

/**
 * Initialize the GitHub update system (Singleton)
 * @param {Object} config - Configuration object
 * @param {string} config.owner - GitHub repository owner
 * @param {string} config.repo - GitHub repository name
 * @param {string} [config.token] - GitHub personal access token
 * @param {string[]} [config.preserveOnUpdate] - Files/folders to preserve during updates
 * @param {string[]} [config.backupFiles] - Files to backup before update
 * @returns {UpdateController} Update controller instance
 * @throws {Error} If an UpdateController instance already exists
 */
function createUpdater(config) {
  // Check if instance already exists
  const existingInstance = UpdateController.getInstance();
  if (existingInstance) {
    throw new Error(
      "UpdateController already initialized. Only one updater instance is allowed per application."
    );
  }

  return new UpdateController(config);
}

/**
 * Get the existing UpdateController instance
 * @returns {UpdateController|null} The UpdateController instance or null if not created
 */
function getUpdater() {
  return UpdateController.getInstance();
}

module.exports = {
  createUpdater,
  getUpdater,
  UpdateController,
};
