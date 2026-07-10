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

export type CalibrationRun = {
  axisRanges: Record<string, { min: number; max: number }>;
  pressedButtons: string[];
};

export type Profile = {
  id: string;
  name: string;
  deviceId: string | null;
  bindings: Binding[];
  calibrations: Record<string, Calibration>;
  calibrationRuns: Record<string, CalibrationRun>;
};

export type Device = {
  id: string;
  path: string;
  name: string;
  vendor: number;
  product: number;
  axes: Array<{
    code: number;
    name: string;
    min?: number | null;
    max?: number | null;
    value?: number | null;
    flat?: number | null;
    fuzz?: number | null;
    resolution?: number | null;
  }>;
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
  calibrating: boolean;
  outputGamepadName: string;
  outputKeyboardName: string;
};

export type InputSnapshot = {
  values: Record<string, number>;
  axisRanges: Record<string, { min: number; max: number }>;
  pressedButtons: string[];
};

export type OutputOption = {
  code: string;
  name?: string;
};

export type OutputCatalog = {
  key: OutputOption[];
  keyCombo: OutputOption[];
  mouseButton: OutputOption[];
  mouseMove: OutputOption[];
  gamepadButton: OutputOption[];
  gamepadAxis: OutputOption[];
  layer: OutputOption[];
};

export type DebugReport = {
  text: string;
};

export const getStatus = callable<[], Status>("get_status");
export const getDebugReport = callable<[], DebugReport>("get_debug_report");
export const refreshDevices = callable<[], Device[]>("refresh_devices");
export const setEnabled = callable<[enabled: boolean, deviceId?: string], Status>("set_enabled");
export const setOutputNames = callable<
  [gamepadName: string, keyboardName: string],
  Status
>("set_output_names");
export const setProfile = callable<[profileId: string], Status>("set_profile");
export const createProfile = callable<[name: string], Profile>("create_profile");
export const deleteProfile = callable<[profileId: string], Status>("delete_profile");
export const getOutputCatalog = callable<[], OutputCatalog>("get_output_catalog");
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
