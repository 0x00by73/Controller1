import {
  ButtonItem,
  DialogButton,
  DropdownItem,
  Focusable,
  ModalRoot,
  Navigation,
  SidebarNavigation,
  SliderField,
  TextField,
  showModal,
} from "@decky/ui";
import {
  addEventListener,
  removeEventListener,
  toaster,
} from "@decky/api";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  FaBolt,
  FaBug,
  FaCheck,
  FaGamepad,
  FaHandPointer,
  FaLink,
  FaPlay,
  FaSlidersH,
  FaStop,
  FaTrash,
} from "react-icons/fa";
import {
  Action,
  Binding,
  Device,
  InputRef,
  InputSnapshot,
  LogicalControl,
  LogicalControlState,
  LogicalPosition,
  OutputCatalog,
  OutputOption,
  Profile,
  Status,
  beginCalibration,
  createProfile,
  deleteBinding,
  deleteLogicalControl,
  finishCalibration,
  getDebugReport,
  getLogicalControlStates,
  getOutputCatalog,
  getStatus,
  refreshDevices,
  saveBinding,
  saveLogicalControl,
  setEnabled,
  setOutputNames,
  setProfile,
  startBindAssist,
  startLearning,
  stopBindAssist,
} from "./api";
import { controllerStyles } from "./styles";

export const CONTROLLER_ROUTE = "/controller1";

const EMPTY_SNAPSHOT: InputSnapshot = {
  values: {},
  axisRanges: {},
  pressedButtons: [],
};

const ACTION_LABELS: Record<Action["type"], string> = {
  key: "Keyboard key",
  keyCombo: "Keyboard shortcut",
  mouseButton: "Mouse button",
  mouseMove: "Mouse movement",
  gamepadButton: "Gamepad button",
  gamepadAxis: "Gamepad axis",
  layer: "Hold layer",
};

const AXIS_POSITION_PRESETS = [
  { label: "Low", range: [-1, -0.55] as [number, number] },
  { label: "Center", range: [-0.45, 0.45] as [number, number] },
  { label: "High", range: [0.55, 1] as [number, number] },
];

const eventKey = (input: InputRef) => `${input.eventType}:${input.code}`;
const inputType = (input: InputRef) => input.eventType === 3 ? "Axis" : "Button";

const STANDARD_INPUT_NAMES: Record<string, string> = {
  BTN_SOUTH: "A button",
  BTN_EAST: "B button",
  BTN_NORTH: "Y button",
  BTN_WEST: "X button",
  BTN_TL: "Left bumper",
  BTN_TR: "Right bumper",
  BTN_TL2: "Left trigger",
  BTN_TR2: "Right trigger",
  BTN_SELECT: "View button",
  BTN_START: "Menu button",
  BTN_MODE: "Guide button",
  BTN_THUMBL: "Left stick click",
  BTN_THUMBR: "Right stick click",
  ABS_X: "Left stick horizontal",
  ABS_Y: "Left stick vertical",
  ABS_RX: "Right stick horizontal",
  ABS_RY: "Right stick vertical",
  ABS_Z: "Left trigger",
  ABS_RZ: "Right trigger",
  ABS_HAT0X: "D-pad horizontal",
  ABS_HAT0Y: "D-pad vertical",
};

const STANDARD_INPUT_CODE_NAMES: Record<string, string> = {
  "1:304": "A button",
  "1:305": "B button",
  "1:307": "Y button",
  "1:308": "X button",
  "1:310": "Left bumper",
  "1:311": "Right bumper",
  "1:312": "Left trigger",
  "1:313": "Right trigger",
  "1:314": "View button",
  "1:315": "Menu button",
  "1:316": "Guide button",
  "1:317": "Left stick click",
  "1:318": "Right stick click",
  "3:0": "Left stick horizontal",
  "3:1": "Left stick vertical",
  "3:2": "Left trigger",
  "3:3": "Right stick horizontal",
  "3:4": "Right stick vertical",
  "3:5": "Right trigger",
  "3:16": "D-pad horizontal",
  "3:17": "D-pad vertical",
};

function friendlyInputName(input: InputRef): string {
  if (input.eventType === 1 && input.code >= 288 && input.code <= 299) {
    return `Button ${input.code - 287}`;
  }
  const byCode = STANDARD_INPUT_CODE_NAMES[eventKey(input)];
  if (byCode) return byCode;
  const known = STANDARD_INPUT_NAMES[input.name];
  if (known) return known;
  const tupleAlias = /^\s*[\[(].*,.*[\])]\s*$/.test(input.name);
  return tupleAlias || !input.name.trim() ? `${inputType(input)} ${input.code}` : input.name;
}

function actionLabel(action?: Action): string {
  if (!action) return "Assigned automatically";
  const output = action.code || action.codes?.join("+") || "Automatic";
  return `${ACTION_LABELS[action.type]} · ${STANDARD_INPUT_NAMES[output] ?? output}`;
}

function virtualOutputLabel(
  code: string,
  type: Action["type"],
  catalog: OutputCatalog | undefined,
): string {
  const pool = catalog?.[type === "gamepadAxis" ? "gamepadAxis" : type === "key" ? "key" : "gamepadButton"] ?? [];
  const match = pool.find((item) => item.code === code);
  if (match?.name && match.name !== match.code) return match.name;
  return STANDARD_INPUT_NAMES[code] ?? code;
}

function groupedGamepadOutputs(catalog: OutputCatalog | undefined) {
  const outputs = outputOptions(catalog, "gamepadButton");
  return {
    standard: outputs.filter((item) => !item.code.startsWith("BTN_TRIGGER_HAPPY")),
    extended: outputs.filter((item) => item.code.startsWith("BTN_TRIGGER_HAPPY")),
  };
}

function outputPickerOptions(
  catalog: OutputCatalog | undefined,
  type: "gamepadButton" | "key",
) {
  const outputs = outputOptions(catalog, type);
  return outputs.map((option) => ({
    data: option.code,
    label: option.name && option.name !== option.code
      ? `${option.name} (${option.code})`
      : option.code,
  }));
}

type ControlTypeOption = {
  id: string;
  label: string;
  description: string;
  kind: LogicalControl["kind"];
};

function findLogicalControlForInput(
  input: InputRef,
  controls: LogicalControl[],
): LogicalControl | undefined {
  const key = eventKey(input);
  return controls.find((control) => (
    control.sources.some((source) => eventKey(source) === key)
    || control.positions.some((position) => position.conditions.some(
      (condition) => eventKey(condition.input) === key,
    ))
  ));
}

function controlTypeOptions(inputs: InputRef[]): ControlTypeOption[] {
  const axisCount = inputs.filter((input) => input.eventType === 3).length;
  const buttonCount = inputs.filter((input) => input.eventType === 1).length;
  const options: ControlTypeOption[] = [];

  if (inputs.length === 1 && axisCount === 1) {
    options.push(
      {
        id: "analog",
        label: "Analog axis",
        description: "Continuous stick, trigger, or dial.",
        kind: "analog",
      },
      {
        id: "switch3-axis",
        label: "3-position switch",
        description: "Low, center, and high ranges on one axis.",
        kind: "switch3",
      },
    );
  }
  if (inputs.length === 1 && buttonCount === 1) {
    options.push({
      id: "button",
      label: "Momentary button",
      description: "Press and release.",
      kind: "button",
    });
  }
  if (inputs.length === 2 && buttonCount === 2) {
    options.push(
      {
        id: "switch3-paired",
        label: "3-position switch (paired)",
        description: "Two contacts, three positions — typical RC transmitter style.",
        kind: "switch3",
      },
      {
        id: "switch2",
        label: "2-position switch",
        description: "Two inputs; highest active position wins.",
        kind: "switch2",
      },
      {
        id: "push-push",
        label: "Push-push toggle",
        description: "Two-state toggle.",
        kind: "switch2",
      },
    );
  }
  if (inputs.length === 3 && buttonCount === 3) {
    options.push({
      id: "switch3",
      label: "3-position switch (3 inputs)",
      description: "RC-style: High beats Center beats Low when contacts overlap.",
      kind: "switch3",
    });
  }
  return options;
}

function buildLogicalControlFromSelection(
  inputs: InputRef[],
  type: ControlTypeOption,
): LogicalControl {
  const id = `control-${Date.now()}`;
  const name = inputs.map(friendlyInputName).join(" / ");

  if (type.kind === "analog") {
    return {
      id,
      name,
      kind: "analog",
      sources: inputs,
      positions: [],
      confidence: 1,
      confirmed: true,
    };
  }

  if (type.kind === "button") {
    return {
      id,
      name,
      kind: "button",
      sources: inputs,
      positions: [{
        id: "pressed",
        label: "Pressed",
        conditions: [{ input: inputs[0], test: "pressed" }],
      }],
      confidence: 1,
      confirmed: true,
    };
  }

  if (type.kind === "switch2") {
    const labels = type.id === "push-push" ? ["Off", "On"] : ["Position 1", "Position 2"];
    return {
      id,
      name,
      kind: "switch2",
      sources: inputs,
      positions: inputs.map((input, index) => ({
        id: `pos-${index}`,
        label: labels[index] ?? `Position ${index + 1}`,
        conditions: [{ input, test: "pressed" }],
      })),
      confidence: 1,
      confirmed: true,
    };
  }

  if (type.id === "switch3-paired") {
    const [first, second] = inputs;
    return {
      id,
      name,
      kind: "switch3",
      sources: inputs,
      positions: [
        {
          id: "low",
          label: "Low",
          conditions: [
            { input: first, test: "pressed" },
            { input: second, test: "released" },
          ],
        },
        {
          id: "center",
          label: "Center",
          conditions: [
            { input: first, test: "released" },
            { input: second, test: "released" },
          ],
        },
        {
          id: "high",
          label: "High",
          conditions: [
            { input: first, test: "released" },
            { input: second, test: "pressed" },
          ],
        },
      ],
      confidence: 1,
      confirmed: true,
    };
  }

  if (type.id === "switch3-axis") {
    const source = inputs[0];
    return {
      id,
      name: friendlyInputName(source),
      kind: "switch3",
      sources: inputs,
      positions: AXIS_POSITION_PRESETS.map((preset) => ({
        id: preset.label.toLowerCase(),
        label: preset.label,
        conditions: [{
          input: source,
          test: "axisRange",
          axisRange: preset.range,
        }],
      })),
      confidence: 1,
      confirmed: true,
    };
  }

  return {
    id,
    name,
    kind: "switch3",
    sources: inputs,
    positions: inputs.map((input, index) => ({
      id: `pos-${index}`,
      label: ["Low", "Center", "High"][index] ?? `Position ${index + 1}`,
      conditions: [{ input, test: "pressed" }],
    })),
    confidence: 1,
    confirmed: true,
  };
}

function inputAlreadyGrouped(
  input: InputRef,
  controls: LogicalControl[],
): boolean {
  return Boolean(findLogicalControlForInput(input, controls));
}

function notifyError(error: unknown) {
  toaster.toast({ title: "Controller1", body: String(error), critical: true });
}

function useController() {
  const [status, setStatus] = useState<Status>();
  const [catalog, setCatalog] = useState<OutputCatalog>();
  const [snapshot, setSnapshotState] = useState<InputSnapshot>(EMPTY_SNAPSHOT);
  const [learned, setLearned] = useState<InputRef[]>([]);
  const latestSnapshot = useRef(EMPTY_SNAPSHOT);
  const snapshotFrame = useRef<number | null>(null);

  const queueSnapshot = useCallback((next: InputSnapshot) => {
    latestSnapshot.current = next;
    if (snapshotFrame.current !== null) return;
    snapshotFrame.current = window.requestAnimationFrame(() => {
      snapshotFrame.current = null;
      setSnapshotState(latestSnapshot.current);
    });
  }, []);

  const setSnapshot = useCallback((next: InputSnapshot) => {
    latestSnapshot.current = next;
    setSnapshotState(next);
  }, []);

  const reload = useCallback(async () => {
    const next = await getStatus();
    setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    Promise.all([reload(), getOutputCatalog().then(setCatalog)]).catch(notifyError);

    const statusListener = addEventListener<[Status]>("status_changed", setStatus);
    const devicesListener = addEventListener<[Device[]]>("devices_changed", (devices) => {
      setStatus((current) => current
        ? {
          ...current,
          devices,
          connected: current.enabled && devices.some((device) => device.active),
        }
        : current);
    });
    const snapshotListener = addEventListener<[InputSnapshot]>("input_snapshot", queueSnapshot);
    const learnedListener = addEventListener<[InputRef]>("learned_input", (input) => {
      setLearned((current) => current.some((item) => eventKey(item) === eventKey(input))
        ? current
        : [...current, input]);
      setStatus((current) => current ? { ...current, learning: false } : current);
    });
    const learningListener = addEventListener<[boolean]>("learning_changed", (learning) => {
      setStatus((current) => current ? { ...current, learning } : current);
    });

    return () => {
      removeEventListener("status_changed", statusListener);
      removeEventListener("devices_changed", devicesListener);
      removeEventListener("input_snapshot", snapshotListener);
      removeEventListener("learned_input", learnedListener);
      removeEventListener("learning_changed", learningListener);
      if (snapshotFrame.current !== null) {
        window.cancelAnimationFrame(snapshotFrame.current);
        snapshotFrame.current = null;
      }
    };
  }, [queueSnapshot, reload]);

  return {
    status,
    setStatus,
    catalog,
    snapshot,
    setSnapshot,
    learned,
    setLearned,
    reload,
  };
}

function PageHeader({
  title,
  description,
  badge,
}: {
  title: string;
  description: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="Controller1_SectionHeader">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {badge}
    </div>
  );
}

function SetupPage({
  status,
  setStatus,
  reload,
}: {
  status: Status;
  setStatus: (status: Status) => void;
  reload: () => Promise<Status>;
}) {
  const activeProfile = status.profiles.find((profile) => profile.id === status.activeProfileId);
  const [selectedDevice, setSelectedDevice] = useState(
    activeProfile?.deviceId ?? status.devices[0]?.id ?? "",
  );
  const [gamepadName, setGamepadName] = useState(status.outputGamepadName);
  const [keyboardName, setKeyboardName] = useState(status.outputKeyboardName);
  const [profileName, setProfileName] = useState("");

  useEffect(() => {
    setGamepadName(status.outputGamepadName);
    setKeyboardName(status.outputKeyboardName);
  }, [status.outputGamepadName, status.outputKeyboardName]);

  useEffect(() => {
    if (activeProfile?.deviceId) setSelectedDevice(activeProfile.deviceId);
  }, [activeProfile?.deviceId]);

  const selected = status.devices.find((device) => device.id === selectedDevice);
  const updateEnabled = async () => {
    try {
      setStatus(await setEnabled(!status.enabled, selectedDevice || undefined));
    } catch (error) {
      notifyError(error);
    }
  };

  return (
    <Focusable className="Controller1_Content" flow-children="column">
      <div className="Controller1_Hero">
        <div>
          <h1 className="Controller1_Title">
            {status.connected ? status.outputGamepadName : "Connect a controller"}
          </h1>
          <div className="Controller1_Subtitle">
            {status.connected && selected
              ? `${selected.name} is captured and emitting virtual devices.`
              : "Choose the physical input and virtual device identity."}
          </div>
        </div>
        <span className={`Controller1_Badge ${status.connected ? "Controller1_Badge--good" : ""}`}>
          {status.connected ? <><FaCheck /> Connected</> : "Disconnected"}
        </span>
      </div>

      {status.dependencyError && <div className="Controller1_Error">{status.dependencyError}</div>}

      <PageHeader
        title="Physical controller"
        description="Controller1 exclusively captures this evdev device while connected."
      />
      <DropdownItem
        label="Input device"
        description={selected
          ? `${selected.axes.length} axes · ${selected.buttons.length} buttons · ${selected.vendor.toString(16).padStart(4, "0")}:${selected.product.toString(16).padStart(4, "0")}`
          : "No controller selected"}
        rgOptions={status.devices.map((device) => ({ data: device.id, label: device.name }))}
        selectedOption={selectedDevice}
        disabled={status.enabled}
        onChange={(option) => setSelectedDevice(String(option.data))}
      />
      <div className="Controller1_Actions">
        <DialogButton onClick={() => refreshDevices().then(reload).catch(notifyError)}>
          Refresh
        </DialogButton>
        <DialogButton
          disabled={!selectedDevice || Boolean(status.dependencyError)}
          onClick={updateEnabled}
        >
          {status.enabled ? "Disconnect" : "Connect"}
        </DialogButton>
      </div>

      <PageHeader
        title="Virtual identity"
        description="Names are global. Changing them recreates both uinput devices."
      />
      <div className="Controller1_Grid">
        <TextField
          label="Virtual gamepad"
          value={gamepadName}
          onChange={(event) => setGamepadName(event.currentTarget.value)}
        />
        <TextField
          label="Virtual keyboard and mouse"
          value={keyboardName}
          onChange={(event) => setKeyboardName(event.currentTarget.value)}
        />
      </div>
      <div className="Controller1_Actions">
        <DialogButton
          disabled={!gamepadName.trim() || !keyboardName.trim()}
          onClick={() => setOutputNames(gamepadName, keyboardName).then(setStatus).catch(notifyError)}
        >
          Save device names
        </DialogButton>
      </div>

      <PageHeader
        title="Profile"
        description="Controls and mappings are isolated per profile."
      />
      <DropdownItem
        label="Active profile"
        rgOptions={status.profiles.map((profile) => ({ data: profile.id, label: profile.name }))}
        selectedOption={status.activeProfileId}
        onChange={(option) => setProfile(String(option.data)).then(setStatus).catch(notifyError)}
      />
      <div className="Controller1_Grid">
        <TextField
          label="New profile"
          value={profileName}
          onChange={(event) => setProfileName(event.currentTarget.value)}
        />
        <div className="Controller1_Actions">
          <DialogButton
            disabled={!profileName.trim()}
            onClick={() => createProfile(profileName)
              .then(() => {
                setProfileName("");
                return reload();
              })
              .catch(notifyError)}
          >
            Create profile
          </DialogButton>
        </div>
      </div>
    </Focusable>
  );
}

const AxisCard = memo(function AxisCard({
  axis,
  current,
  observedMin,
  observedMax,
  stored,
  onSelect,
  selected,
  groupLabel,
  selectMode,
}: {
  axis: Device["axes"][number];
  current: number;
  observedMin?: number;
  observedMax?: number;
  stored?: { min: number; center: number; max: number };
  onSelect: (input: InputRef) => void;
  selected?: boolean;
  groupLabel?: string;
  selectMode?: boolean;
}) {
  const input = { eventType: 3, code: axis.code, name: axis.name };
  const minimum = axis.min ?? stored?.min ?? observedMin ?? -32768;
  const maximum = axis.max ?? stored?.max ?? observedMax ?? 32767;
  const span = Math.max(1, maximum - minimum);
  const position = Math.max(0, Math.min(100, ((current - minimum) / span) * 100));
  const hasObservedRange = observedMin !== undefined && observedMax !== undefined;
  const observedStart = hasObservedRange
    ? Math.max(0, Math.min(100, ((observedMin - minimum) / span) * 100))
    : position;
  const observedEnd = hasObservedRange
    ? Math.max(0, Math.min(100, ((observedMax - minimum) / span) * 100))
    : position;
  const coverage = hasObservedRange
    ? Math.max(0, Math.min(1, (observedMax - observedMin) / span))
    : 0;

  return (
    <Focusable
      className={[
        "Controller1_Card",
        "Controller1_Control",
        coverage >= 0.8 ? "Controller1_Card--active" : "",
        selected ? "Controller1_Control--selected" : "",
        groupLabel ? "Controller1_Control--grouped" : "",
      ].join(" ")}
      focusClassName="Controller1_Control--focused"
      onActivate={() => onSelect(input)}
      onClick={() => onSelect(input)}
      onOKActionDescription={selectMode ? "Toggle selection" : "Configure control"}
    >
      <div className="Controller1_CardTitle">
        <span>{friendlyInputName(input)}</span>
        <span className="Controller1_ControlBadges">
          {groupLabel && <span className="Controller1_Badge Controller1_Badge--group">{groupLabel}</span>}
          {selected && <span className="Controller1_Badge Controller1_Badge--good"><FaCheck /> Selected</span>}
          <span className={`Controller1_Badge ${coverage >= 0.8 ? "Controller1_Badge--good" : ""}`}>
            {Math.round(coverage * 100)}%
          </span>
        </span>
      </div>
      <div className="Controller1_Meta">EV_ABS · code {axis.code} · raw {current}</div>
      <div className="Controller1_AxisTrack">
        <div
          className="Controller1_AxisObserved"
          style={{ left: `${observedStart}%`, width: `${Math.max(1, observedEnd - observedStart)}%` }}
        />
        <div className="Controller1_AxisCenter" style={{ left: "50%" }} />
        <div className="Controller1_AxisValue" style={{ left: `${position}%` }} />
      </div>
      <div className="Controller1_AxisLabels">
        <span>{observedMin ?? "—"} / {minimum}</span>
        <span>{stored ? `center ${stored.center}` : "center"}</span>
        <span>{observedMax ?? "—"} / {maximum}</span>
      </div>
    </Focusable>
  );
});

const ButtonControl = memo(function ButtonControl({
  button,
  pressed,
  seen,
  onSelect,
  selected,
  groupLabel,
  selectMode,
}: {
  button: Device["buttons"][number];
  pressed: boolean;
  seen: boolean;
  onSelect: (input: InputRef) => void;
  selected?: boolean;
  groupLabel?: string;
  selectMode?: boolean;
}) {
  const input = { eventType: 1, code: button.code, name: button.name };
  return (
    <Focusable
      className={[
        "Controller1_ButtonChip",
        "Controller1_Control",
        pressed ? "Controller1_ButtonChip--pressed" : "",
        seen ? "Controller1_ButtonChip--seen" : "",
        selected ? "Controller1_Control--selected" : "",
        groupLabel ? "Controller1_Control--grouped" : "",
      ].join(" ")}
      focusClassName="Controller1_Control--focused"
      onActivate={() => onSelect(input)}
      onClick={() => onSelect(input)}
      onOKActionDescription={selectMode ? "Toggle selection" : "Configure control"}
    >
      <div className="Controller1_ButtonName">{friendlyInputName(input)}</div>
      <div className="Controller1_Meta">
        EV_KEY · {button.code}
        {groupLabel && <span className="Controller1_GroupTag">{groupLabel}</span>}
        {selected && <span className="Controller1_GroupTag Controller1_GroupTag--selected">Selected</span>}
      </div>
    </Focusable>
  );
});

function ControlLivePreview({
  control,
  catalog,
  connected,
}: {
  control: LogicalControl;
  catalog: OutputCatalog | undefined;
  connected: boolean;
}) {
  const [states, setStates] = useState<LogicalControlState[]>([]);

  const refresh = useCallback(async () => {
    try {
      setStates(await getLogicalControlStates(control.id));
    } catch {
      setStates([]);
    }
  }, [control.id]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 250);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (!connected) {
    return <div className="Controller1_Empty Controller1_Empty--compact">Connect a controller to preview output.</div>;
  }

  const rows = control.kind === "analog"
    ? [{
        id: "analog",
        label: control.name,
        action: control.action,
      }]
    : control.positions.map((position) => ({
        id: position.id,
        label: position.label,
        action: position.action,
      }));

  return (
    <div className="Controller1_PreviewTable" aria-live="polite">
      {rows.map((row) => {
        const live = states.find((item) => item.positionId === row.id);
        const outputCode = live?.outputCode ?? row.action?.code ?? "—";
        const outputType = live?.outputType ?? row.action?.type ?? "gamepadButton";
        const active = live?.active ?? false;
        const emitted = live?.emitted ?? false;
        return (
          <div
            className={[
              "Controller1_PreviewRow",
              active ? "Controller1_PreviewRow--active" : "",
              emitted ? "Controller1_PreviewRow--emitted" : "",
            ].join(" ")}
            key={row.id}
          >
            <div className="Controller1_PreviewCell">
              <span>Position</span>
              <strong>{row.label}</strong>
            </div>
            <span className="Controller1_PipelineArrow">→</span>
            <div className="Controller1_PreviewCell">
              <span>Output</span>
              <strong>{virtualOutputLabel(outputCode, outputType, catalog)}</strong>
              <small>{outputCode}</small>
            </div>
            <div className="Controller1_PreviewStatus">
              {emitted ? "Emitting" : active ? "Matched" : "Idle"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ConfiguredControlsSection({
  controls,
  onEdit,
  onCombine,
}: {
  controls: LogicalControl[];
  onEdit: (control: LogicalControl) => void;
  onCombine: () => void;
}) {
  return (
    <section className="Controller1_Section Controller1_Section--configured">
      <div className="Controller1_SectionHeader">
        <div>
          <h2>Your controls</h2>
          <p>Combined switches and grouped inputs. Tap a card to edit mappings and preview.</p>
        </div>
        <DialogButton onClick={onCombine}>
          <FaHandPointer /> Combine inputs
        </DialogButton>
      </div>
      {controls.length === 0 ? (
        <div className="Controller1_Empty Controller1_Empty--compact">
          No combined controls yet. Tap Combine inputs, select related hardware inputs below, then choose a control type.
        </div>
      ) : (
        <div className="Controller1_ControlInventory">
          {controls.map((control) => (
            <Focusable
              key={control.id}
              className="Controller1_InventoryCard"
              onActivate={() => onEdit(control)}
              onClick={() => onEdit(control)}
              onOKActionDescription="Edit control"
            >
              <div className="Controller1_CardTitle">
                <span>{control.name}</span>
                <span className="Controller1_Badge">{control.kind}</span>
              </div>
              <div className="Controller1_InventorySummary">
                {control.kind === "analog" ? (
                  <span>{actionLabel(control.action)}</span>
                ) : (
                  control.positions.map((position) => (
                    <span className="Controller1_InventoryPosition" key={position.id}>
                      <strong>{position.label}</strong>
                      <span>{actionLabel(position.action)}</span>
                    </span>
                  ))
                )}
              </div>
            </Focusable>
          ))}
        </div>
      )}
    </section>
  );
}

function SelectionDock({
  selected,
  canCreate,
  onClear,
  onCancel,
  onCreate,
}: {
  selected: InputRef[];
  canCreate: boolean;
  onClear: () => void;
  onCancel: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="Controller1_SelectionDock">
      <div className="Controller1_SelectionDockHeader">
        <strong>Selecting inputs</strong>
        <span className="Controller1_Badge Controller1_Badge--warn">{selected.length} / 3</span>
      </div>
      <p className="Controller1_Subtitle">
        Tap hardware inputs in the grid. When ready, create a switch or other control type.
      </p>
      <div className="Controller1_Chips Controller1_Chips--dock">
        {selected.length === 0 ? (
          <span className="Controller1_Subtitle">Nothing selected yet.</span>
        ) : (
          selected.map((input) => (
            <span className="Controller1_Chip Controller1_Chip--dock" key={eventKey(input)}>
              {input.eventType === 3 ? <FaSlidersH /> : <FaGamepad />}
              {friendlyInputName(input)}
            </span>
          ))
        )}
      </div>
      <div className="Controller1_Actions Controller1_Actions--dock">
        <DialogButton onClick={onCancel}>Cancel</DialogButton>
        <DialogButton disabled={selected.length === 0} onClick={onClear}>Clear</DialogButton>
        <DialogButton disabled={!canCreate} onClick={onCreate}>Create control</DialogButton>
      </div>
    </div>
  );
}

function GroupedControlModal({
  control,
  profile,
  catalog,
  status,
  closeModal,
  onChanged,
}: {
  control: LogicalControl;
  profile: Profile;
  catalog: OutputCatalog | undefined;
  status: Status;
  closeModal: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const defaultName = control.name.trim() || friendlyInputName(control.sources[0] ?? { eventType: 1, code: 0, name: "" });
  const [draft, setDraft] = useState<LogicalControl>({
    ...control,
    name: defaultName,
    positions: control.positions.map((position, index) => ({
      ...position,
      label: position.label || `Position ${index + 1}`,
    })),
  });
  const [saving, setSaving] = useState(false);
  const bindActive = status.bindAssisting && status.bindAssistControlId === control.id;
  const gamepadGroups = groupedGamepadOutputs(catalog);

  useEffect(() => {
    setDraft({
      ...control,
      name: control.name.trim() || defaultName,
      positions: control.positions.map((position, index) => ({
        ...position,
        label: position.label || `Position ${index + 1}`,
      })),
    });
  }, [control, defaultName]);

  const updatePosition = (index: number, patch: Partial<LogicalPosition>) => {
    setDraft((current) => ({
      ...current,
      positions: current.positions.map((position, itemIndex) => itemIndex === index
        ? { ...position, ...patch }
        : position),
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveLogicalControl(profile.id, {
        ...draft,
        name: draft.name.trim() || defaultName,
        confirmed: true,
        positions: draft.positions.map((position, index) => ({
          ...position,
          label: position.label.trim() || `Position ${index + 1}`,
        })),
      });
      await onChanged();
      toaster.toast({ title: "Controller1", body: "Control saved" });
    } catch (error) {
      notifyError(error);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await deleteLogicalControl(profile.id, control.id);
      await onChanged();
      closeModal();
    } catch (error) {
      notifyError(error);
    }
  };

  const toggleBind = async () => {
    try {
      if (bindActive) await stopBindAssist();
      else await startBindAssist(profile.id, control.id);
      await onChanged();
    } catch (error) {
      notifyError(error);
    }
  };

  return (
    <ModalRoot
      closeModal={closeModal}
      onCancel={closeModal}
      className="Controller1_ModalRoot"
      modalClassName="Controller1_ModalFrame"
    >
      <Focusable className="Controller1 Controller1_Modal" flow-children="column">
        <header className="Controller1_ModalHeader">
          <div className="Controller1_ControlIcon" aria-hidden="true">
            <FaSlidersH />
          </div>
          <div className="Controller1_ModalTitle">
            <h2>{draft.name || defaultName}</h2>
            <p>{draft.kind} · {draft.positions.length || 1} position{(draft.positions.length || 1) === 1 ? "" : "s"}</p>
          </div>
          <span className={`Controller1_Badge ${bindActive ? "Controller1_Badge--warn" : ""}`}>
            {bindActive ? <><FaBolt /> Binding</> : draft.kind}
          </span>
        </header>
        <div className="Controller1_ModalBody">
          <TextField
            label="Control name"
            value={draft.name}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.currentTarget.value }))}
          />
          {draft.kind === "analog" ? (
            <section className="Controller1_Assigned">
              <div className="Controller1_FormHeading">
                <div>
                  <h3>Continuous output</h3>
                  <p>Mapped automatically to a free virtual axis when saved.</p>
                </div>
              </div>
              <div className="Controller1_PositionOutput">{actionLabel(draft.action)}</div>
            </section>
          ) : (
            <section className="Controller1_Assigned">
              <div className="Controller1_FormHeading">
                <div>
                  <h3>Position mappings</h3>
                  <p>
                    Virtual gamepad buttons are Linux uinput codes exposed to games.
                    Use them for in-game binding. Keyboard keys work for menus and desktop shortcuts.
                  </p>
                </div>
              </div>
              <div className="Controller1_Positions">
                {draft.positions.map((position, index) => {
                  const action = position.action;
                  const outputType = action?.type === "key" ? "key" : "gamepadButton";
                  const outputCode = action?.code ?? (
                    outputType === "key"
                      ? outputOptions(catalog, "key")[0]?.code ?? "KEY_A"
                      : gamepadGroups.standard[0]?.code ?? "BTN_SOUTH"
                  );
                  const options = outputPickerOptions(catalog, outputType);
                  return (
                    <div className="Controller1_PositionEditor" key={position.id}>
                      <TextField
                        label={`Position ${index + 1}`}
                        value={position.label}
                        onChange={(event) => updatePosition(index, { label: event.currentTarget.value })}
                      />
                      <DropdownItem
                        label="Output type"
                        rgOptions={[
                          { data: "gamepadButton", label: "Gamepad button (for games)" },
                          { data: "key", label: "Keyboard key (menus/desktop)" },
                        ]}
                        selectedOption={outputType}
                        onChange={(option) => {
                          const nextType = option.data as "gamepadButton" | "key";
                          const nextPool = outputPickerOptions(catalog, nextType);
                          updatePosition(index, {
                            action: {
                              type: nextType,
                              code: nextPool[0]?.data ? String(nextPool[0].data) : outputCode,
                            },
                          });
                        }}
                      />
                      <DropdownItem
                        label="Virtual output"
                        rgOptions={options}
                        selectedOption={outputCode}
                        onChange={(option) => updatePosition(index, {
                          action: {
                            type: outputType,
                            code: String(option.data),
                          },
                        })}
                      />
                    </div>
                  );
                })}
              </div>
              {gamepadGroups.extended.length > 0 && (
                <div className="Controller1_Subtitle">
                  Extra buttons (BTN_TRIGGER_HAPPY*) are additional virtual gamepad buttons beyond the standard 14.
                  Games that only read a standard pad may ignore them — try standard face buttons first if binding fails.
                </div>
              )}
            </section>
          )}
          <section className="Controller1_Assigned">
            <div className="Controller1_FormHeading">
              <div>
                <h3>Live preview</h3>
                <p>One row per position. Move the control to see which output is active.</p>
              </div>
            </div>
            <ControlLivePreview control={draft} catalog={catalog} connected={status.connected} />
          </section>
          {bindActive && (
            <div className="Controller1_BindBanner">
              Move the switch through each position one at a time. Bind assist holds the virtual button while you stay in that position.
            </div>
          )}
        </div>
        <footer className="Controller1_ModalFooter">
          <DialogButton onClick={remove}><FaTrash /> Delete</DialogButton>
          <DialogButton onClick={toggleBind}>
            {bindActive ? <><FaStop /> Stop bind assist</> : <><FaPlay /> Bind in game</>}
          </DialogButton>
          <DialogButton disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </DialogButton>
          <DialogButton onClick={closeModal}>Done</DialogButton>
        </footer>
      </Focusable>
    </ModalRoot>
  );
}

function ControlTypePickerModal({
  inputs,
  profileId,
  closeModal,
  onCreated,
}: {
  inputs: InputRef[];
  profileId: string;
  closeModal: () => void;
  onCreated: () => Promise<unknown>;
}) {
  const options = controlTypeOptions(inputs);
  const [busy, setBusy] = useState(false);

  const create = async (type: ControlTypeOption) => {
    setBusy(true);
    try {
      const control = buildLogicalControlFromSelection(inputs, type);
      const saved = await saveLogicalControl(profileId, control);
      await onCreated();
      closeModal();
      showGroupedControlModal(saved, profileId, onCreated);
      toaster.toast({ title: "Controller1", body: `${type.label} created` });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalRoot
      closeModal={closeModal}
      onCancel={closeModal}
      className="Controller1_ModalRoot"
      modalClassName="Controller1_ModalFrame"
    >
      <Focusable className="Controller1 Controller1_Modal" flow-children="column">
        <header className="Controller1_ModalHeader">
          <div className="Controller1_ControlIcon" aria-hidden="true"><FaHandPointer /></div>
          <div className="Controller1_ModalTitle">
            <h2>Create control</h2>
            <p>{inputs.length} input{inputs.length === 1 ? "" : "s"} selected</p>
          </div>
        </header>
        <div className="Controller1_ModalBody">
          <div className="Controller1_Chips">
            {inputs.map((input) => (
              <span className="Controller1_Chip" key={eventKey(input)}>
                {input.eventType === 3 ? <FaSlidersH /> : <FaGamepad />}
                {friendlyInputName(input)}
              </span>
            ))}
          </div>
          {options.length === 0 ? (
            <div className="Controller1_Empty">
              Select 1 axis, 1 button, 2 buttons, or 3 buttons to create a control.
            </div>
          ) : (
            <div className="Controller1_Stack">
              {options.map((option) => (
                <Focusable
                  key={option.id}
                  className="Controller1_Card Controller1_TypeOption"
                  onActivate={() => !busy && create(option)}
                  onClick={() => !busy && create(option)}
                >
                  <div className="Controller1_CardTitle">
                    <span>{option.label}</span>
                    <span className="Controller1_Badge">{option.kind}</span>
                  </div>
                  <div className="Controller1_Subtitle">{option.description}</div>
                </Focusable>
              ))}
            </div>
          )}
        </div>
        <footer className="Controller1_ModalFooter">
          <DialogButton onClick={closeModal}>Cancel</DialogButton>
        </footer>
      </Focusable>
    </ModalRoot>
  );
}

function showGroupedControlModal(
  control: LogicalControl,
  profileId: string,
  onChanged: () => Promise<unknown>,
) {
  let modal: ReturnType<typeof showModal>;
  const closeModal = () => modal.Close();
  const open = async () => {
    const [nextStatus, nextCatalog] = await Promise.all([getStatus(), getOutputCatalog()]);
    const profile = nextStatus.profiles.find((item) => item.id === profileId);
    if (!profile) return;
    const resolved = profile.logicalControls.find((item) => item.id === control.id) ?? control;
    modal = showModal(
      <GroupedControlModal
        control={resolved}
        profile={profile}
        catalog={nextCatalog}
        status={nextStatus}
        closeModal={closeModal}
        onChanged={async () => {
          await onChanged();
          const refreshed = await getStatus();
          const refreshedProfile = refreshed.profiles.find((item) => item.id === profileId);
          if (!refreshedProfile?.logicalControls.some((item) => item.id === control.id)) {
            closeModal();
          }
        }}
      />,
      window,
      { strTitle: "" },
    );
  };
  void open().catch(notifyError);
}

function showControlTypePickerModal(
  inputs: InputRef[],
  profileId: string,
  onCreated: () => Promise<unknown>,
) {
  let modal: ReturnType<typeof showModal>;
  const closeModal = () => modal.Close();
  modal = showModal(
    <ControlTypePickerModal
      inputs={inputs}
      profileId={profileId}
      closeModal={closeModal}
      onCreated={onCreated}
    />,
    window,
    { strTitle: "" },
  );
}

function CalibrationPage({
  status,
  catalog,
  snapshot,
  setSnapshot,
  setStatus,
  reload,
}: {
  status: Status;
  catalog: OutputCatalog | undefined;
  snapshot: InputSnapshot;
  setSnapshot: (snapshot: InputSnapshot) => void;
  setStatus: (status: Status) => void;
  reload: () => Promise<Status>;
}) {
  const profile = status.profiles.find((item) => item.id === status.activeProfileId);
  const device = status.devices.find((item) => item.id === profile?.deviceId && item.active)
    ?? status.devices.find((item) => item.active);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedInputs, setSelectedInputs] = useState<InputRef[]>([]);
  const persistedRun = device ? profile?.calibrationRuns[device.id] : undefined;
  const axisRanges = {
    ...(persistedRun?.axisRanges ?? {}),
    ...snapshot.axisRanges,
  };
  const seenButtons = new Set([
    ...(persistedRun?.pressedButtons ?? []),
    ...snapshot.pressedButtons,
  ]);
  const axisComplete = device?.axes.filter((axis) => {
    const observed = axisRanges[`3:${axis.code}`];
    const span = (axis.max ?? 0) - (axis.min ?? 0);
    return observed && (span > 0
      ? (observed.max - observed.min) / span >= 0.8
      : observed.max > observed.min);
  }).length ?? 0;
  const total = (device?.axes.length ?? 0) + (device?.buttons.length ?? 0);
  const buttonComplete = device?.buttons.filter((button) => seenButtons.has(`1:${button.code}`)).length ?? 0;
  const complete = axisComplete + buttonComplete;
  const progress = total ? Math.min(100, Math.round((complete / total) * 100)) : 0;
  const logicalControls = profile?.logicalControls ?? [];
  const typeOptions = controlTypeOptions(selectedInputs);

  const start = async () => {
    if (!device) return;
    setSnapshot(EMPTY_SNAPSHOT);
    try {
      await beginCalibration(device.axes.map((axis) => ({
        eventType: 3,
        code: axis.code,
        name: axis.name,
      })));
      await reload();
    } catch (error) {
      notifyError(error);
    }
  };

  const finish = async () => {
    if (!profile) return;
    try {
      await finishCalibration(profile.id);
      setStatus(await reload());
    } catch (error) {
      notifyError(error);
    }
  };


  const beginCombine = () => {
    setSelectedInputs([]);
    setSelectMode(true);
  };

  const toggleSelectedInput = useCallback((input: InputRef) => {
    if (inputAlreadyGrouped(input, logicalControls)) {
      toaster.toast({
        title: "Controller1",
        body: "That input is already part of a control group.",
      });
      return;
    }
    setSelectedInputs((current) => {
      const key = eventKey(input);
      const exists = current.some((item) => eventKey(item) === key);
      if (exists) return current.filter((item) => eventKey(item) !== key);
      if (current.length >= 3) {
        toaster.toast({ title: "Controller1", body: "Select up to 3 inputs at a time." });
        return current;
      }
      return [...current, input];
    });
  }, [logicalControls]);

  const activateControl = useCallback((input: InputRef) => {
    if (!profile) return;
    if (selectMode) {
      toggleSelectedInput(input);
      return;
    }
    const grouped = findLogicalControlForInput(input, logicalControls);
    if (grouped) {
      showGroupedControlModal(grouped, profile.id, reload);
      return;
    }
    showControlMappingModal(input, profile, catalog, reload);
  }, [catalog, logicalControls, profile, reload, selectMode, toggleSelectedInput]);

  const createFromSelection = () => {
    if (!profile || selectedInputs.length === 0) return;
    if (typeOptions.length === 0) {
      toaster.toast({
        title: "Controller1",
        body: "Select 1 axis, 1 button, 2 buttons, or 3 buttons.",
      });
      return;
    }
    showControlTypePickerModal(selectedInputs, profile.id, async () => {
      setSelectedInputs([]);
      setSelectMode(false);
      await reload();
    });
  };

  const groupLabelFor = (input: InputRef) => findLogicalControlForInput(input, logicalControls)?.name;
  const isSelected = (input: InputRef) => selectedInputs.some((item) => eventKey(item) === eventKey(input));

  if (!status.connected || !device || !profile) {
    return (
      <div className="Controller1_Content">
        <PageHeader
          title="Controls"
          description="Live controller inputs, calibration, and mapping."
        />
        <div className="Controller1_Empty">Open Setup and connect a controller.</div>
      </div>
    );
  }

  return (
    <Focusable className={`Controller1_Content ${selectMode ? "Controller1_Content--selecting" : ""}`} flow-children="column">
      <PageHeader
        title="Controls"
        description={selectMode
          ? "Selection mode — tap hardware inputs in the grid below."
          : status.calibrating
            ? "Calibration recording — exercise every axis and button."
            : "Tap a hardware input to map it, or combine inputs into a switch."}
        badge={(
          <span className={`Controller1_Badge ${selectMode || status.calibrating ? "Controller1_Badge--warn" : "Controller1_Badge--good"}`}>
            {selectMode
              ? <><FaHandPointer /> Selecting</>
              : status.calibrating
                ? <><FaBolt /> Calibrating</>
                : <><FaCheck /> Ready</>}
          </span>
        )}
      />

      <ConfiguredControlsSection
        controls={logicalControls}
        onEdit={(control) => showGroupedControlModal(control, profile.id, reload)}
        onCombine={beginCombine}
      />

      <section className="Controller1_Section">
        <div className="Controller1_SectionHeader">
          <div>
            <h2>Hardware inputs</h2>
            <p>
              Live view of your controller.
              {selectMode ? " Selected chips appear in the dock below." : " Grouped inputs show a badge."}
            </p>
          </div>
          <div className="Controller1_Actions Controller1_Actions--inline">
            <DialogButton onClick={status.calibrating ? finish : start}>
              {status.calibrating ? "Finish calibration" : `Calibrate (${progress}%)`}
            </DialogButton>
          </div>
        </div>

        {status.calibrating && (
          <div className="Controller1_Card Controller1_Card--compact">
            <div className="Controller1_Progress">
              <div className="Controller1_ProgressFill" style={{ width: `${progress}%` }} />
            </div>
            <div className="Controller1_Subtitle">{complete} of {total} inputs exercised</div>
          </div>
        )}

        <PageHeader
          title={`Axes · ${device.axes.length}`}
          description="White marker is live input; blue is observed range."
        />
        <div className="Controller1_Grid Controller1_Grid--three">
          {device.axes.map((axis) => {
            const input = { eventType: 3, code: axis.code, name: axis.name };
            return (
              <AxisCard
                key={axis.code}
                axis={axis}
                current={snapshot.values[`3:${axis.code}`] ?? axis.value ?? profile.calibrations[`3:${axis.code}`]?.center ?? 0}
                observedMin={axisRanges[`3:${axis.code}`]?.min}
                observedMax={axisRanges[`3:${axis.code}`]?.max}
                stored={profile.calibrations[`3:${axis.code}`]}
                onSelect={activateControl}
                selected={isSelected(input)}
                groupLabel={groupLabelFor(input)}
                selectMode={selectMode}
              />
            );
          })}
        </div>

        <PageHeader
          title={`Buttons · ${device.buttons.length}`}
          description="Blue = pressed now. Green = seen during calibration."
        />
        <div className="Controller1_ButtonGrid">
          {device.buttons.map((button) => {
            const input = { eventType: 1, code: button.code, name: button.name };
            return (
              <ButtonControl
                key={button.code}
                button={button}
                pressed={Boolean(snapshot.values[`1:${button.code}`])}
                seen={seenButtons.has(`1:${button.code}`)}
                onSelect={activateControl}
                selected={isSelected(input)}
                groupLabel={groupLabelFor(input)}
                selectMode={selectMode}
              />
            );
          })}
        </div>
      </section>

      {selectMode && (
        <SelectionDock
          selected={selectedInputs}
          canCreate={selectedInputs.length > 0 && typeOptions.length > 0}
          onClear={() => setSelectedInputs([])}
          onCancel={() => {
            setSelectMode(false);
            setSelectedInputs([]);
          }}
          onCreate={createFromSelection}
        />
      )}
    </Focusable>
  );
}

function outputOptions(catalog: OutputCatalog | undefined, type: Action["type"]): OutputOption[] {
  return catalog?.[type] ?? [];
}

function MappingBuilder({
  profileId,
  source,
  catalog,
  onSaved,
}: {
  profileId: string;
  source: InputRef;
  catalog: OutputCatalog | undefined;
  onSaved: (binding: Binding) => void;
}) {
  const [actionType, setActionType] = useState<Action["type"]>("gamepadButton");
  const [outputCode, setOutputCode] = useState("BTN_SOUTH");
  const [name, setName] = useState("");
  const [low, setLow] = useState(-0.45);
  const [high, setHigh] = useState(0.45);
  const outputs = outputOptions(catalog, actionType);
  const customOutput = actionType === "keyCombo" || actionType === "layer";

  useEffect(() => {
    if (!customOutput && outputs[0] && !outputs.some((item) => item.code === outputCode)) {
      setOutputCode(outputs[0].code);
    }
  }, [customOutput, outputCode, outputs]);

  const submit = async () => {
    if (!outputCode.trim()) return;
    const continuous = actionType === "gamepadAxis" || actionType === "mouseMove";
    const action: Action = {
      type: actionType,
      code: outputCode.trim(),
      ...(actionType === "keyCombo"
        ? { codes: outputCode.split("+").map((code) => code.trim()).filter(Boolean) }
        : {}),
      ...(continuous ? { source } : {}),
    };
    const binding: Binding = {
      name: name.trim() || `${friendlyInputName(source)} → ${outputCode}`,
      layer: "base",
      conditions: continuous ? [] : [{
        input: source,
        test: source.eventType === 3 ? "axisRange" : "pressed",
        ...(source.eventType === 3 ? { axisRange: [low, high] as [number, number] } : {}),
      }],
      action,
    };
    try {
      const saved = await saveBinding(profileId, binding);
      setName("");
      onSaved(saved);
    } catch (error) {
      notifyError(error);
    }
  };

  return (
    <section className="Controller1_MappingBuilder">
      <div className="Controller1_FormHeading">
        <div>
          <h3>New mapping</h3>
          <p>Choose what this control should emit.</p>
        </div>
      </div>
      <div className="Controller1_FormGrid">
        <DropdownItem
          label="Output type"
          rgOptions={(Object.keys(ACTION_LABELS) as Action["type"][])
            .map((type) => ({ data: type, label: ACTION_LABELS[type] }))}
          selectedOption={actionType}
          onChange={(option) => setActionType(option.data as Action["type"])}
        />
        {customOutput ? (
          <TextField
            label={actionType === "layer" ? "Layer name" : "Shortcut"}
            description={actionType === "keyCombo" ? "Example: KEY_LEFTCTRL+KEY_C" : undefined}
            value={outputCode}
            onChange={(event) => setOutputCode(event.currentTarget.value)}
          />
        ) : (
          <DropdownItem
            label="Virtual output"
            rgOptions={outputs.map((option) => ({
              data: option.code,
              label: option.name && option.name !== option.code
                ? `${option.name} · ${option.code}`
                : option.code,
            }))}
            selectedOption={outputCode}
            onChange={(option) => setOutputCode(String(option.data))}
          />
        )}
      </div>
      {source?.eventType === 3 && actionType !== "gamepadAxis" && actionType !== "mouseMove" && (
        <div className="Controller1_RangeEditor">
          <div className="Controller1_FormHeading Controller1_FormHeading--compact">
            <div>
              <h3>Active range</h3>
              <p>RC switches use axes: save one gamepad-button mapping for each position.</p>
            </div>
            <span className="Controller1_RangeValue">{low.toFixed(2)} … {high.toFixed(2)}</span>
          </div>
          <div className="Controller1_Actions">
            {AXIS_POSITION_PRESETS.map((preset) => (
              <DialogButton
                key={preset.label}
                onClick={() => {
                  setLow(preset.range[0]);
                  setHigh(preset.range[1]);
                }}
              >
                {preset.label} position
              </DialogButton>
            ))}
          </div>
          <SliderField label="Start" value={low} min={-1} max={high} step={0.05} onChange={setLow} />
          <SliderField label="End" value={high} min={low} max={1} step={0.05} onChange={setHigh} />
        </div>
      )}
      <TextField
        label="Mapping name"
        description="Optional — a useful name makes profiles easier to scan."
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
      />
      <div className="Controller1_Actions Controller1_Actions--primary">
        <DialogButton disabled={!outputCode.trim()} onClick={submit}>
          Save mapping
        </DialogButton>
      </div>
    </section>
  );
}

function BindingList({
  profileId,
  bindings,
  onChanged,
}: {
  profileId: string;
  bindings: Binding[];
  onChanged: () => Promise<unknown>;
}) {
  if (!bindings.length) {
    return <div className="Controller1_Empty">Nothing configured yet.</div>;
  }
  return (
    <div className="Controller1_Stack">
      {bindings.map((binding) => (
        <div className="Controller1_MappingRow" key={binding.id}>
          <div>
            <strong>{binding.name}</strong>
            <div className="Controller1_MappingRoute">
              <span>
                {binding.conditions.map((condition) => friendlyInputName(condition.input)).join(" + ")
                  || (binding.action.source ? friendlyInputName(binding.action.source) : "")}
              </span>
              <span>→</span>
              <span>{ACTION_LABELS[binding.action.type]} · {binding.action.code || binding.action.codes?.join("+")}</span>
            </div>
          </div>
          <DialogButton
            disabled={!binding.id}
            onClick={() => binding.id
              && deleteBinding(profileId, binding.id).then(onChanged).catch(notifyError)}
          >
            <FaTrash />
          </DialogButton>
        </div>
      ))}
    </div>
  );
}

function ControlMappingModal({
  input,
  profile,
  catalog,
  closeModal,
  onChanged,
}: {
  input: InputRef;
  profile: Profile;
  catalog: OutputCatalog | undefined;
  closeModal: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const matchesInput = (binding: Binding) => {
    const source = binding.conditions[0]?.input ?? binding.action.source;
    return source ? eventKey(source) === eventKey(input) : false;
  };
  const [mappings, setMappings] = useState(profile.bindings.filter(matchesInput));

  const saved = (binding: Binding) => {
    setMappings((current) => [
      ...current.filter((item) => item.id !== binding.id),
      binding,
    ]);
    void onChanged();
  };

  const remove = async (bindingId: string) => {
    try {
      const updated = await deleteBinding(profile.id, bindingId);
      setMappings(updated.bindings.filter(matchesInput));
      await onChanged();
    } catch (error) {
      notifyError(error);
    }
  };

  return (
    <ModalRoot
      closeModal={closeModal}
      onCancel={closeModal}
      className="Controller1_ModalRoot"
      modalClassName="Controller1_ModalFrame"
    >
      <Focusable className="Controller1 Controller1_Modal" flow-children="column">
        <header className="Controller1_ModalHeader">
          <div className="Controller1_ControlIcon" aria-hidden="true">
            {input.eventType === 3 ? <FaSlidersH /> : <FaGamepad />}
          </div>
          <div className="Controller1_ModalTitle">
            <h2>{friendlyInputName(input)}</h2>
            <p>{inputType(input)} · code {input.code} · {profile.name} profile</p>
          </div>
          <span className="Controller1_Badge">
            {mappings.length} {mappings.length === 1 ? "mapping" : "mappings"}
          </span>
        </header>
        <div className="Controller1_ModalBody">
          <MappingBuilder
            profileId={profile.id}
            source={input}
            catalog={catalog}
            onSaved={saved}
          />
          <section className="Controller1_Assigned">
            <div className="Controller1_FormHeading">
              <div>
                <h3>Assigned outputs</h3>
                <p>Mappings already attached to this control.</p>
              </div>
            </div>
            {mappings.length === 0 ? (
              <div className="Controller1_Empty Controller1_Empty--compact">
                No outputs yet. Save a mapping above to add one.
              </div>
            ) : (
              <div className="Controller1_Stack">
                {mappings.map((binding) => (
                  <div className="Controller1_MappingRow" key={binding.id}>
                    <div>
                      <strong>{binding.name}</strong>
                      <div className="Controller1_MappingRoute">
                        <span>{ACTION_LABELS[binding.action.type]}</span>
                        <span>→</span>
                        <span>{binding.action.code || binding.action.codes?.join("+")}</span>
                      </div>
                    </div>
                    <DialogButton
                      aria-label={`Delete ${binding.name}`}
                      disabled={!binding.id}
                      onClick={() => binding.id && remove(binding.id)}
                    >
                      <FaTrash />
                    </DialogButton>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
        <footer className="Controller1_ModalFooter">
          <DialogButton onClick={closeModal}>Done</DialogButton>
        </footer>
      </Focusable>
    </ModalRoot>
  );
}

function showControlMappingModal(
  input: InputRef,
  profile: Profile,
  catalog: OutputCatalog | undefined,
  onChanged: () => Promise<unknown>,
) {
  let modal: ReturnType<typeof showModal>;
  const closeModal = () => modal.Close();
  modal = showModal(
    <ControlMappingModal
      input={input}
      profile={profile}
      catalog={catalog}
      closeModal={closeModal}
      onChanged={onChanged}
    />,
    window,
    { strTitle: "" },
  );
}

function ChordsPage({
  status,
  catalog,
  learned,
  setLearned,
  reload,
}: {
  status: Status;
  catalog: OutputCatalog | undefined;
  learned: InputRef[];
  setLearned: (inputs: InputRef[]) => void;
  reload: () => Promise<unknown>;
}) {
  const profile = status.profiles.find((item) => item.id === status.activeProfileId);
  const [actionType, setActionType] = useState<Action["type"]>("key");
  const [outputCode, setOutputCode] = useState("KEY_ESC");
  const [name, setName] = useState("");
  const [axisRanges, setAxisRanges] = useState<Record<string, [number, number]>>({});
  const outputs = outputOptions(catalog, actionType);
  const customOutput = actionType === "keyCombo" || actionType === "layer";
  const chords = profile?.bindings.filter((binding) => binding.conditions.length > 1) ?? [];

  useEffect(() => {
    if (!customOutput && outputs[0] && !outputs.some((item) => item.code === outputCode)) {
      setOutputCode(outputs[0].code);
    }
  }, [customOutput, outputCode, outputs]);

  const learn = async () => {
    try {
      await startLearning();
    } catch (error) {
      notifyError(error);
    }
  };

  const submit = async () => {
    if (!profile || learned.length < 2 || !outputCode.trim()) return;
    const binding: Binding = {
      name: name.trim() || `${learned.map(friendlyInputName).join(" + ")} → ${outputCode}`,
      layer: "base",
      conditions: learned.map((input) => ({
        input,
        test: input.eventType === 3 ? "axisRange" : "pressed",
        ...(input.eventType === 3
          ? { axisRange: axisRanges[eventKey(input)] ?? [-1, 1] }
          : {}),
      })),
      action: {
        type: actionType,
        code: outputCode.trim(),
        ...(actionType === "keyCombo"
          ? { codes: outputCode.split("+").map((code) => code.trim()).filter(Boolean) }
          : {}),
      },
    };
    try {
      await saveBinding(profile.id, binding);
      setLearned([]);
      setAxisRanges({});
      setName("");
      await reload();
    } catch (error) {
      notifyError(error);
    }
  };

  if (!profile) return null;
  return (
    <Focusable className="Controller1_Content" flow-children="column">
      <PageHeader
        title="Chords"
        description="Build order-independent combinations, then assign one output to the complete chord."
        badge={<span className="Controller1_Badge"><FaLink /> {chords.length} chords</span>}
      />
      <div className="Controller1_Card Controller1_Stack">
        <div className="Controller1_CardTitle">
          <span>Chord recorder</span>
          <span className={`Controller1_Badge ${status.learning ? "Controller1_Badge--warn" : ""}`}>
            {status.learning ? "Move or press an input…" : `${learned.length} inputs`}
          </span>
        </div>
        <div className="Controller1_Chips">
          {learned.length === 0 && <span className="Controller1_Subtitle">Add at least two inputs.</span>}
          {learned.map((input) => (
            <span className="Controller1_Chip" key={eventKey(input)}>
              {input.eventType === 3 ? <FaSlidersH /> : <FaGamepad />}
              {friendlyInputName(input)}
              <span className="Controller1_Meta">{inputType(input)}</span>
            </span>
          ))}
        </div>
        {learned.filter((input) => input.eventType === 3).map((input) => {
          const key = eventKey(input);
          const range = axisRanges[key] ?? [-1, 1];
          return (
            <div className="Controller1_Card" key={`${key}:range`}>
              <div className="Controller1_CardTitle">
                <span>{friendlyInputName(input)} active zone</span>
                <span className="Controller1_Meta">{range[0].toFixed(2)}…{range[1].toFixed(2)}</span>
              </div>
              <SliderField
                label="Start"
                value={range[0]}
                min={-1}
                max={1}
                step={0.05}
                showValue
                onChange={(value) => setAxisRanges((current) => ({
                  ...current,
                  [key]: [Math.min(value, range[1]), range[1]],
                }))}
              />
              <SliderField
                label="End"
                value={range[1]}
                min={-1}
                max={1}
                step={0.05}
                showValue
                onChange={(value) => setAxisRanges((current) => ({
                  ...current,
                  [key]: [range[0], Math.max(value, range[0])],
                }))}
              />
            </div>
          );
        })}
        <div className="Controller1_Actions">
          <DialogButton
            disabled={!learned.length}
            onClick={() => {
              setLearned([]);
              setAxisRanges({});
            }}
          >
            Clear
          </DialogButton>
          <DialogButton disabled={!status.connected || status.learning} onClick={learn}>
            {learned.length ? "Add another input" : "Record first input"}
          </DialogButton>
        </div>
        <DropdownItem
          label="Output type"
          rgOptions={(Object.keys(ACTION_LABELS) as Action["type"][])
            .filter((type) => type !== "gamepadAxis" && type !== "mouseMove")
            .map((type) => ({ data: type, label: ACTION_LABELS[type] }))}
          selectedOption={actionType}
          onChange={(option) => setActionType(option.data as Action["type"])}
        />
        {customOutput ? (
          <TextField
            label={actionType === "layer" ? "Layer name" : "Keyboard shortcut"}
            value={outputCode}
            onChange={(event) => setOutputCode(event.currentTarget.value)}
          />
        ) : (
          <DropdownItem
            label="Virtual output"
            rgOptions={outputs.map((option) => ({ data: option.code, label: option.code }))}
            selectedOption={outputCode}
            onChange={(option) => setOutputCode(String(option.data))}
          />
        )}
        <TextField
          label="Chord name"
          description="Optional"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <div className="Controller1_Actions">
          <DialogButton disabled={learned.length < 2 || !outputCode.trim()} onClick={submit}>
            Save chord
          </DialogButton>
        </div>
      </div>
      <PageHeader title="Configured chords" description="All conditions must be active together." />
      <BindingList profileId={profile.id} bindings={chords} onChanged={reload} />
    </Focusable>
  );
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Decky's embedded browser exposes Clipboard API but can deny it.
    }
  }
  const field = document.createElement("textarea");
  field.value = value;
  field.style.position = "fixed";
  field.style.left = "-9999px";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.focus();
  field.select();
  field.setSelectionRange(0, field.value.length);
  try {
    if (!document.execCommand("copy")) {
      throw new Error("Clipboard copy was rejected");
    }
  } finally {
    field.remove();
  }
}

function DebugPage() {
  const [report, setReport] = useState("Loading diagnostics…");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setReport((await getDebugReport()).text);
    } catch (error) {
      setReport(`Could not load diagnostics:\n${String(error)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const copy = async () => {
    try {
      await copyText(report);
      toaster.toast({ title: "Controller1", body: "Debug report copied" });
    } catch (error) {
      notifyError(error);
    }
  };

  return (
    <Focusable className="Controller1_Content" flow-children="column">
      <PageHeader
        title="Debug"
        description="Captured physical reads, virtual writes, lifecycle, kernel identity, udev classification, and permissions."
      />
      <div className="Controller1_Actions">
        <DialogButton disabled={loading} onClick={refresh}>
          {loading ? "Refreshing…" : "Refresh"}
        </DialogButton>
        <DialogButton disabled={!report} onClick={copy}>
          Copy report
        </DialogButton>
      </div>
      <pre className="Controller1_DebugReport">{report}</pre>
    </Focusable>
  );
}

export function ControllerApp() {
  const controller = useController();
  const { status } = controller;
  if (!status) {
    return <div className="Controller1 Controller1_Content">Loading Controller1…</div>;
  }

  return (
    <div className="Controller1 Controller1_Page">
      <style>{controllerStyles}</style>
      <SidebarNavigation
        title="Controller1"
        showTitle
        pages={[
          {
            title: "Controls",
            identifier: "controls",
            icon: <FaSlidersH />,
            padding: "none",
            content: (
              <CalibrationPage
                status={status}
                catalog={controller.catalog}
                snapshot={controller.snapshot}
                setSnapshot={controller.setSnapshot}
                setStatus={controller.setStatus}
                reload={controller.reload}
              />
            ),
          },
          {
            title: "Setup",
            identifier: "setup",
            icon: <FaGamepad />,
            padding: "none",
            content: (
              <SetupPage
                status={status}
                setStatus={controller.setStatus}
                reload={controller.reload}
              />
            ),
          },
          {
            title: "Chords",
            identifier: "chords",
            icon: <FaLink />,
            padding: "none",
            content: (
              <ChordsPage
                status={status}
                catalog={controller.catalog}
                learned={controller.learned}
                setLearned={controller.setLearned}
                reload={controller.reload}
              />
            ),
          },
          {
            title: "Debug",
            identifier: "debug",
            icon: <FaBug />,
            padding: "none",
            content: <DebugPage />,
          },
        ]}
      />
    </div>
  );
}

export function QuickPanel() {
  const [status, setStatus] = useState<Status>();

  useEffect(() => {
    getStatus().then(setStatus).catch(notifyError);
    const listener = addEventListener<[Status]>("status_changed", setStatus);
    return () => removeEventListener("status_changed", listener);
  }, []);

  return (
    <div className="Controller1">
      <style>{controllerStyles}</style>
      <div className="Controller1_QAMStatus">
        <strong>{status?.outputGamepadName ?? "Controller1"}</strong>
        <div className="Controller1_Subtitle">
          {status?.connected ? "Connected and emitting" : "Not connected"}
        </div>
      </div>
      <ButtonItem
        layout="below"
        onClick={() => {
          Navigation.CloseSideMenus();
          Navigation.Navigate(CONTROLLER_ROUTE);
        }}
      >
        Open controller setup
      </ButtonItem>
    </div>
  );
}
