import { Link } from "@tanstack/react-router";
import { usePalettes } from "../queries";
import { GradientSwatch } from "../components/GradientEditor";
import { Button, Card, PageHeader } from "../components/ui";

export function Palettes() {
  const { data: palettes = [], isLoading } = usePalettes();
  return (
    <div>
      <PageHeader
        title="Palettes"
        actions={
          <Link to="/palettes/new">
            <Button variant="primary">New palette</Button>
          </Link>
        }
      />
      {!isLoading && palettes.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-400">No custom palettes yet. Create one, then sync it to your controllers.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {palettes.map((p) => (
            <Link key={p.id} to="/palettes/$id" params={{ id: p.id }}>
              <Card className="transition-colors hover:border-neutral-600">
                <GradientSwatch stops={p.stops} className="h-10" />
                <div className="mt-3 flex items-baseline justify-between">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs text-neutral-500">
                    {p.stops.length} stops
                    {p.variants.length > 0 && ` · ${p.variants.length} controller version${p.variants.length === 1 ? "" : "s"}`}
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
