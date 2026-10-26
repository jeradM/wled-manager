import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Controller,
  ControllerInput,
  ControllerUpdate,
  ImportPreview,
  ImportRequest,
  ImportResult,
  Palette,
  PaletteInput,
  PaletteStop,
  Preset,
  PresetInput,
  QuickControl,
  ServerEvent,
  SyncPlan,
  SyncResult,
} from "@wled-manager/shared";
import { api } from "./api";

export const keys = {
  controllers: ["controllers"] as const,
  controller: (id: string) => ["controllers", id] as const,
  devicePresets: (id: string) => ["controllers", id, "device-presets"] as const,
  deviceState: (id: string) => ["controllers", id, "state"] as const,
  builtinPalettes: (id: string) => ["controllers", id, "builtin-palettes"] as const,
  syncPlans: ["sync-plan"] as const,
  syncPlan: (id: string) => ["sync-plan", id] as const,
  palettes: ["palettes"] as const,
  palette: (id: string) => ["palettes", id] as const,
  presets: ["presets"] as const,
  preset: (id: string) => ["presets", id] as const,
  catalog: (id: string) => ["controllers", id, "catalog"] as const,
  importPreview: (id: string) => ["controllers", id, "import"] as const,
};

export const useControllers = () =>
  useQuery({ queryKey: keys.controllers, queryFn: () => api<Controller[]>("/controllers") });

export const useController = (id: string) =>
  useQuery({ queryKey: keys.controller(id), queryFn: () => api<Controller>(`/controllers/${id}`) });

export const useDevicePresets = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: keys.devicePresets(id),
    queryFn: () => api<{ slot: number; name: string }[]>(`/controllers/${id}/device-presets`),
    enabled,
  });

export interface DeviceState {
  on: boolean;
  bri: number;
  ps: number;
}

export const useDeviceState = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: keys.deviceState(id),
    queryFn: () => api<DeviceState>(`/controllers/${id}/state`),
    enabled,
    refetchInterval: 10_000,
  });

export function useAddController() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ControllerInput) =>
      api<Controller>("/controllers", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.controllers }),
  });
}

export function useUpdateController(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: ControllerUpdate) =>
      api<Controller>(`/controllers/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.controllers }),
  });
}

export function useDeleteController() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/controllers/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.controllers }),
  });
}

export function useRefreshController() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<Controller>(`/controllers/${id}/refresh`, { method: "POST" }),
    onSuccess: (_, id) => qc.invalidateQueries({ queryKey: keys.controller(id) }),
  });
}

export function useQuickControl(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: QuickControl) =>
      api<DeviceState>(`/controllers/${id}/state`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (state) => qc.setQueryData(keys.deviceState(id), state),
  });
}

// ---- Palettes ----

export const usePalettes = () => useQuery({ queryKey: keys.palettes, queryFn: () => api<Palette[]>("/palettes") });

export const usePalette = (id: string | undefined) =>
  useQuery({ queryKey: keys.palette(id ?? ""), queryFn: () => api<Palette>(`/palettes/${id}`), enabled: !!id });

export function useSavePalette(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PaletteInput) =>
      id
        ? api<Palette>(`/palettes/${id}`, { method: "PUT", body: JSON.stringify(input) })
        : api<Palette>("/palettes", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.palettes }),
  });
}

export function useDeletePalette() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/palettes/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.palettes }),
  });
}

export interface BuiltinPalette {
  id: number;
  name: string;
  stops: PaletteStop[] | null;
}

export const useBuiltinPalettes = (controllerId: string | undefined) =>
  useQuery({
    queryKey: keys.builtinPalettes(controllerId ?? ""),
    queryFn: () => api<BuiltinPalette[]>(`/controllers/${controllerId}/builtin-palettes`),
    enabled: !!controllerId,
    staleTime: Infinity,
  });

export const usePalettePreview = () =>
  useMutation({
    mutationFn: ({ controllerId, stops }: { controllerId: string; stops: PaletteStop[] }) =>
      api<{ slot: number; deviceId: number }>(`/controllers/${controllerId}/palette-preview`, {
        method: "POST",
        body: JSON.stringify({ stops }),
      }),
  });

// ---- Presets ----

export const usePresets = () => useQuery({ queryKey: keys.presets, queryFn: () => api<Preset[]>("/presets") });

export const usePreset = (id: string | undefined) =>
  useQuery({ queryKey: keys.preset(id ?? ""), queryFn: () => api<Preset>(`/presets/${id}`), enabled: !!id });

export function useSavePreset(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PresetInput) =>
      id
        ? api<Preset>(`/presets/${id}`, { method: "PUT", body: JSON.stringify(input) })
        : api<Preset>("/presets", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.presets }),
  });
}

export function useDeletePreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/presets/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.presets }),
  });
}

export const usePresetTest = () =>
  useMutation({
    mutationFn: ({ controllerId, preset }: { controllerId: string; preset: PresetInput }) =>
      api<{ warnings: string[] }>(`/controllers/${controllerId}/preset-test`, {
        method: "POST",
        body: JSON.stringify(preset),
      }),
  });

export interface Catalog {
  effects: string[];
  palettes: string[];
  fxdata: string[];
}

/** Effect/palette names cached from a controller's last refresh; available while it's offline too. */
export const useCatalog = (controllerId: string | undefined) =>
  useQuery({
    queryKey: keys.catalog(controllerId ?? ""),
    queryFn: () => api<Catalog>(`/controllers/${controllerId}/catalog`),
    enabled: !!controllerId,
    staleTime: 5 * 60_000,
  });

// ---- Import ----

export const useImportPreview = (controllerId: string, enabled: boolean) =>
  useQuery({
    queryKey: keys.importPreview(controllerId),
    queryFn: () => api<ImportPreview>(`/controllers/${controllerId}/import`),
    enabled,
    staleTime: 0,
  });

export function useImport(controllerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (request: ImportRequest) =>
      api<ImportResult>(`/controllers/${controllerId}/import`, { method: "POST", body: JSON.stringify(request) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.palettes });
      void qc.invalidateQueries({ queryKey: keys.presets });
      void qc.invalidateQueries({ queryKey: keys.importPreview(controllerId) });
      void qc.invalidateQueries({ queryKey: keys.syncPlan(controllerId) });
    },
  });
}

// ---- Sync ----

export const useSyncPlan = (controllerId: string, enabled: boolean) =>
  useQuery({
    queryKey: keys.syncPlan(controllerId),
    queryFn: () => api<SyncPlan>(`/controllers/${controllerId}/sync-plan`),
    enabled,
    staleTime: 30_000,
  });

export function useSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (controllerId: string) => api<SyncResult>(`/controllers/${controllerId}/sync`, { method: "POST" }),
    onSettled: (_, __, id) => qc.invalidateQueries({ queryKey: keys.syncPlan(id) }),
  });
}

/** Subscribes to server events and invalidates the affected queries. */
export function useServerEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onmessage = (msg) => {
      const event = JSON.parse(msg.data) as ServerEvent;
      switch (event.type) {
        case "controller.updated":
        case "controller.removed":
          void qc.invalidateQueries({ queryKey: keys.controllers });
          break;
        case "palettes.changed":
          void qc.invalidateQueries({ queryKey: keys.palettes });
          void qc.invalidateQueries({ queryKey: keys.syncPlans });
          break;
        case "presets.changed":
          void qc.invalidateQueries({ queryKey: keys.presets });
          void qc.invalidateQueries({ queryKey: keys.syncPlans });
          break;
        case "sync.completed":
          void qc.invalidateQueries({ queryKey: keys.syncPlan(event.controllerId) });
          break;
      }
    };
    return () => source.close();
  }, [qc]);
}
