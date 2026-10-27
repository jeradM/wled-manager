import { controllerExport, type ControllerExport } from "@wled-manager/shared";

/** Reads a controller export file chosen by the user. Throws an Error with a readable message. */
export async function readControllerFile(file: File): Promise<ControllerExport> {
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    throw new Error(`${file.name} isn't a JSON file`);
  }
  const parsed = controllerExport.safeParse(json);
  if (parsed.success) return parsed.data;
  if ((json as { format?: unknown } | null)?.format !== controllerExport.shape.format.value)
    throw new Error(`${file.name} isn't a WLED Manager controller export`);
  const issue = parsed.error.issues[0]!;
  throw new Error(`${file.name} can't be imported: ${issue.path.join(".")} ${issue.message}`);
}

/** "12 markers, 3 ranges, 8 segments" */
export function setupSummary(c: Pick<ControllerExport["controller"], "markers" | "ranges" | "segments">) {
  const n = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  return [n(c.markers.length, "marker"), n(c.ranges.length, "range"), n(c.segments.length, "segment")].join(", ");
}
