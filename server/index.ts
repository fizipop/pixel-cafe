// Pixel Cafe multiplayer server. Run with `npm run dev:server` (or `npm run dev:all`).
//   PORT=3001            port to listen on
//   CLIENT_ORIGIN=...    comma separated allowed web origins (default: any, handy for local testing)
import { createCafeServer } from "./app.ts";

const PORT = Number(process.env.PORT ?? 3001);
const origins = process.env.CLIENT_ORIGIN?.split(",").map((s) => s.trim()).filter(Boolean);

const server = createCafeServer({ origins });

server.http.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") console.error(`Port ${PORT} is already in use. Stop the other server or set PORT=...`);
  else console.error(err);
  process.exit(1);
});

server.http.listen(PORT, () => {
  console.log(`Pixel Cafe server listening on http://localhost:${PORT}  (health: /health)`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => { void server.close().then(() => process.exit(0)); });
}
