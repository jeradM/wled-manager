import { Link } from "@tanstack/react-router";
import { useControllers } from "../queries";
import { Card, PageHeader, StatusDot, timeAgo } from "../components/ui";

export function Dashboard() {
  const { data: controllers = [], isLoading } = useControllers();
  const online = controllers.filter((c) => c.status === "online").length;

  return (
    <div>
      <PageHeader title="Dashboard" />
      {!isLoading && controllers.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-400">
            No controllers yet.{" "}
            <Link to="/controllers" className="text-sky-400 hover:underline">
              Add your first WLED controller
            </Link>
            .
          </p>
        </Card>
      ) : (
        <>
          <p className="mb-4 text-sm text-neutral-400">
            {online} of {controllers.length} controllers online
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {controllers.map((c) => (
              <Link key={c.id} to="/controllers/$id" params={{ id: c.id }}>
                <Card className="h-full transition-colors hover:border-neutral-600">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-neutral-500">{c.host}{c.port !== 80 && `:${c.port}`}</div>
                    </div>
                    <StatusDot status={c.status} />
                  </div>
                  {c.device && (
                    <dl className="mt-4 grid grid-cols-2 gap-y-1 text-xs">
                      <dt className="text-neutral-500">Firmware</dt>
                      <dd>{c.device.version}</dd>
                      <dt className="text-neutral-500">LEDs</dt>
                      <dd>{c.device.ledCount}{c.device.rgbw && " RGBW"}</dd>
                      <dt className="text-neutral-500">Custom palettes</dt>
                      <dd>{c.device.customPaletteCount} / {c.device.customPaletteMax}</dd>
                    </dl>
                  )}
                  <div className="mt-3 text-xs text-neutral-500">
                    {c.status === "offline" ? `Last seen ${timeAgo(c.lastSeen)}` : `Seen ${timeAgo(c.lastSeen)}`}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
