import { useEffect, useState } from "react";
import { healthResponseSchema } from "@playstop/shared";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

type HealthStatus = "checking" | "ok" | "failed";

function App() {
  const [health, setHealth] = useState<HealthStatus>("checking");

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((res) => res.json())
      .then((body) => {
        healthResponseSchema.parse(body);
        setHealth("ok");
      })
      .catch(() => setHealth("failed"));
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 text-slate-50">
      <h1 className="text-4xl font-bold">PlayStop</h1>
      <p className="text-sm text-slate-400">
        API health: <span className="font-mono">{health}</span>
      </p>
    </main>
  );
}

export default App;
