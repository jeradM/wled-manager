import { useState, type FormEvent } from "react";
import { useAddController } from "../queries";
import { Button, Card, ErrorText, Input } from "./ui";

export function AddControllerForm({ onDone }: { onDone: () => void }) {
  const add = useAddController();
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("80");
  const [tags, setTags] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate(
      {
        name: name.trim() || host.trim(),
        host: host.trim(),
        port: Number(port) || 80,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      },
      { onSuccess: onDone },
    );
  };

  return (
    <Card className="mb-6">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Input label="IP or hostname" value={host} onChange={(e) => setHost(e.target.value)} placeholder="10.0.0.42" required autoFocus />
          <Input label="Port" value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" />
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Defaults to host" />
          <Input label="Tags (comma separated)" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="outdoor, front" />
        </div>
        <ErrorText error={add.error} />
        <div className="flex gap-2">
          <Button variant="primary" type="submit" disabled={add.isPending || !host.trim()}>
            {add.isPending ? "Connecting…" : "Add controller"}
          </Button>
          <Button type="button" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
