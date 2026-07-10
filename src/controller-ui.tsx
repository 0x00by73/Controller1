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
  FaSlidersH,
  FaTrash,
} from "react-icons/fa";
import {
  Action,
  Binding,
  Device,
  InputRef,
  InputSnapshot,
  OutputCatalog,
  OutputOption,
  Profile,
  Status,
  beginCalibration,
  createProfile,
  deleteBinding,
  finishCalibration,
  getDebugReport,
  getOutputCatalog,
  getStatus,
  refreshDevices,
  saveBinding,
  setEnabled,
  setOutputNames,
  setProfile,
  startLearning,
} from "./api";
import { controllerStyles } from "./styles";

export const CONTROLLER_ROUTE = "/controller1";

type RawInput = InputRef & { value: number };

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

const eventKey = (input: InputRef) => `${input.eventType}:${input.code}`;
const inputType = (input: InputRef) => input.eventType === 3 ? "Axis" : "Button";

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
    const rawListener = addEventListener<[RawInput]>("raw_input", (input) => {
      const key = eventKey(input);
      queueSnapshot({
        ...latestSnapshot.current,
        values: { ...latestSnapshot.current.values, [key]: input.value },
      });
    });
    const learnedListener = addEventListener<[RawInput]>("learned_input", (input) => {
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
      removeEventListener("raw_input", rawListener);
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
        <span>{axis.name}</span>
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
      <div className="Controller1_ButtonName">{button.name}</div>
      <div className="Controller1_Meta">EV_KEY · {button.code}</div>
    </Focusable>
  );
});

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
          title="Controls"
          description="Connect a physical controller to inspect and configure its controls."
        />
        <div className="Controller1_Empty">Open Setup and connect a controller.</div>
      </div>
    );
  }

  return (
    <Focusable className="Controller1_Content" flow-children="column">
      <PageHeader
        title="Controls"
        description={status.calibrating
          ? "Move every axis through its full travel and press every available button."
          : "Inspect live input or select a control to configure its mapping."}
        badge={(
          <span className={`Controller1_Badge ${status.calibrating ? "Controller1_Badge--warn" : "Controller1_Badge--good"}`}>
            {status.calibrating ? <><FaBolt /> Recording</> : <><FaCheck /> Ready</>}
          </span>
        )}
      />

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
        description="Blue means pressed now. Green outline means seen during this calibration."
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
  const [low, setLow] = useState(-1);
  const [high, setHigh] = useState(1);
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
      name: name.trim() || `${source.name} → ${outputCode}`,
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
              <p>Trigger only while the calibrated axis is inside this zone.</p>
            </div>
            <span className="Controller1_RangeValue">{low.toFixed(2)} … {high.toFixed(2)}</span>
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
              <span>{binding.conditions.map((condition) => condition.input.name).join(" + ") || binding.action.source?.name}</span>
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
            <h2>{input.name}</h2>
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
      name: name.trim() || `${learned.map((input) => input.name).join(" + ")} → ${outputCode}`,
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
              {input.name}
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
                <span>{input.name} active zone</span>
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
