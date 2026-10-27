import { useState, type FormEvent } from "react";
import type { ControllerExport } from "@wled-manager/shared";
import { setupSummary } from "../controllerFile";
import { useAddController, useImportController } from "../queries";
import { Button, Card, ErrorText, Input } from "./ui";

/** Adds a controller, or, given an export file, adds it with the file's setup. */
export function AddControllerForm({ imported, onDone }: { imported?: ControllerExport; onDone: () => void }) {
  const add = useAddController();
  const importController = useImportController();
  const from = imported?.controller;
  const [name, setName] = useState(from?.name ?? "");
  const [host, setHost] = useState(from?.host ?? "");
  const [port, setPort] = useState(String(from?.port ?? 80));
  const [tags, setTags] = useState(from?.tags.join(", ") ?? "");
  const pending = add.isPending || importController.isPending;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const input = {
      name: name.trim() || host.trim(),
      host: host.trim(),
      port: Number(port) || 80,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
    };
    if (imported) importController.mutate({ file: imported, ...input }, { onSuccess: onDone });
    else add.mutate(input, { onSuccess: onDone });
  };

  return (
    <Card className="mb-6">
      <form onSubmit={submit} className="flex flex-col gap-4">
        {from && (
          <p className="text-sm text-neutral-400">
            Importing <span className="text-neutral-100">{from.name}</span> with its LED layout, {setupSummary(from)}.
            Change the address if the controller has moved.
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Input label="IP or hostname" value={host} onChange={(e) => setHost(e.target.value)} placeholder="10.0.0.42" required autoFocus />
          <Input label="Port" value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" />
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Defaults to host" />
          <Input label="Tags (comma separated)" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="outdoor, front" />
        </div>
        <ErrorText error={add.error ?? importController.error} />
        <div className="flex gap-2">
          <Button variant="primary" type="submit" disabled={pending || !host.trim()}>
            {pending ? "Connecting…" : imported ? "Import controller" : "Add controller"}
          </Button>
          <Button type="button" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
