/**
 * lib/session/vncBridge.ts
 *
 * WebSocket <-> VNC bridge for the login console viewer (noVNC in the page).
 * Upgrades on /api/session/console/:token/vnc only; the token is the whole
 * authorization, as for the console's other routes. Other upgrade requests
 * (Vite HMR in development) are left alone.
 */

import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { logger } from '../logging/index.js';
import { findLoginConsole } from './loginConsole.js';

const VNC_PATH = /^\/api\/session\/console\/([^/]+)\/vnc$/;

export function attachConsoleVncBridge(server: Server): void {
  const wss = new WebSocketServer({
    noServer: true,
    // noVNC offers 'binary' on older servers' behalf; accept it when present.
    handleProtocols: (protocols) => (protocols.has('binary') ? 'binary' : false),
  });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const match = VNC_PATH.exec(new URL(req.url ?? '/', 'http://localhost').pathname);
    if (!match) return;
    const loginConsole = findLoginConsole(decodeURIComponent(match[1]));
    if (!loginConsole?.open) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      let vnc: ReturnType<typeof loginConsole.connectVnc>;
      try {
        vnc = loginConsole.connectVnc();
      } catch {
        ws.close(1011, 'console_closed');
        return;
      }
      vnc.on('data', (chunk) => ws.send(chunk));
      vnc.on('close', () => ws.close());
      vnc.on('error', (err) => { logger.warn({ err }, '[LoginConsole] VNC connection error'); ws.close(1011); });
      ws.on('message', (data) => vnc.write(data as Buffer));
      ws.on('close', () => vnc.destroy());
      ws.on('error', () => vnc.destroy());
    });
  });
}
