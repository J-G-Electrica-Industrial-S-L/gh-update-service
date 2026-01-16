# Examples

This folder contains example implementations showing how to use the GitHub Updater package.

## Quick Start

Run the example application:

```bash
npm run example
```

## app.js

A complete example showing how to integrate the updater into a Node.js HTTP server application.

**Features:**

- Web UI at http://localhost:3001/example.html
- Main application API endpoints
- Update check endpoint (GET /api/update/check)
- Update download endpoint (POST /api/update/download)
- Update install endpoint (POST /api/update/install)
- Rollback endpoint (POST /api/update/rollback)
- Rollback info endpoint (GET /api/update/rollback-info)
- Clear downloads endpoint (DELETE /api/update/clear-downloads)
- Clear backups endpoint (DELETE /api/update/clear-backups)

**Setup:**

1. Create a `.env` file in the root directory (copy from `.env.example`):
   ```
   GITHUB_OWNER=your-github-username
   GITHUB_REPO=your-repo-name
   GITHUB_TOKEN=github_pat_your_token_here  # Optional: only for private repos
   PORT=3001
   ```
2. Run the example:
   ```bash
   npm run example
   ```

**Test the API:**

- Check: `curl http://localhost:3001/api/update/check`
- Download: `curl -X POST http://localhost:3001/api/update/download`
- Install: `curl -X POST http://localhost:3001/api/update/install`
- Rollback: `curl -X POST http://localhost:3001/api/update/rollback`
- Rollback info: `curl http://localhost:3001/api/update/rollback-info`
- Clear downloads: `curl -X DELETE http://localhost:3001/api/update/clear-downloads`
- Clear backups: `curl -X DELETE http://localhost:3001/api/update/clear-backups`

## example.html

A simple web UI for managing updates through the API.

**Usage:**

Method 1 (Recommended): Served by app.js

1. Start the app.js server: `npm run example`
2. Open http://localhost:3001/example.html in your browser
3. The panel automatically connects to the API

Method 2: Open as local file

1. Start the app.js server (default port: 3001)
2. Open example.html directly in a web browser
3. The panel automatically connects to http://localhost:3001

**Port Configuration:**

The update panel automatically uses port 3001 by default. To customize:

Option 1: Add configuration before opening the file:

```html
<script>
  window.UPDATE_API_PORT = 3001; // Your custom port
  window.UPDATE_API_HOST = "localhost"; // Your custom host
</script>
```

Option 2: If serving from the same origin as the API, it will automatically detect the correct host.

**Note:** Make sure your server includes CORS headers if serving from a different origin.
