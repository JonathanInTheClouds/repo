import { io } from "socket.io-client";

// Host to connect to (protocol+host only)
const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || window.location.origin;

// Socket.IO path (must match server)
const SOCKET_PATH = process.env.REACT_APP_SOCKET_PATH || "/socket.io";

// Optional: force websockets (helps behind some proxies)
export const socket = io(SOCKET_URL, {
  path: SOCKET_PATH,
  transports: ["websocket"],
});
