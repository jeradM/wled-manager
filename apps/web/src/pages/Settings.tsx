import { useEffect, useState, type FormEvent } from "react";
import { MIN_POLL_INTERVAL_MS } from "@wled-manager/shared";
import { useSaveSettings, useSettings } from "../queries";
import { Button, Card, ErrorText, PageHeader } from "../components/ui";

export function Settings() {
  const { data: settings, error } = useSettings();
  const save = useSaveSettings();
  const [seconds, setSeconds] = useState("");

  useEffect(() => {
    if (settings) setSeconds(String(settings.pollIntervalMs / 1000));
  }, [settings]);

  const value = Number(seconds);
  const valid = seconds.trim() !== "" && Number.isFinite(value) && (value === 0 || (value >= MIN_POLL_INTERVAL_MS / 1000 && value <= 3600));
  const changed = settings && valid && Math.round(value * 1000) !== settings.pollIntervalMs;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) save.mutate({ pollIntervalMs: Math.round(value * 1000) });
  };

  return (
    <div>
      <PageHeader title="Settings" />
      <ErrorText error={error} />
      {settings && (
        <Card className="max-w-xl">
          <form onSubmit={submit} className="flex flex-col gap-3 text-sm">
            <h2 className="font-medium">Controller polling</h2>
            <label className="flex items-center gap-2">
              <span className="text-neutral-400">Check every</span>
              <input
                type="number"
                min={0}
                max={3600}
                step={1}
                value={seconds}
                onChange={(e) => setSeconds(e.target.value)}
                className="w-24 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1"
              />
              <span className="text-neutral-400">seconds</span>
              <Button type="submit" variant="primary" disabled={!changed || save.isPending}>
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            </label>
            {!valid && <p className="text-xs text-red-400">Use 0 to turn polling off, or 5 to 3600 seconds.</p>}
            <p className="text-xs text-neutral-500">
              How often each controller is asked for its status, so the dashboard shows which are online. 0 turns polling
              off; status then updates only when you refresh a controller or use it. Takes effect immediately.
            </p>
            {save.isSuccess && !changed && <p className="text-xs text-emerald-400">Saved.</p>}
            <ErrorText error={save.error} />
          </form>
        </Card>
      )}
    </div>
  );
}
