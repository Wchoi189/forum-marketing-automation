# Agent Skill Guide: Resource & Docker Management
**ID:** `resource-docker-management`  
**Purpose:** Ensure system stability in resource-constrained environments (e.g., 512MB RAM hosts) by managing Node/Chromium memory limits, applying browser process recycling, and deploying changes safely via Docker.

---

## 1. Process & Memory Footprint Diagnosis

### The Chromium Multi-Process Architecture
When analyzing active processes in the system or container, **do not mistake standard Chromium subprocesses for orphaned/leaked processes**. A single persistent headless Chromium instance always spawns a process tree:
* 1 x **Browser Parent Process** (`chrome-headless-shell`)
* 2 x **Zygote Processes** (sandboxing template child processes)
* 1 x **GPU Process** (SwiftShader/WebGL compositing)
* 1 x **Network Service Utility** (request management)
* 1 x **Audio Service Utility** (lazily loaded when media is compiled)
* N x **Renderer Processes** (for each open tab/context page)

Therefore, seeing **5 to 7 processes** matching `chromium` or `chrome-headless-shell` in `ps aux` is completely **normal and expected** for a single active shared browser. It is not an indicator of a process leak.

### How to Check System & Container Metrics
* **From Host Shell**: Inspect processes within the active Docker container:
  ```bash
  docker exec marketing-automation-app-1 ps aux
  ```
* **Via System API**: Retrieve real-time memory and process counts by making a request to the health endpoint:
  ```bash
  curl http://localhost:3000/api/health/resources
  ```
  This returns standard metrics:
  * `process.rssMb`: Resident set size of the Node application.
  * `browserProfile.totalSizeMb`: Cache size of the user data directory.
  * `chromiumProcesses`: Total matching processes on the system (a warning triggers if $> 6$ to flag potential true orphans).

---

## 2. Memory Constraints & Limits Rules

In highly resource-constrained environments (e.g. 512MB RAM cloud hosts), memory configuration must be aggressively balanced between Node and Chromium to avoid OOM crashes:

1. **Node.js Heap Allocation**:
   * **Rule**: Limit Node's old space heap size to **256MB** inside the environment configuration. Setting it to 400MB+ leaves insufficient RAM for the OS and the browser, causing paging thrashing.
   * **Docker configuration**:
     ```yaml
     # docker-compose.yml
     environment:
       - NODE_OPTIONS=--max-old-space-size=256 --expose-gc --enable-source-maps
     ```
2. **Chromium Heap Limit**:
   * **Rule**: Restrict Chromium's V8 engine space by passing max space old flags at launch:
     ```typescript
     // lib/sharedBrowser.ts
     '--js-flags=--max-old-space-size=100'
     ```

---

## 3. Automated Browser Recycling (Process Rotation)

Because Chromium accumulates resources and fragmentation over continuous operations, the system enforces **automatic browser process rotation**:

### A. Lifecycle Context Rotation
* **Trigger**: Increment `contextCreationsCount` on every context creation.
* **Limit**: **15 contexts** (observer/publisher runs).
* **Action**: Once the context count is met and there are no active, running contexts (`activeContexts.size === 0`), the parent browser process is closed cleanly (`await closeSharedBrowser()`) and restarted afresh.

### B. Garbage Collection Termination
* **Trigger**: Manual or scheduled Garbage Collection (`runGarbageCollection()`).
* **Action**: If the browser is currently idle (`activeContexts.size === 0`), it is **shut down completely** to release 100% of its resident memory.
* **Warm-up**: The next context request (`createBrowserContext()`) will lazily and automatically re-warm and initialize the browser.

---

## 4. Docker Deployment & Reflector Workflow

Because the running app container uses isolated paths without binding raw host folders into the working directory (standard production practice), you **must rebuild and restart the Docker container** to apply code modifications:

### Step-by-Step Change Reflection:
1. **Rebuild & Recreate Services**:
   Execute the docker-compose build pipeline. This stops the old container, compiles the new frontend bundle, copies updated backend files, and spins up the container:
   ```bash
   docker compose up -d --build
   ```
2. **Validate Container Health**:
   Wait for the built-in HTTP health check to report successful status:
   ```bash
   docker ps
   # Look for (healthy) status under NAMES marketing-automation-app-1
   ```
3. **Trace Container Startup**:
   Validate that the Node process booted without exceptions and that the first-run GC cleanly shut down the pre-warmed idle browser:
   ```bash
   docker logs marketing-automation-app-1
   ```

---

## 5. Verification checklist

When modifying resource, browser, or environment parameters, always run:
1. **TypeScript Compilations**:
   ```bash
   npx tsc --noEmit
   ```
2. **Integration Tests**:
   ```bash
   npm run test:integration
   ```
3. **GC Integration Checks**:
   ```bash
   npx tsx --test tests/integration/bot-stability.test.ts
   ```
