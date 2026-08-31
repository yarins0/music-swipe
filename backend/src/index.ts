import app from './app';

// Kept separate from app.ts so tests can import the configured Express app
// without binding a port.
const PORT = process.env.PORT ?? 3000;

app.listen(PORT, () => {
  console.log(`MusicSwipe backend running on port ${PORT}`);
});
