import express from "express";
import path from "path";
import cors from "cors";
import { pathToFileURL } from "url";
import { createServer as createViteServer } from "vite";
import { runObserver, runPublisher, getLogs } from "./bot.js";
import { ENV } from "./config/env.js";
import { validateRuntimeContracts } from "./config/runtime-validation.js";

type BotDeps = {
  runObserver: typeof runObserver;
  runPublisher: typeof runPublisher;
  getLogs: typeof getLogs;
};

const defaultDeps: BotDeps = { runObserver, runPublisher, getLogs };

export function createApp(deps: BotDeps = defaultDeps) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // API Routes
  app.get("/api/logs", async (req, res) => {
    const logs = await deps.getLogs();
    res.json(logs);
  });

  app.get("/api/competitor-stats", async (req, res) => {
    const logs = await deps.getLogs();
    const stats: Record<string, { count: number, totalViews: number }> = {};
    
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const recentLogs = logs.filter(log => new Date(log.timestamp) >= oneWeekAgo);

    recentLogs.forEach(log => {
      if (log.all_posts) {
        // Use a set to count unique posts per snapshot to avoid double counting if snapshots are frequent
        // But actually, frequency should be "how many times they appeared in snapshots" or "how many unique posts they made"
        // Let's go with "how many unique posts they made" across all snapshots
        const uniquePostsInSnapshot = new Set();
        log.all_posts.forEach(post => {
          if (post.author.toLowerCase().includes('shareplan')) return;
          const key = post.title + post.author;
          if (!uniquePostsInSnapshot.has(key)) {
            if (!stats[post.author]) {
              stats[post.author] = { count: 0, totalViews: 0 };
            }
            stats[post.author].count++;
            stats[post.author].totalViews += post.views;
            uniquePostsInSnapshot.add(key);
          }
        });
      }
    });

    const result = Object.entries(stats).map(([author, s]) => ({
      author,
      frequency: s.count,
      avgViews: Math.round(s.totalViews / s.count)
    })).sort((a, b) => b.frequency - a.frequency);

    res.json(result.slice(0, 10));
  });

  app.get("/api/board-stats", async (req, res) => {
    const logs = await deps.getLogs();
    if (logs.length < 2) return res.json({ turnoverRate: 0, shareOfVoice: 0 });

    const latest = logs[0];
    const previous = logs[1];

    const prevKeys = new Set(previous.all_posts?.map(p => p.title + p.author) || []);
    const newPosts = latest.all_posts?.filter(p => !prevKeys.has(p.title + p.author)).length || 0;
    
    const timeDiffHours = (new Date(latest.timestamp).getTime() - new Date(previous.timestamp).getTime()) / (1000 * 60 * 60);
    const turnoverRate = timeDiffHours > 0 ? (newPosts / timeDiffHours).toFixed(1) : 0;

    const ourPosts = latest.all_posts?.filter(p => p.author.toLowerCase().includes('shareplan')).length || 0;
    const shareOfVoice = latest.all_posts?.length ? Math.round((ourPosts / latest.all_posts.length) * 100) : 0;

    res.json({ turnoverRate, shareOfVoice });
  });

  app.get("/api/drafts", (req, res) => {
    res.json([
      {
        title: "[OTT/멤버십] [SharePlan] 끝까지 관리된 유튜브/코세라 프리미엄 (가입 완료 후 결제)",
        timestamp: "2026-03-30 10:00:00",
        id: "draft_1"
      },
      {
        title: "[OTT/멤버십] [SharePlan] 끝까지 관리된 유튜브/코세라 프리미엄 (가입 완료 후 결제)",
        timestamp: "2026-03-29 15:30:00",
        id: "draft_2"
      }
    ]);
  });

  app.post("/api/run-observer", async (req, res) => {
    try {
      const log = await deps.runObserver();
      if (log.status === 'error') {
        res.status(500).json({ success: false, error: log.error, log });
      } else {
        res.json({ success: true, log });
      }
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/run-publisher", async (req, res) => {
    const { force } = req.body;
    try {
      const result = await deps.runPublisher(force);
      if (!result.success) {
        res.status(500).json({ success: false, message: result.message, error: result.message, log: result.log });
      } else {
        res.json(result);
      }
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return app;
}

export function startScheduler(deps: BotDeps = defaultDeps, intervalMinutes: number = ENV.RUN_INTERVAL_MINUTES) {
  const intervalMs = intervalMinutes * 60 * 1000;
  let running = false;

  const tick = async () => {
    if (running) {
      console.warn("[Scheduler] Tick skipped because previous run is still active.");
      return;
    }

    running = true;
    try {
      await deps.runPublisher(false);
    } catch (error: any) {
      console.error("[Scheduler] Tick failed:", error.message);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);

  console.log(`[Scheduler] Started with interval ${intervalMinutes} minute(s).`);

  return {
    stop: () => clearInterval(timer),
    runNow: tick
  };
}

export async function startServer() {
  await validateRuntimeContracts();

  const app = createApp();
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const PORT = ENV.PORT;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  startScheduler();
}

const isDirectRun = Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
if (isDirectRun) {
  startServer();
}
