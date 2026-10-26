import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useControllers } from "../queries";
import { AddControllerForm } from "../components/AddControllerForm";
import { Button, PageHeader, StatusDot, timeAgo } from "../components/ui";

export function Controllers() {
  const { data: controllers = [] } = useControllers();
  const [adding, setAdding] = useState(false);

  return (
    <div>
      <PageHeader
        title="Controllers"
        actions={!adding && <Button variant="primary" onClick={() => setAdding(true)}>Add controller</Button>}
      />
      {adding && <AddControllerForm onDone={() => setAdding(false)} />}
      <div className="overflow-hidden rounded-lg border border-neutral-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-900 text-xs text-neutral-400">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Address</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Firmware</th>
              <th className="px-4 py-2 font-medium">LEDs</th>
              <th className="px-4 py-2 font-medium">Tags</th>
              <th className="px-4 py-2 font-medium">Last seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {controllers.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-neutral-500">
                  No controllers yet.
                </td>
              </tr>
            )}
            {controllers.map((c) => (
              <tr key={c.id} className="hover:bg-neutral-900/60">
                <td className="px-4 py-2">
                  <Link to="/controllers/$id" params={{ id: c.id }} className="font-medium text-sky-400 hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-neutral-400">{c.host}{c.port !== 80 && `:${c.port}`}</td>
                <td className="px-4 py-2"><StatusDot status={c.status} /></td>
                <td className="px-4 py-2 text-neutral-400">{c.device?.version ?? "–"}</td>
                <td className="px-4 py-2 text-neutral-400">{c.device?.ledCount ?? "–"}</td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-1">
                    {c.tags.map((t) => (
                      <span key={t} className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-300">{t}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-2 text-neutral-400">{timeAgo(c.lastSeen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
