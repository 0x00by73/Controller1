import { callable } from "@decky/api";

export type InputRef = {
  eventType: number;
  code: number;
  name: string;
};

export type Predicate = {
  input: InputRef;
  test: "pressed" | "released" | "axisRange";
  axisRange?: [number, number];
};

export type Action = {
  type: "key" | "keyCombo" | "mouseButton" | "mouseMove" | "gamepadButton" | "gamepadAxis" | "layer";
  code?: string;
  codes?: string[];
  source?: InputRef;
  scale?: number;
};

export type Binding = {
  id?: string;
  name: string;
  layer: string;
  conditions: Predicate[];
  action: Action;
};

export type Calibration = {
  min: number;
  center: number;
  max: number;
  deadzone: number;
  invert: boolean;
  expo: number;
};

export type Profile = {
  id: string;
  name: string;
  deviceId: string | null;
  bindings: Binding[];
  calibrations: Record<string, Calibration>;
};

export type Device = {
  id: string;
  path: string;
  name: string;
  vendor: number;
  product: number;
  axes: Array<{ code: number; name: string }>;
  buttons: Array<{ code: number; name: string }>;
  active: boolean;
};

export type Status = {
  enabled: boolean;
  activeProfileId: string;
  profiles: Profile[];
  devices: Device[];
  dependencyError: string | null;
  learning: boolean;
};

export const getStatus = callable<[], Status>("get_status");
export const refreshDevices = callable<[], Device[]>("refresh_devices");
export const setEnabled = callable<[enabled: boolean, deviceId?: string], Status>("set_enabled");
export const setProfile = callable<[profileId: string], Status>("set_profile");
export const createProfile = callable<[name: string], Profile>("create_profile");
export const deleteProfile = callable<[profileId: string], Status>("delete_profile");
export const saveBinding = callable<[profileId: string, binding: Binding], Binding>("save_binding");
export const deleteBinding = callable<[profileId: string, bindingId: string], Profile>("delete_binding");
export const startLearning = callable<[], void>("start_learning");
export const stopLearning = callable<[], void>("stop_learning");
export const beginCalibration = callable<[inputs: InputRef[]], void>("begin_calibration");
export const finishCalibration = callable<[profileId: string, centers?: Record<string, number>], Profile>("finish_calibration");
export const setCalibration = callable<
  [profileId: string, input: InputRef, calibration: Calibration],
  Profile
>("set_calibration");
