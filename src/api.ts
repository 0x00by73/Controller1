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

export type LogicalPosition = {
  id: string;
  label: string;
  conditions: Predicate[];
  action?: Action;
};

export type LogicalControl = {
  id: string;
  name: string;
  kind: "analog" | "button" | "switch2" | "switch3";
  sources: InputRef[];
  positions: LogicalPosition[];
  action?: Action;
  confidence: number;
  confirmed: boolean;
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
  logicalControls: LogicalControl[];
  outputMode: "standard" | "extended" | "hybrid";
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
  connected: boolean;
  activeProfileId: string;
  profiles: Profile[];
  devices: Device[];
  dependencyError: string | null;
  learning: boolean;
  calibrating: boolean;
  outputGamepadName: string;
  outputKeyboardName: string;
  discovering: boolean;
  bindAssisting: boolean;
  bindAssistControlId: string | null;
};

export type DiscoveryStatus = {
  active: boolean;
  state: string;
  prompt: string;
  candidate?: LogicalControl;
  changedInputs: InputRef[];
};

export type PipelineEntry = {
  logicalControlId: string;
  name: string;
  position?: string;
  physical?: {
    eventType: number;
    code: number;
    name: string;
    value?: number;
  };
  virtual?: {
    kind: string;
    code: string;
    value: number;
    emitted: boolean;
  };
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
export const startDiscovery = callable<[profileId: string], void>("start_discovery");
export const beginDiscoveryObservation = callable<[], void>("begin_discovery_observation");
export const finishDiscoveryObservation = callable<[], LogicalControl | void>("finish_discovery_observation");
export const stopDiscovery = callable<[], void>("stop_discovery");
export const getDiscoveryStatus = callable<[], DiscoveryStatus>("get_discovery_status");
export const saveLogicalControl = callable<
  [profileId: string, control: LogicalControl],
  LogicalControl
>("save_logical_control");
export const deleteLogicalControl = callable<
  [profileId: string, controlId: string],
  Profile
>("delete_logical_control");
export const startBindAssist = callable<
  [profileId: string, controlId: string],
  void
>("start_bind_assist");
export const stopBindAssist = callable<[], void>("stop_bind_assist");
export const getPipelineSnapshot = callable<[], PipelineEntry[]>("get_pipeline_snapshot");
