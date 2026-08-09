# TS Server Crash Analysis & Optimization Plan

We analyzed the workspace to identify why the TypeScript language server (`tsserver`) is getting overloaded and crashing. 

---

## 🔍 Root Cause Analysis

We discovered two major factors overloading the editor and the TypeScript server:

### 1. Massive Log Volume (2.3 GB of Logs)
The `logs` directory contains **296 large log files** totaling **2.3 GB** of data. 
- **The Winston EPIPE Loop**: We tailed the log files and found a critical loop:
  ```json
  {"error":{"code":"EPIPE","errno":-32,"syscall":"write"},"exception":true,"level":"error","message":"uncaughtException: write EPIPE ..."}
  ```
  This is a classic circular logging loop. When the server process runs inside a container or as a background job, its standard output/error stream (`stdout`/`stderr`) can sometimes become closed or disconnected, raising a `write EPIPE` error. Because `winston`'s console transport attempts to write to the console, it raises an `EPIPE` exception. Winston's uncaught exception handler catches this, tries to log it to the app log file, and **also tries to log it to the console**, which triggers *another* `EPIPE` error, creating an endless, ultra-fast loop of log writing.

### 2. Missing VS Code/TypeScript Folder Exclusions
- **File Watcher Exclusions**: The `.vscode/settings.json` file did not exclude the `logs/` directory or directories like `node_modules_frontend` from the editor's live file watcher. As the infinite `EPIPE` loop generated millions of logs in real-time, the file watcher constantly flooded VS Code/Cursor and TypeScript with file system change events, causing CPU spikes and memory exhaustion.
- **Search Exclusions**: Large log directories and backup folders were not excluded from search indexers.
- **TSConfig Exclusions**: Neither `tsconfig.json` nor `tsconfig.app.json` had explicit `exclude` properties, meaning TypeScript was potentially scanning large, non-source code paths in the workspace root.

---

## 🛠️ Step-by-Step Optimization Plan

### Step 1: Update `.vscode/settings.json`
Configure the VS Code/Cursor file watcher and search indexer to ignore heavy folders, and increase the TypeScript server's max memory to **8GB** (8192 MB) to give it plenty of breathing room.
- Exclude `logs/**`, `node_modules_frontend/**`, `node_modules_backend/**`, `reports/**`, `scratch/**` from watchers and search.
- Set `"typescript.maxTsServerMemory": 8192`.

### Step 2: Update `tsconfig.json` & `tsconfig.app.json`
Add explicit `exclude` blocks to restrict the compiler's reach:
- Exclude all `node_modules`, `node_modules_frontend`, `node_modules_backend`, `server/node_modules`, `dist`, `logs`, `reports`, `scratch`, `server`, and backup directories.

### Step 3: Safe Log Cleanup
- Purge old rotated logs in `logs/app/` and `logs/audit/` to instantly reclaim 2.3 GB of disk space and reduce the index size.

### Step 4: Fix Winston EPIPE Infinite Loop
- Safely handle Winston's `EPIPE` exception in `server/utils/logger.js` so that if standard streams fail, it doesn't enter a circular loop.

### Step 5: Automated Log Garbage Collection (GC) Workflow
- Created a robust garbage collection utility in `server/utils/logGC.js` that scans log subdirectories, prunes files older than 14 days, and enforces a strict safety cap of **100 MB** total size (removing oldest rotated logs first).
- Scheduled this GC workflow to run automatically on server boot and every 24 hours in the background via `server/server.js`.

---

## 📅 Verification
After applying these fixes, we will verify the TypeScript server's stability and confirm disk usage is restored to normal.

