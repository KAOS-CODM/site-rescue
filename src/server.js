import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

// Serve the vanilla frontend from public/ (spec > Components > Express server).
// The /api/scan and /api/plan routes arrive in Slices 2 and 3 — none exist yet.
app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  console.log(`Site Rescue running at http://localhost:${PORT}`);
});
