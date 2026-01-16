/**
 * REFERENCE CODE EXAMPLE
 *
 * This is example code showing how to integrate gh-update-service into your application.
 * Copy this code to your own project and adapt it to your needs.
 *
 * DO NOT run this directly from the gh-update-service package.
 * This example is for reference only.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { createUpdater } = require("@jg-electrica/gh-update-service"); // Install via npm first
require("dotenv").config();

const PORT = process.env.PORT || 3001;

// Initialize the GitHub updater
const updater = createUpdater({
  owner: process.env.GITHUB_OWNER,
  repo: process.env.GITHUB_REPO,
  token: process.env.GITHUB_TOKEN, // Optional: for private repos
});

// Your main application server
const server = http.createServer((req, res) => {
  // Serve update panel HTML
  if (
    req.url === "/" ||
    req.url === "/example" ||
    req.url === "/example.html"
  ) {
    const htmlPath = path.join(__dirname, "example.html");
    fs.readFile(htmlPath, "utf8", (err, data) => {
      if (err) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Error loading update panel");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(data);
    });
    return;
  }

  // API endpoints return JSON
  res.setHeader("Content-Type", "application/json");

  if (req.url === "/api" || req.url === "/api/status") {
    res.writeHead(200);
    res.end(
      JSON.stringify({
        name: "My Application",
        version: require("../package.json").version,
        message: "Main application is running",
      })
    );
  } else if (req.url === "/api/health") {
    res.writeHead(200);
    res.end(
      JSON.stringify({
        status: "healthy",
        version: require("../package.json").version,
      })
    );
  }
  // Update endpoints - call updater methods directly
  else if (req.url === "/api/update/check" && req.method === "GET") {
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

        // Restart application after successful install
        console.log(
          `\nUpdate installed: ${result.oldVersion} -> ${result.newVersion}`
        );
        console.log("Restarting application in 3 seconds...\n");

        setTimeout(() => {
          process.exit(0); // Process manager (PM2, systemd, etc.) will restart
        }, 3000);
      }
    });
  } else if (
    req.url === "/api/update/clear-downloads" &&
    req.method === "DELETE"
  ) {
    updater.clearDownloads((error, result) => {
      if (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: error.message }));
      } else {
        res.writeHead(200);
        res.end(JSON.stringify(result));
      }
    });
  } else if (
    req.url === "/api/update/clear-backups" &&
    req.method === "DELETE"
  ) {
    updater.clearBackups((error, result) => {
      if (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: error.message }));
      } else {
        res.writeHead(200);
        res.end(JSON.stringify(result));
      }
    });
  } else if (req.url === "/api/update/rollback" && req.method === "POST") {
    updater.rollback((error, result) => {
      if (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: error.message }));
      } else {
        res.writeHead(200);
        res.end(JSON.stringify(result));

        // Restart application after successful rollback
        console.log(`\nRollback complete: restored version ${result.version}`);
        console.log("Restarting application in 3 seconds...\n");

        setTimeout(() => {
          process.exit(0); // Process manager (PM2, systemd, etc.) will restart
        }, 3000);
      }
    });
  } else if (req.url === "/api/update/rollback-info" && req.method === "GET") {
    const rollbackInfo = updater.getRollbackInfo();
    if (rollbackInfo) {
      res.writeHead(200);
      res.end(JSON.stringify(rollbackInfo));
    } else {
      res.writeHead(404);
      res.end(
        JSON.stringify({ available: false, message: "No rollback available" })
      );
    }
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  }
});

server.listen(PORT, () => {
  console.log("");
  console.log("=================================");
  console.log("Application Started");
  console.log("=================================");
  console.log(`Server: http://localhost:${PORT}`);
  console.log("");
  console.log("Web UI:");
  console.log(`  http://localhost:${PORT}/example.html`);
  console.log("");
  console.log("API endpoints:");
  console.log(`  GET    /api/status`);
  console.log(`  GET    /api/health`);
  console.log(`  GET    /api/update/check`);
  console.log(`  POST   /api/update/download`);
  console.log(`  POST   /api/update/install`);
  console.log(`  POST   /api/update/rollback`);
  console.log(`  GET    /api/update/rollback-info`);
  console.log(`  DELETE /api/update/clear-downloads`);
  console.log(`  DELETE /api/update/clear-backups`);
  console.log("");
  console.log("Press Ctrl+C to stop");
  console.log("=================================");
  console.log("");
});
