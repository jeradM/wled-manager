import { Link, Outlet, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

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
] as const;

const rootRoute = createRootRoute({
  component: () => (
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
  ),
});

const placeholder = (title: string) => () => (
  <div>
    <h1 className="text-xl font-semibold">{title}</h1>
    <p className="mt-2 text-sm text-neutral-400">Coming soon.</p>
  </div>
);

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: placeholder("Dashboard") }),
  createRoute({ getParentRoute: () => rootRoute, path: "/controllers", component: placeholder("Controllers") }),
  createRoute({ getParentRoute: () => rootRoute, path: "/palettes", component: placeholder("Palettes") }),
  createRoute({ getParentRoute: () => rootRoute, path: "/presets", component: placeholder("Presets") }),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
