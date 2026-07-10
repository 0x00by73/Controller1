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
  FaLink,
  FaPlay,
  FaSearch,
  FaSlidersH,
  FaStop,
  FaTrash,
} from "react-icons/fa";
import {
  Action,
  Binding,
  DiscoveryStatus,
  Device,
  InputRef,
  InputSnapshot,
  LogicalControl,
  OutputCatalog,
  OutputOption,
  PipelineEntry,
  Profile,
  Status,
  beginCalibration,
  beginDiscoveryObservation,
  createProfile,
  deleteBinding,
  deleteLogicalControl,
  finishCalibration,
  finishDiscoveryObservation,
  getDebugReport,
  getDiscoveryStatus,
  getOutputCatalog,
  getPipelineSnapshot,
  getStatus,
  refreshDevices,
  saveBinding,
  saveLogicalControl,
  setEnabled,
  setOutputNames,
  setProfile,
  startBindAssist,
  startDiscovery,
  startLearning,
  stopBindAssist,
  stopDiscovery,
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

function modeNote(mode: Profile["outputMode"]): string {
  if (mode === "extended") {
    return "Extended exposes more virtual controls; games with strict standard-pad support may ignore extras.";
  }
  if (mode === "hybrid") {
    return "Hybrid preserves standard controls and falls back to extended outputs when capacity is reached.";
  }
  return "Maximum compatibility. Extra controls fall back to available standard outputs.";
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
}: {
  axis: Device["axes"][number];
  current: number;
  observedMin?: number;
  observedMax?: number;
  stored?: { min: number; center: number; max: number };
  onSelect: (input: InputRef) => void;
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
      className={`Controller1_Card Controller1_Control ${coverage >= 0.8 ? "Controller1_Card--active" : ""}`}
      focusClassName="Controller1_Control--focused"
      onActivate={() => onSelect(input)}
      onClick={() => onSelect(input)}
      onOKActionDescription="Configure mapping"
    >
      <div className="Controller1_CardTitle">
        <span>{friendlyInputName(input)}</span>
        <span className={`Controller1_Badge ${coverage >= 0.8 ? "Controller1_Badge--good" : ""}`}>
          {Math.round(coverage * 100)}%
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
}: {
  button: Device["buttons"][number];
  pressed: boolean;
  seen: boolean;
  onSelect: (input: InputRef) => void;
}) {
  const input = { eventType: 1, code: button.code, name: button.name };
  return (
    <Focusable
      className={[
        "Controller1_ButtonChip",
        "Controller1_Control",
        pressed ? "Controller1_ButtonChip--pressed" : "",
        seen ? "Controller1_ButtonChip--seen" : "",
      ].join(" ")}
      focusClassName="Controller1_Control--focused"
      onActivate={() => onSelect(input)}
      onClick={() => onSelect(input)}
      onOKActionDescription="Configure mapping"
    >
      <div className="Controller1_ButtonName">{friendlyInputName(input)}</div>
      <div className="Controller1_Meta">EV_KEY · {button.code}</div>
    </Focusable>
  );
});

function LogicalControlCard({
  profileId,
  control,
  bindActive,
  review = false,
  onSaved,
  onRefresh,
  onDeleted,
}: {
  profileId: string;
  control: LogicalControl;
  bindActive: boolean;
  review?: boolean;
  onSaved: (control: LogicalControl) => Promise<void>;
  onRefresh: () => Promise<unknown>;
  onDeleted?: () => Promise<void>;
}) {
  const defaultName = /^\s*[\[(].*,.*[\])]\s*$/.test(control.name)
    ? friendlyInputName(control.sources[0] ?? { eventType: 1, code: 0, name: "" })
    : control.name;
  const [draft, setDraft] = useState<LogicalControl>({
    ...control,
    name: defaultName,
    positions: control.positions.map((position, index) => ({
      ...position,
      label: position.label || `Position ${index + 1}`,
    })),
  });
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    setDraft({
      ...control,
      name: /^\s*[\[(].*,.*[\])]\s*$/.test(control.name) ? defaultName : control.name,
      positions: control.positions.map((position, index) => ({
        ...position,
        label: position.label || `Position ${index + 1}`,
      })),
    });
  }, [control, defaultName]);

  const save = async () => {
    setSaving(true);
    try {
      await onSaved({
        ...draft,
        name: draft.name.trim() || defaultName || "Control",
        confirmed: true,
        positions: draft.positions.map((position, index) => ({
          ...position,
          label: position.label.trim() || `Position ${index + 1}`,
        })),
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleBind = async () => {
    try {
      if (bindActive) await stopBindAssist();
      else await startBindAssist(profileId, control.id);
      await onRefresh();
    } catch (error) {
      notifyError(error);
    }
  };

  return (
    <Focusable
      className={`Controller1_Card Controller1_LogicalCard ${bindActive ? "Controller1_LogicalCard--binding" : ""}`}
      flow-children="column"
    >
      <div className="Controller1_CardTitle">
        <span>{review ? "Review discovered control" : draft.name}</span>
        <span className={`Controller1_Badge ${bindActive ? "Controller1_Badge--warn" : "Controller1_Badge--good"}`}>
          {bindActive ? <><FaBolt /> Bind assist active</> : draft.kind}
        </span>
      </div>
      {review && !control.confirmed && (
        <div className="Controller1_ReviewNotice">
          Check the positions below, then confirm this control.
        </div>
      )}
      <TextField
        label="Control name"
        value={draft.name}
        onChange={(event) => setDraft((current) => ({ ...current, name: event.currentTarget.value }))}
      />
      <div className="Controller1_Positions">
        {draft.positions.map((position, index) => (
          <div className="Controller1_PositionRow" key={position.id}>
            <TextField
              label={`Position ${index + 1}`}
              value={position.label}
              onChange={(event) => {
                const label = event.currentTarget.value;
                setDraft((current) => ({
                  ...current,
                  positions: current.positions.map((item, itemIndex) => itemIndex === index
                    ? { ...item, label }
                    : item),
                }));
              }}
            />
            <div className="Controller1_PositionOutput">{actionLabel(position.action ?? draft.action)}</div>
          </div>
        ))}
      </div>
      {!draft.action && draft.positions.every((position) => !position.action) && (
        <div className="Controller1_Subtitle">Outputs are assigned automatically when this control is saved.</div>
      )}
      <DialogButton onClick={() => setShowAdvanced((shown) => !shown)}>
        {showAdvanced ? "Hide details" : "Advanced details"}
      </DialogButton>
      {showAdvanced && (
        <div className="Controller1_AdvancedDetails">
          {draft.sources.map((source) => (
            <div key={eventKey(source)}>
              <strong>{friendlyInputName(source)}</strong>
              <span> {source.eventType === 3 ? "EV_ABS" : "EV_KEY"} · code {source.code}</span>
            </div>
          ))}
        </div>
      )}
      <div className="Controller1_Actions">
        {!review && onDeleted && (
          <DialogButton onClick={onDeleted}><FaTrash /> Delete</DialogButton>
        )}
        {!review && (
          <DialogButton onClick={toggleBind}>
            {bindActive ? <><FaStop /> Stop bind assist</> : <><FaPlay /> Bind in game</>}
          </DialogButton>
        )}
        <DialogButton disabled={saving} onClick={save}>
          {saving
            ? "Saving…"
            : review && !control.confirmed
              ? "Confirm, save, and continue"
              : review
                ? "Save and continue"
                : "Save control"}
        </DialogButton>
      </div>
      {bindActive && (
        <div className="Controller1_BindBanner">
          Move a position now. Only that newly moved position is temporarily emitted.
        </div>
      )}
    </Focusable>
  );
}

function DiscoverPage({
  status,
  reload,
}: {
  status: Status;
  reload: () => Promise<Status>;
}) {
  const profile = status.profiles.find((item) => item.id === status.activeProfileId);
  const [discovery, setDiscovery] = useState<DiscoveryStatus>({
    active: false,
    state: "idle",
    prompt: "",
    changedInputs: [],
  });
  const [busy, setBusy] = useState(false);

  const refreshDiscovery = useCallback(async () => {
    try {
      setDiscovery(await getDiscoveryStatus());
    } catch (error) {
      notifyError(error);
    }
  }, []);

  useEffect(() => {
    void refreshDiscovery();
  }, [refreshDiscovery]);

  useEffect(() => {
    if (!discovery.active && !status.discovering) return;
    const timer = window.setInterval(() => void refreshDiscovery(), 500);
    return () => window.clearInterval(timer);
  }, [discovery.active, refreshDiscovery, status.discovering]);

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await operation();
      await refreshDiscovery();
      await reload();
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  };

  const begin = () => profile && run(() => startDiscovery(profile.id));
  const observe = () => run(beginDiscoveryObservation);
  const finish = () => run(finishDiscoveryObservation);
  const cancel = () => run(stopDiscovery);

  const saveCandidate = async (candidate: LogicalControl) => {
    if (!profile) return;
    await saveLogicalControl(profile.id, candidate);
    await stopDiscovery();
    await reload();
    await startDiscovery(profile.id);
    await refreshDiscovery();
  };

  const removeControl = async (controlId: string) => {
    if (!profile) return;
    try {
      await deleteLogicalControl(profile.id, controlId);
      await reload();
    } catch (error) {
      notifyError(error);
    }
  };

  if (!profile) return null;
  const observing = discovery.state === "observing" || discovery.state === "observation";
  const awaitingMove = discovery.active && !observing && !discovery.candidate;

  return (
    <Focusable className="Controller1_Content" flow-children="column">
      <PageHeader
        title="Discover controls"
        description="Add one physical control at a time. Controller1 groups every position into one semantic control."
        badge={<span className="Controller1_Badge"><FaSearch /> {profile.logicalControls.length} controls</span>}
      />

      {!status.connected ? (
        <div className="Controller1_Empty">Open Setup and connect a controller before discovery.</div>
      ) : discovery.candidate ? (
        <LogicalControlCard
          profileId={profile.id}
          control={discovery.candidate}
          bindActive={false}
          review
          onSaved={saveCandidate}
          onRefresh={reload}
        />
      ) : (
        <div className="Controller1_Card Controller1_Discovery">
          <div className="Controller1_DiscoveryStep">
            <span className="Controller1_StepNumber">{discovery.active ? (observing ? "2" : "1") : "1"}</span>
            <div>
              <div className="Controller1_CardTitle">
                {observing ? "Move one control through every position" : "Ready to discover a control"}
              </div>
              <div className="Controller1_Subtitle">
                {discovery.prompt || (observing
                  ? "Move only the control you are adding, pausing briefly at each position."
                  : "Start discovery, then move one button, axis, or switch.")}
              </div>
            </div>
          </div>
          {discovery.changedInputs.length > 0 && (
            <div className="Controller1_Chips">
              {discovery.changedInputs.map((input) => (
                <span className="Controller1_Chip" key={eventKey(input)}>{friendlyInputName(input)}</span>
              ))}
            </div>
          )}
          <div className="Controller1_Actions">
            {discovery.active && <DialogButton disabled={busy} onClick={cancel}>Cancel</DialogButton>}
            {!discovery.active && (
              <DialogButton disabled={busy || !status.connected} onClick={begin}>Start discovery</DialogButton>
            )}
            {awaitingMove && (
              <DialogButton disabled={busy} onClick={observe}>Begin observation</DialogButton>
            )}
            {observing && (
              <DialogButton disabled={busy || discovery.changedInputs.length === 0} onClick={finish}>
                Finish and classify
              </DialogButton>
            )}
          </div>
        </div>
      )}

      <PageHeader
        title="Configured controls"
        description="Each card is saved atomically with all of its semantic positions."
      />
      {profile.logicalControls.length === 0 ? (
        <div className="Controller1_Empty">No semantic controls yet. Start discovery above.</div>
      ) : (
        <div className="Controller1_Stack">
          {profile.logicalControls.map((control) => (
            <LogicalControlCard
              key={control.id}
              profileId={profile.id}
              control={control}
              bindActive={status.bindAssisting && status.bindAssistControlId === control.id}
              onSaved={async (updated) => {
                await saveLogicalControl(profile.id, updated);
                await reload();
              }}
              onRefresh={reload}
              onDeleted={() => removeControl(control.id)}
            />
          ))}
        </div>
      )}
    </Focusable>
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

  const selectControl = useCallback((input: InputRef) => {
    if (!profile) return;
    showControlMappingModal(input, profile, catalog, reload);
  }, [catalog, profile, reload]);

  if (!status.connected || !device || !profile) {
    return (
      <div className="Controller1_Content">
        <PageHeader
          title="Advanced controls"
          description="Raw calibration and input diagnostics for troubleshooting."
        />
        <div className="Controller1_Empty">Open Setup and connect a controller.</div>
      </div>
    );
  }

  return (
    <Focusable className="Controller1_Content" flow-children="column">
      <PageHeader
        title="Advanced controls"
        description={status.calibrating
          ? "Move every axis through its full travel and press every available button."
          : "Raw calibration and per-event diagnostics. Use Discover for normal setup."}
        badge={(
          <span className={`Controller1_Badge ${status.calibrating ? "Controller1_Badge--warn" : "Controller1_Badge--good"}`}>
            {status.calibrating ? <><FaBolt /> Recording</> : <><FaCheck /> Ready</>}
          </span>
        )}
      />

      <div className="Controller1_Card">
        <div className="Controller1_CardTitle">
          <span>Output strategy</span>
          <span className="Controller1_Badge">{profile.outputMode}</span>
        </div>
        <div className="Controller1_Subtitle">{modeNote(profile.outputMode)}</div>
      </div>

      <div className="Controller1_Card">
        <div className="Controller1_CardTitle">
          <span>{complete} of {total} controls exercised</span>
          <span>{progress}%</span>
        </div>
        <div className="Controller1_Progress">
          <div className="Controller1_ProgressFill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <PageHeader
        title={`Axes · ${device.axes.length}`}
        description="White marker is live input; blue is the observed range; endpoints are hardware limits."
      />
      <div className="Controller1_Grid Controller1_Grid--three">
        {device.axes.map((axis) => (
          <AxisCard
            key={axis.code}
            axis={axis}
            current={snapshot.values[`3:${axis.code}`] ?? axis.value ?? profile.calibrations[`3:${axis.code}`]?.center ?? 0}
            observedMin={axisRanges[`3:${axis.code}`]?.min}
            observedMax={axisRanges[`3:${axis.code}`]?.max}
            stored={profile.calibrations[`3:${axis.code}`]}
            onSelect={selectControl}
          />
        ))}
      </div>

      <PageHeader
        title={`Buttons · ${device.buttons.length}`}
        description="These are hardware-advertised buttons. Blue means pressed now; green means an event was observed."
      />
      <div className="Controller1_ButtonGrid">
        {device.buttons.map((button) => (
          <ButtonControl
            key={button.code}
            button={button}
            pressed={Boolean(snapshot.values[`1:${button.code}`])}
            seen={seenButtons.has(`1:${button.code}`)}
            onSelect={selectControl}
          />
        ))}
      </div>

      <div className="Controller1_Actions">
        <DialogButton onClick={status.calibrating ? finish : start}>
          {status.calibrating ? "Finish and save" : "Start calibration"}
        </DialogButton>
      </div>
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

function TestPage({ status }: { status: Status }) {
  const [entries, setEntries] = useState<PipelineEntry[]>([]);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setEntries(await getPipelineSnapshot());
      setError("");
    } catch (reason) {
      setError(String(reason));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <Focusable className="Controller1_Content" flow-children="column">
      <PageHeader
        title="Test pipeline"
        description="Live physical input → semantic position → virtual output."
        badge={(
          <span className={`Controller1_Badge ${status.connected ? "Controller1_Badge--good" : ""}`}>
            {status.connected ? "Live" : "Disconnected"}
          </span>
        )}
      />
      {error && <div className="Controller1_Error">Could not read pipeline: {error}</div>}
      {!error && entries.length === 0 ? (
        <div className="Controller1_Empty">
          Move a configured control to see it travel through the pipeline.
        </div>
      ) : (
        <div className="Controller1_Stack" aria-live="polite">
          {entries.map((entry, index) => {
            const physical = entry.physical
              ? friendlyInputName(entry.physical)
              : "No physical event";
            const output = entry.virtual
              ? `${entry.virtual.kind} · ${STANDARD_INPUT_NAMES[entry.virtual.code] ?? entry.virtual.code} · ${entry.virtual.value}`
              : "No output";
            return (
              <div
                className={`Controller1_PipelineRow ${entry.virtual?.emitted ? "Controller1_PipelineRow--emitted" : ""}`}
                key={`${entry.logicalControlId}:${entry.position ?? ""}:${index}`}
              >
                <div className="Controller1_PipelineStage">
                  <span>Physical</span>
                  <strong>{physical}</strong>
                  {entry.physical && (
                    <small>value {entry.physical.value ?? "—"}</small>
                  )}
                </div>
                <span className="Controller1_PipelineArrow">→</span>
                <div className="Controller1_PipelineStage">
                  <span>Logical</span>
                  <strong>{entry.name}</strong>
                  <small>{entry.position || "Between positions"}</small>
                </div>
                <span className="Controller1_PipelineArrow">→</span>
                <div className="Controller1_PipelineStage">
                  <span>Virtual</span>
                  <strong>{output}</strong>
                  <small>{entry.virtual?.emitted ? "Emitted" : "Not emitted"}</small>
                </div>
              </div>
            );
          })}
        </div>
      )}
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
            title: "Discover",
            identifier: "discover",
            icon: <FaSearch />,
            padding: "none",
            content: <DiscoverPage status={status} reload={controller.reload} />,
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
            title: "Test",
            identifier: "test",
            icon: <FaBolt />,
            padding: "none",
            content: <TestPage status={status} />,
          },
          {
            title: "Advanced Controls",
            identifier: "advanced-controls",
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
