import { Link, Outlet, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { useServerEvents } from "./queries";
import { Dashboard } from "./pages/Dashboard";
import { Controllers } from "./pages/Controllers";
import { ControllerDetail } from "./pages/ControllerDetail";
import { Locator } from "./pages/Locator";
import { SegmentBuilder } from "./pages/SegmentBuilder";
import { Palettes } from "./pages/Palettes";
import { EditPalette, NewPalette } from "./pages/PaletteEditor";
import { Presets } from "./pages/Presets";
import { EditPreset, NewPreset } from "./pages/PresetEditor";
import { Settings } from "./pages/Settings";
import { Simulator } from "./pages/Simulator";
import { BlendModes } from "./pages/BlendModes";

function HealthDot() {
  const { isSuccess } = useQuery({
    queryKey: ["health"],
    queryFn: () => api<{ ok: boolean }>("/health"),
    refetchInterval: 15_000,
  });
  return (
    <span className="flex items-center gap-2 text-xs text-neutral-400">
      <span className={`size-2 rounded-full ${isSuccess ? "bg-emerald-500" : "bg-red-500"}`} />
      {isSuccess ? "Server connected" : "Server unreachable"}
    </span>
  );
}

const nav = [
  { to: "/", label: "Dashboard" },
  { to: "/controllers", label: "Controllers" },
  { to: "/palettes", label: "Palettes" },
  { to: "/presets", label: "Presets" },
  { to: "/simulator", label: "Simulator" },
  { to: "/settings", label: "Settings" },
] as const;

function Root() {
  useServerEvents();
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-neutral-800 px-6 py-3">
        <div className="flex items-center gap-6">
          <span className="font-semibold">WLED Manager</span>
          <nav className="flex gap-4 text-sm">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                activeOptions={{ exact: n.to === "/" }}
                className="text-neutral-400 hover:text-neutral-100 [&.active]:text-neutral-100"
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
        <HealthDot />
      </header>
      <main className="mx-auto max-w-6xl p-6">
        <Outlet />
      </main>
    </div>
  );
}

const rootRoute = createRootRoute({ component: Root });

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: Dashboard }),
  createRoute({ getParentRoute: () => rootRoute, path: "/controllers", component: Controllers }),
  createRoute({ getParentRoute: () => rootRoute, path: "/controllers/$id", component: ControllerDetail }),
  createRoute({ getParentRoute: () => rootRoute, path: "/controllers/$id/locate", component: Locator }),
  createRoute({ getParentRoute: () => rootRoute, path: "/controllers/$id/segments", component: SegmentBuilder }),
  createRoute({ getParentRoute: () => rootRoute, path: "/palettes", component: Palettes }),
  createRoute({ getParentRoute: () => rootRoute, path: "/palettes/new", component: NewPalette }),
  createRoute({ getParentRoute: () => rootRoute, path: "/palettes/$id", component: EditPalette }),
  createRoute({ getParentRoute: () => rootRoute, path: "/presets", component: Presets }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/presets/new",
    component: NewPreset,
    // The group to start the new preset in, from a group's "+ New preset" link.
    validateSearch: (s: Record<string, unknown>): { folder?: string } => (typeof s.folder === "string" && s.folder ? { folder: s.folder } : {}),
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/presets/$id", component: EditPreset }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/simulator",
    component: Simulator,
    // The preset loaded into the simulator.
    validateSearch: (s: Record<string, unknown>): { preset?: string } => (typeof s.preset === "string" && s.preset ? { preset: s.preset } : {}),
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/simulator/blend-modes", component: BlendModes }),
  createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: Settings }),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
