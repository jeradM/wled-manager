import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Controller, ControllerInput, ControllerUpdate, QuickControl, ServerEvent } from "@wled-manager/shared";
import { api } from "./api";

export const keys = {
  controllers: ["controllers"] as const,
  controller: (id: string) => ["controllers", id] as const,
  devicePresets: (id: string) => ["controllers", id, "device-presets"] as const,
  deviceState: (id: string) => ["controllers", id, "state"] as const,
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
      }
    };
    return () => source.close();
  }, [qc]);
}
