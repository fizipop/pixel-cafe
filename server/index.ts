// Pixel Cafe multiplayer server. Run with `npm run dev:server` (or `npm run dev:all`).
//   PORT=3001            port to listen on
//   CLIENT_ORIGIN=...    comma separated allowed web origins (default: any, handy for local testing)
//   DATA_FILE=...        where rumours, guestbook and outfit votes are saved (default: server/data.json)
import { fileURLToPath } from "node:url";
import { createCafeServer } from "./app.ts";
import { JsonFileRepository } from "./repository.ts";

const PORT = Number(process.env.PORT ?? 3001);
const origins = process.env.CLIENT_ORIGIN?.split(",").map((s) => s.trim()).filter(Boolean);

const dataFile = process.env.DATA_FILE ?? fileURLToPath(new URL("./data.json", import.meta.url));
const repo = new JsonFileRepository(dataFile);
console.log(`Saving boards to ${dataFile}`);

const server = createCafeServer({ origins, room: { repo } });

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
