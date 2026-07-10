import {
  ButtonItem,
  DialogButton,
  DropdownItem,
  Focusable,
  Navigation,
  SidebarNavigation,
  SliderField,
  TextField,
} from "@decky/ui";
import {
  addEventListener,
  removeEventListener,
  toaster,
} from "@decky/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FaBolt,
  FaCheck,
  FaGamepad,
  FaKeyboard,
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
  Status,
  beginCalibration,
  createProfile,
  deleteBinding,
  finishCalibration,
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
const inputLabel = (input: InputRef) => `${input.name} · ${inputType(input)} ${input.code}`;

function notifyError(error: unknown) {
  toaster.toast({ title: "Controller1", body: String(error), critical: true });
}

function useController() {
  const [status, setStatus] = useState<Status>();
  const [catalog, setCatalog] = useState<OutputCatalog>();
  const [snapshot, setSnapshot] = useState<InputSnapshot>(EMPTY_SNAPSHOT);
  const [learned, setLearned] = useState<InputRef[]>([]);

  const reload = useCallback(async () => {
    const next = await getStatus();
    setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    Promise.all([reload(), getOutputCatalog().then(setCatalog)]).catch(notifyError);

    const statusListener = addEventListener<[Status]>("status_changed", setStatus);
    const devicesListener = addEventListener<[Device[]]>("devices_changed", (devices) => {
      setStatus((current) => current ? { ...current, devices } : current);
    });
    const snapshotListener = addEventListener<[InputSnapshot]>("input_snapshot", setSnapshot);
    const rawListener = addEventListener<[RawInput]>("raw_input", (input) => {
      const key = eventKey(input);
      setSnapshot((current) => ({
        ...current,
        values: { ...current.values, [key]: input.value },
      }));
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
    };
  }, [reload]);

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
            {status.enabled ? status.outputGamepadName : "Connect a controller"}
          </h1>
          <div className="Controller1_Subtitle">
            {status.enabled && selected
              ? `${selected.name} is captured and emitting virtual devices.`
              : "Choose the physical input and virtual device identity."}
          </div>
        </div>
        <span className={`Controller1_Badge ${status.enabled ? "Controller1_Badge--good" : ""}`}>
          {status.enabled ? <><FaCheck /> Connected</> : "Disconnected"}
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
        description="Calibration and mappings are isolated per profile."
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

function AxisCard({
  axis,
  snapshot,
  stored,
}: {
  axis: Device["axes"][number];
  snapshot: InputSnapshot;
  stored?: { min: number; center: number; max: number };
}) {
  const key = `3:${axis.code}`;
  const observed = snapshot.axisRanges[key];
  const minimum = axis.min ?? stored?.min ?? observed?.min ?? -32768;
  const maximum = axis.max ?? stored?.max ?? observed?.max ?? 32767;
  const current = snapshot.values[key] ?? axis.value ?? stored?.center ?? 0;
  const span = Math.max(1, maximum - minimum);
  const position = Math.max(0, Math.min(100, ((current - minimum) / span) * 100));
  const observedStart = observed
    ? Math.max(0, Math.min(100, ((observed.min - minimum) / span) * 100))
    : position;
  const observedEnd = observed
    ? Math.max(0, Math.min(100, ((observed.max - minimum) / span) * 100))
    : position;
  const coverage = observed
    ? Math.max(0, Math.min(1, (observed.max - observed.min) / span))
    : 0;

  return (
    <div className={`Controller1_Card ${coverage >= 0.8 ? "Controller1_Card--active" : ""}`}>
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
        <span>{observed?.min ?? "—"} / {minimum}</span>
        <span>{stored ? `center ${stored.center}` : "center"}</span>
        <span>{observed?.max ?? "—"} / {maximum}</span>
      </div>
    </div>
  );
}

function CalibrationPage({
  status,
  snapshot,
  setSnapshot,
  setStatus,
  reload,
}: {
  status: Status;
  snapshot: InputSnapshot;
  setSnapshot: (snapshot: InputSnapshot) => void;
  setStatus: (status: Status) => void;
  reload: () => Promise<Status>;
}) {
  const profile = status.profiles.find((item) => item.id === status.activeProfileId);
  const device = status.devices.find((item) => item.id === profile?.deviceId && item.active)
    ?? status.devices.find((item) => item.active);
  const seenButtons = new Set(snapshot.pressedButtons);
  const axisComplete = device?.axes.filter((axis) => {
    const observed = snapshot.axisRanges[`3:${axis.code}`];
    const span = (axis.max ?? 0) - (axis.min ?? 0);
    return observed && (span > 0
      ? (observed.max - observed.min) / span >= 0.8
      : observed.max > observed.min);
  }).length ?? 0;
  const total = (device?.axes.length ?? 0) + (device?.buttons.length ?? 0);
  const complete = axisComplete + seenButtons.size;
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

  if (!status.enabled || !device || !profile) {
    return (
      <div className="Controller1_Content">
        <PageHeader
          title="Calibration"
          description="Connect a physical controller before calibrating it."
        />
        <div className="Controller1_Empty">Open Setup and connect a controller.</div>
      </div>
    );
  }

  return (
    <Focusable className="Controller1_Content" flow-children="column">
      <PageHeader
        title="Calibration"
        description={status.calibrating
          ? "Move every axis through its full travel and press every available button."
          : "Inspect every input, then capture ranges and centers for this profile."}
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
            snapshot={snapshot}
            stored={profile.calibrations[`3:${axis.code}`]}
          />
        ))}
      </div>

      <PageHeader
        title={`Buttons · ${device.buttons.length}`}
        description="Blue means pressed now. Green outline means seen during this calibration."
      />
      <div className="Controller1_ButtonGrid">
        {device.buttons.map((button) => {
          const key = `1:${button.code}`;
          const pressed = Boolean(snapshot.values[key]);
          const seen = seenButtons.has(key);
          return (
            <div
              key={button.code}
              className={[
                "Controller1_ButtonChip",
                pressed ? "Controller1_ButtonChip--pressed" : "",
                seen ? "Controller1_ButtonChip--seen" : "",
              ].join(" ")}
            >
              <div className="Controller1_ButtonName">{button.name}</div>
              <div className="Controller1_Meta">EV_KEY · {button.code}</div>
            </div>
          );
        })}
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
  status,
  catalog,
  onSaved,
}: {
  status: Status;
  catalog: OutputCatalog | undefined;
  onSaved: () => Promise<unknown>;
}) {
  const profile = status.profiles.find((item) => item.id === status.activeProfileId);
  const device = status.devices.find((item) => item.id === profile?.deviceId)
    ?? status.devices.find((item) => item.active);
  const inputs = useMemo(() => [
    ...(device?.axes.map((axis) => ({ eventType: 3, code: axis.code, name: axis.name })) ?? []),
    ...(device?.buttons.map((button) => ({ eventType: 1, code: button.code, name: button.name })) ?? []),
  ], [device]);
  const [sourceKey, setSourceKey] = useState("");
  const [actionType, setActionType] = useState<Action["type"]>("gamepadButton");
  const [outputCode, setOutputCode] = useState("BTN_SOUTH");
  const [name, setName] = useState("");
  const [low, setLow] = useState(-1);
  const [high, setHigh] = useState(1);
  const source = inputs.find((input) => eventKey(input) === sourceKey);
  const outputs = outputOptions(catalog, actionType);
  const customOutput = actionType === "keyCombo" || actionType === "layer";

  useEffect(() => {
    if (!sourceKey && inputs[0]) setSourceKey(eventKey(inputs[0]));
  }, [inputs, sourceKey]);

  useEffect(() => {
    if (!customOutput && outputs[0] && !outputs.some((item) => item.code === outputCode)) {
      setOutputCode(outputs[0].code);
    }
  }, [customOutput, outputCode, outputs]);

  const submit = async () => {
    if (!profile || !source || !outputCode.trim()) return;
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
      await saveBinding(profile.id, binding);
      setName("");
      await onSaved();
    } catch (error) {
      notifyError(error);
    }
  };

  return (
    <div className="Controller1_Card Controller1_Stack">
      <DropdownItem
        label="Physical input"
        rgOptions={inputs.map((input) => ({ data: eventKey(input), label: inputLabel(input) }))}
        selectedOption={sourceKey}
        onChange={(option) => setSourceKey(String(option.data))}
      />
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
            label: option.name ? `${option.name} · ${option.code}` : option.code,
          }))}
          selectedOption={outputCode}
          onChange={(option) => setOutputCode(String(option.data))}
        />
      )}
      {source?.eventType === 3 && actionType !== "gamepadAxis" && actionType !== "mouseMove" && (
        <>
          <SliderField label="Range start" value={low} min={-1} max={1} step={0.05} showValue onChange={setLow} />
          <SliderField label="Range end" value={high} min={-1} max={1} step={0.05} showValue onChange={setHigh} />
        </>
      )}
      <TextField
        label="Mapping name"
        description="Optional"
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
      />
      <div className="Controller1_Actions">
        <DialogButton disabled={!source || !outputCode.trim()} onClick={submit}>
          Save mapping
        </DialogButton>
      </div>
    </div>
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

function MappingsPage({
  status,
  catalog,
  reload,
}: {
  status: Status;
  catalog: OutputCatalog | undefined;
  reload: () => Promise<unknown>;
}) {
  const profile = status.profiles.find((item) => item.id === status.activeProfileId);
  if (!profile) return null;
  const mappings = profile.bindings.filter((binding) => binding.conditions.length <= 1);
  return (
    <Focusable className="Controller1_Content" flow-children="column">
      <PageHeader
        title="Mappings"
        description="Route one physical control to a typed virtual output. No Linux code memorization required."
        badge={<span className="Controller1_Badge">{mappings.length} mappings</span>}
      />
      <MappingBuilder status={status} catalog={catalog} onSaved={reload} />
      <PageHeader title="Assigned outputs" description="Mappings in the active profile." />
      <BindingList profileId={profile.id} bindings={mappings} onChanged={reload} />
    </Focusable>
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
          <DialogButton disabled={!status.enabled || status.learning} onClick={learn}>
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
            title: "Calibration",
            identifier: "calibration",
            icon: <FaSlidersH />,
            padding: "none",
            content: (
              <CalibrationPage
                status={status}
                snapshot={controller.snapshot}
                setSnapshot={controller.setSnapshot}
                setStatus={controller.setStatus}
                reload={controller.reload}
              />
            ),
          },
          {
            title: "Mappings",
            identifier: "mappings",
            icon: <FaKeyboard />,
            padding: "none",
            content: (
              <MappingsPage
                status={status}
                catalog={controller.catalog}
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
          {status?.enabled ? "Connected and emitting" : "Not connected"}
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
