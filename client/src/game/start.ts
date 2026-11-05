import { PerspectiveCamera, Scene, type Object3D, type WebGLRenderer } from "three";
import {
  CAMERA,
  CUSHION_TOP,
  RESIDENTS,
  ROOM_CAPACITY,
  VISITOR_COLORS,
  makeName,
  pickSpawn,
  roomId,
  roomNameOf,
  roomAllowsChat,
  roomNumber,
  spaceOf,
  vnMidnight,
  type AccountView,
  type ConnectionStatus,
} from "@santinh/shared";
import { Avatar } from "../avatar/avatar.ts";
import { ContactShadows } from "../avatar/contact-shadow.ts";
import { MonkFactory } from "../avatar/monk-model.ts";
import { CameraRig, cameraWorldOf, pickFloor } from "../controls/camera-rig.ts";
import { Input, type MoveAxes } from "../controls/input.ts";
import { Movement } from "../controls/movement.ts";
import { vi } from "../i18n/vi.ts";
import { createWalkChip } from "../ui/walk-chip.ts";
import { Hud } from "../ui/hud.ts";
import { RoomsDialog, emptiestRoom, roomFromSearch, writeRoomToUrl } from "../ui/rooms-dialog.ts";
import { Toasts } from "../ui/toasts.ts";
import { PeopleDialog } from "../ui/people-dialog.ts";
import { InviteAction } from "../ui/invite-action.ts";
import { InviteDialog } from "../ui/invite-dialog.ts";
import { ExitScreen } from "../ui/exit-screen.ts";
import { RestScreen } from "../ui/rest-screen.ts";
import { CeremonyBanner } from "../ui/ceremony-banner.ts";
import { SettingsDialog } from "../ui/settings-dialog.ts";
import { OfferingDialog } from "../ui/offering-dialog.ts";
import { AudioEngine } from "../audio/engine.ts";
import { Chant } from "../audio/chant.ts";
import { BeadsScene } from "../beads/beads-scene.ts";
import { BeadsScreen } from "../beads/beads-screen.ts";
import { centreSlot, safeLocalStorage } from "../beads/counter.ts";
import { NameLabels } from "../ui/labels.ts";
import { createAccountApi, createDriver } from "../net/create-driver.ts";
import { clearSession, loadSession, saveSession } from "../net/session-store.ts";
import { AccountDialog, type AccountMode } from "../ui/account-dialog.ts";
import { ChatPanel } from "../ui/chat-panel.ts";
import { readNear, stripNearFromUrl } from "../net/invite.ts";
import { loadName, saveName } from "../net/name-store.ts";
import { NameDialog } from "../ui/name-dialog.ts";
import type { NetDriver } from "../net/net-driver.ts";
import { EventFilter, RemoteAvatars, labelHeight } from "../net/remote-avatars.ts";
import { FrameStats } from "../engine/frame-stats.ts";
import { Loop } from "../engine/loop.ts";
import { Quality } from "../engine/quality.ts";
import { createRenderer, isWebGLAvailable } from "../engine/renderer.ts";
import { createDebugOverlay } from "../debug/overlay.ts";
import { e2eState, installE2EHooks, type E2EState, type PerfInfo } from "../debug/e2e-hooks.ts";
import { Actions, installActionKeys } from "./actions.ts";
import { applyCameraPreset, params, registerCameraPreset } from "../debug/params.ts";
import { hideBoot, showBootError } from "../ui/boot.ts";
import { Assets } from "../world/assets.ts";
import { createEnvironment } from "../world/environment.ts";
import { buildSpace } from "../world/spaces.ts";

const FOV = 55;
const NEAR = 0.1;
const FAR = 600;

/** Builds the engine and world. Rejects (→ boot load error) if any core asset fails. */
export async function start(): Promise<void> {
  if (!isWebGLAvailable()) {
    showBootError("webgl");
    return;
  }

  const p = params();
  const shadows = p.shadows || !p.e2e;
  const now = (): number => (p.timeOfDayMs === null ? Date.now() : vnMidnight(Date.now()) + p.timeOfDayMs);

  let loop: Loop | null = null;
  let net: NetDriver | null = null;
  let renderer: WebGLRenderer;
  try {
    renderer = createRenderer({
      shadows,
      onContextLost: () => {
        loop?.dispose();
        net?.disconnect();
        showBootError("load");
      },
    });
  } catch (err) {
    console.error(err);
    showBootError("webgl");
    return;
  }

  if (p.avatar) {
    const { startAvatarPreview } = await import("../avatar/preview.ts");
    startAvatarPreview(renderer, { debug: p.debug });
    return;
  }

  // The room decides the space (map, scenery); a room in another space means a page reload (P-D14).
  let room = roomFromSearch(location.search) ?? roomId(1);
  const space = spaceOf(room);
  document.body.dataset.space = space.theme;
  const cameraWorld = cameraWorldOf(space);
  /** True (and the page is reloading) when `id` lives in another space than the one built here. */
  const reloadIfOtherSpace = (id: string): boolean => {
    // Unknown ids (bad list from a server) stay in place; connect/switch rejects them.
    if (roomNumber(id) === null || spaceOf(id).id === space.id) return false;
    const url = new URL(location.href);
    url.searchParams.set("room", id);
    location.assign(url);
    return true;
  };

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, NEAR, FAR);
  const assets = new Assets();

  try {
    const env = await createEnvironment(scene, assets, { shadows, now });
    const scenery = await buildSpace(space.id, { scene, assets });

    registerCameraPreset("spawn", {
      position: [space.spawn.x, space.groundY(space.spawn.x, space.spawn.z) + CAMERA.height, space.spawn.z + CAMERA.distance],
      target: [space.spawn.x, 1.4, space.spawn.z - 8],
    });

    // The player: own novice, real shadow; contact-shadow slot 0 is ours, the rest are for others (T9).
    const factory = new MonkFactory();
    const self = new Avatar(factory.create(VISITOR_COLORS[0] ?? "#b9c3c7", "full"));
    scene.add(self.object);
    const contacts = new ContactShadows(scene, ROOM_CAPACITY + RESIDENTS.length);
    contacts.setCount(1);

    const spawn = pickSpawn(space);
    const movement = new Movement(space, spawn);
    const rig = new CameraRig(camera, spawn, cameraWorld);
    // `?cam=` screenshots keep their fixed view; the player still walks.
    const fixedCamera = applyCameraPreset(camera);
    const toasts = new Toasts();
    movement.on("invalid-floor", () => toasts.show(vi.toast.invalidFloor, "warn"));

    // Everyone else comes through the NetDriver (mock in phase 01).
    const driver = createDriver();
    net = driver;
    const savedName = loadName();
    if (savedName !== null) driver.setName(savedName);
    let status: ConnectionStatus = "connecting";
    const serverNow = (): number => Date.now() + driver.clockOffset;
    const remotes = new RemoteAvatars(scene, factory, contacts, space);

    const actions = new Actions({
      space,
      net: driver,
      mover: movement,
      avatar: self,
      connected: () => status === "connected",
      serverNow,
      obstacles: () => remotes.obstacles,
    });
    actions.on("toast", (t) => toasts.show(t.text, t.kind));
    const audio = new AudioEngine();
    const chant = new Chant(audio, now);
    actions.on("bell", () => audio.bell());
    actions.on("hello", () => audio.hello());
    actions.on("teleport", (at) => {
      if (!fixedCamera) rig.snap(at.x, CUSHION_TOP, at.z);
    });
    installActionKeys(actions);

    const rooms = new RoomsDialog({
      net: driver,
      currentRoom: () => room,
      inRoom: () => status === "connected",
      reloadIfOtherSpace,
      onSwitched: (id) => {
        room = id;
        hud.setRoom(roomNumber(id) ?? 1, rooms.nameOf(id));
      },
    });
    const nameDialog = new NameDialog();
    // What the visitor picked; the room may show it as "An 2" (P3-D3).
    let myName = savedName;
    const useName = (name: string): void => {
      myName = name;
      saveName(name);
      driver.setName(name);
      settings.setName(name);
    };
    const renameSelf = (): void => {
      if (myName !== null) nameDialog.open("rename", myName, useName);
    };

    // P4-D2 / D4: the session token lives in `santinh.session`; the driver re-sends it on every socket.
    const accountApi = createAccountApi();
    const accountDialog = new AccountDialog(accountApi);
    let session = loadSession();
    /** Username on show in settings; set from the HTTP answer (register / login / me). */
    let username: string | null = null;
    const showAccount = (name: string | null): void => {
      username = name;
      settings.setAccount(name);
      chat.refresh();
    };
    /** False while the saved session is being checked: a first visit waits for it before asking a name. */
    let accountChecked = session === null;
    let firstFrameShown = false;
    const forgetSession = (): void => {
      session = null;
      clearSession();
      showAccount(null);
    };
    const applyAccount = (token: string, account: AccountView): void => {
      session = token;
      // Session first: the rename that `useName` may send then counts as the account's.
      driver.setSession(token);
      showAccount(account.username);
      useName(account.displayName);
      if (!entered) {
        entered = true;
        nameDialog.dismiss();
        if (!suspended) join();
      }
    };
    const openAccount = (mode: AccountMode): void => {
      accountDialog.open(mode, {
        suggestedName: myName ?? suggestion,
        onDone: ({ token, account }) => {
          saveSession(token);
          applyAccount(token, account);
          toasts.show(vi.account.signedIn);
        },
      });
    };
    const signOut = (): void => {
      const token = session;
      if (token === null) return;
      forgetSession();
      driver.setSession(null);
      // Best effort: the token is already gone here; a failed call only leaves an orphan row that expires.
      void accountApi.logout(token);
      toasts.show(vi.account.signedOut);
    };
    const invite = new InviteDialog(new InviteAction({ net: driver, currentRoom: () => room }));
    const inviteFriend = (): void => {
      people.close();
      invite.open();
    };
    const people = new PeopleDialog(driver, () => room, document.body, {
      invite: inviteFriend,
      rename: renameSelf,
    });
    const settings = new SettingsDialog(audio, chant, now, renameSelf, {
      // One dialog at a time: both are see-through, stacked they read as one mess.
      signIn: () => {
        settings.close();
        openAccount("register");
      },
      signOut,
    });
    if (myName !== null) settings.setName(myName);

    const sendWishIfAllowed = (wish: string): void => {
      if (!wish || status !== "connected" || session === null) return;
      const n = roomNumber(room);
      if (n === null || !roomAllowsChat(n)) return;
      driver.sendChat(wish);
    };
    const offering = new OfferingDialog({
      onIncense: (wish) => {
        scenery.lightIncense();
        audio.bell();
        actions.hello();
        toasts.show(vi.toast.incenseOffered);
        sendWishIfAllowed(wish);
      },
      onLantern: (wish) => {
        scenery.releaseLantern();
        audio.bell();
        actions.hello();
        toasts.show(vi.toast.lanternOffered);
        sendWishIfAllowed(wish);
      },
    });

    const hud = new Hud({
      rooms: () => rooms.open(),
      hello: () => actions.hello(),
      bow: () => actions.bow(),
      beads: () => actions.toggleBeads(),
      offering: () => offering.open(),
      people: () => people.open(),
      invite: inviteFriend,
      exit: () => suspend("exit"),
      sound: () => audio.toggleMuted(),
      settings: () => settings.open(),
      chant: () => chant.toggle(),
    });
    // L5: own scene on the same renderer, built on first open; the world stops updating while it shows.
    let beadsScene: BeadsScene | null = null;
    const beadsScreen = new BeadsScreen({
      storage: safeLocalStorage(),
      onClose: () => actions.closeBeads(),
      onBead: () => {
        audio.bead();
        actions.bead();
      },
      onCount: (c, animate) => {
        e2eState.beads = c;
        beadsScene?.setTarget(centreSlot(c.total), !animate);
      },
      toggleSound: () => audio.toggleMuted(),
    });
    e2eState.beads = beadsScreen.count;
    actions.on("beads", (open) => {
      if (!open) {
        beadsScreen.close();
        return;
      }
      beadsScene ??= new BeadsScene();
      beadsScreen.open();
    });
    audio.on("change", () => {
      hud.setSound(!audio.muted);
      beadsScreen.setSound(!audio.muted);
    });
    chant.onChange((c) => {
      hud.setChant(c.on);
      if (c.error) toasts.show(vi.toast.chantError, "warn");
    });
    hud.setSound(!audio.muted);
    beadsScreen.setSound(!audio.muted);
    hud.setChant(chant.state.on);
    hud.setRoom(roomNumber(room) ?? 1, roomNameOf(null, roomNumber(room) ?? 1));
    hud.addBanner(new CeremonyBanner(now).element);
    // Shows itself on a chat room's snapshot; guests get the create-account button (P4-D9).
    const chat = new ChatPanel({
      driver,
      roomAllowsChat,
      isSignedIn: () => session !== null,
      openAccount,
      openRooms: () => rooms.open(),
    });

    // P3-D4: no saved name → nobody is joined until the visitor picks one (asked once the scene is up).
    let entered = savedName !== null;
    // Same suggestion if rest / exit interrupts the first ask and `resume` asks again.
    const suggestion = makeName(Math.random, new Set());
    const askName = (): void => {
      nameDialog.open("enter", suggestion, (name) => {
        useName(name);
        entered = true;
        join();
      });
    };

    // Exit and rest both leave the room, stop rendering and silence audio; coming back rejoins the same room.
    let suspended: "exit" | "rest" | null = null;
    const exitScreen = new ExitScreen(() => resume());
    const rest = new RestScreen({
      // D25: inactive → doze in place (still in the room); only a long doze leaves it.
      onSleep: () => {
        if (suspended || !actions.sleep()) return false;
        if (selfId) labels.setAsleep(selfId, true);
        return true;
      },
      onWake: () => {
        actions.wake();
        if (selfId) labels.setAsleep(selfId, false);
      },
      onAway: (away) => {
        if (!suspended) audio.setSuspended(away);
      },
      onRest: () => suspend("rest"),
      sleepMs: p.sleepMs ?? undefined,
      onResume: () => resume(),
      backgroundPlay: () => audio.settings.backgroundPlay,
    });
    const suspend = (why: "exit" | "rest"): void => {
      if (suspended) return;
      suspended = why;
      rooms.close();
      people.close();
      invite.close();
      settings.close();
      offering.close();
      nameDialog.dismiss();
      accountDialog.close();
      audio.setSuspended(true);
      actions.wake();
      actions.interrupt();
      movement.stop();
      driver.disconnect();
      loop?.setPaused(true);
      if (why === "exit") exitScreen.show();
      else rest.show();
    };
    const resume = (): void => {
      if (!suspended) return;
      suspended = null;
      exitScreen.hide();
      rest.hide();
      loop?.setPaused(false);
      audio.setSuspended(false);
      if (entered) driver.connect(room);
      else if (accountChecked) askName();
    };
    actions.on("state", (s) => hud.setAction(s, actions.bowing));
    let joined = false;
    let releaseLost: (() => void) | null = null;
    driver.on("status", (s) => {
      status = s;
      hud.setStatus(s);
      hud.setBowLocked(s !== "connected");
      if (s !== "reconnecting") {
        releaseLost?.();
        releaseLost = null;
      }
      if (s === "connecting" && !joined) toasts.show(vi.toast.connecting);
      else if (s === "reconnecting") releaseLost ??= toasts.hold(vi.toast.reconnecting, "warn");
      else if (s === "full" || s === "limited") {
        toasts.show(s === "full" ? vi.toast.roomFull : vi.toast.tooMany, "error");
        rooms.open(room, s === "limited");
      } else if (s === "connected") joined = true;
    });

    const chip = createWalkChip(() => {
      actions.interrupt();
      movement.stop();
    });
    movement.on("walking", (walking) => chip.setVisible(walking));
    const labels = new NameLabels();
    const events = new EventFilter();
    let selfId: string | null = null;
    let selfName: string | null = null;
    remotes.onChange(() => {
      movement.setObstacles(remotes.obstacles);
      const keep = new Set<string>();
      if (selfId) keep.add(selfId);
      const shown: string[] = [];
      const dozing: string[] = [];
      remotes.forEach((id, name, object, _kneeling, asleep) => {
        keep.add(id);
        labels.set(id, name);
        labels.setAsleep(id, asleep);
        if (asleep) dozing.push(id);
        if (object.parent && object.visible) shown.push(id);
      });
      e2eState.others = shown;
      e2eState.asleep = dozing;
      labels.retain(keep);
      e2eState.count = remotes.realCount;
      hud.setCount(remotes.realCount);
    });
    driver.on("snapshot", (s) => {
      selfId = s.selfId;
      e2eState.selfId = s.selfId;
      const me = s.visitors.find((v) => v.id === s.selfId);
      const near = readNear(location.search);
      // Joined through an invite: the server put us beside the inviter, so adopt that spot instead of our own random spawn.
      if (me && me.cushion === null && near !== null) movement.teleport(me.position);
      // The inviter left (or the link is old): say so rather than leave us looking for them at the gate.
      if (near !== null && !s.visitors.some((v) => v.id === near)) toasts.show(vi.toast.inviterGone);
      stripNearFromUrl();
      if (me) {
        labels.set(me.id, me.name, true);
        labels.setAsleep(me.id, actions.asleep);
      }
      selfName = me?.name ?? null;
      e2eState.selfName = selfName;
      remotes.applySnapshot(s);
      actions.syncSelf(me?.cushion ?? null, s.reserved);
      // Every snapshot is a (re)join; `room` is already the target by now, so compare nothing and start clean.
      labels.clearBubbles();
      e2eState.room = s.room;
      room = s.room;
      hud.setRoom(roomNumber(s.room) ?? 1, s.roomName);
      // The room we are really in goes to the URL (L6: shareable, no reload).
      if (roomFromSearch(location.search) !== s.room) writeRoomToUrl(s.room);
      driver.sendMove(movement.position, self.pose);
    });
    driver.on("update", (u) => {
      // A rename comes back to us too (P3-D2); RemoteAvatars skips our own record, so our label follows it here.
      const me = selfId === null ? undefined : u.visitors.find((v) => v.id === selfId);
      if (me && me.name !== selfName) {
        selfName = me.name;
        labels.set(me.id, selfName, true);
        e2eState.selfName = selfName;
      }
      remotes.applyUpdate(u);
    });
    // Live lines only (history stays in the panel); our own echo shows over us too (P4-D9).
    driver.on("chat", (line) => labels.say(line.visitorId, line.text, performance.now()));
    driver.on("account", (a) => {
      // A reply to an `auth` sent before signing out is stale.
      if (session === null) return;
      // Only fills the row when `me` could not answer (offline at start); the mock driver names every account alike.
      if (a !== null) {
        if (username === null) showAccount(a.username);
      }
      else {
        // Token refused (expired, signed out elsewhere); the driver keeps it until told (T4b).
        forgetSession();
        driver.setSession(null);
      }
    });
    driver.on("inviteArrived", (a) => toasts.show(vi.toast.arrivedNear.replace("{name}", a.name)));
    driver.on("corrected", (p) => movement.teleport(p));
    driver.on("event", (e) => {
      if (!events.accept(e, serverNow()) || e.visitorId === selfId || e.type !== "hello") return;
      remotes.greet(e.visitorId);
      const name = remotes.nameOf(e.visitorId);
      if (name) toasts.show(vi.toast.helloFrom.replace("{name}", name));
    });
    movement.on("move", (p) => driver.sendMove(p, self.pose));
    // L1: no `?room=` → the emptiest room with space (room 1 when the list is unreachable).
    const join = (): void => {
      if (roomFromSearch(location.search)) driver.connect(room);
      else
        driver.listRooms().then(
          (list) => {
            room = emptiestRoom(list) ?? room;
            if (reloadIfOtherSpace(room)) return;
            hud.setRoom(roomNumber(room) ?? 1, list.find((r) => r.id === room)?.name ?? roomNameOf(null, roomNumber(room) ?? 1));
            driver.connect(room);
          },
          () => driver.connect(room),
        );
    };
    if (entered) join();

    const checkSession = async (token: string): Promise<void> => {
      try {
        const r = await accountApi.me(token);
        // Signed out or in again while waiting.
        if (session !== token) return;
        if (r.ok) applyAccount(token, r.account);
        else if (r.error === "unauthorized") forgetSession();
        // Offline / server down: keep the token; the socket answers `account null` if it is bad.
        else driver.setSession(token);
      } finally {
        accountChecked = true;
        if (!entered && !suspended && firstFrameShown) askName();
      }
    };
    if (session !== null) void checkSession(session);

    document.body.prepend(renderer.domElement);
    const stats = new FrameStats();
    const quality = new Quality(renderer, stats, p.e2e ? 1 : null);
    const activeRenderer = renderer;
    const perf = (): PerfInfo => {
      const s = stats.summary();
      return { calls: activeRenderer.info.render.calls, triangles: activeRenderer.info.render.triangles, fps: s.fps, p95: s.p95 };
    };

    const input = new Input(renderer.domElement, {
      tap: (x, y) => {
        actions.interrupt();
        movement.walkTo(pickFloor(cameraWorld, camera, x, y, window.innerWidth, window.innerHeight));
      },
      rotate: rig.rotate,
      zoom: rig.zoom,
    });
    const axes: MoveAxes = { forward: 0, right: 0 };
    const selfState: NonNullable<E2EState["self"]> = { position: { ...movement.position }, pose: self.pose, cushion: null, asleep: false };
    e2eState.self = selfState;

    const beadsShown = (): BeadsScene | null => (beadsScreen.isOpen ? beadsScene : null);
    loop = new Loop(
      renderer,
      () => {
        const b = beadsShown();
        if (b) activeRenderer.render(b.scene, b.camera);
        else activeRenderer.render(scene, camera);
      },
      stats,
    );
    loop.add((dt) => beadsShown()?.update(dt));
    // World-only updaters pause behind the bead screen; our own state (above) keeps running.
    const world =
      (fn: (dt: number, t: number) => void) =>
      (dt: number, t: number): void => {
        if (!beadsShown()) fn(dt, t);
      };
    loop.add((dt) => {
      input.axes(axes);
      if (axes.forward !== 0 || axes.right !== 0) actions.interrupt();
      // Keys are camera-relative: forward = where the camera looks, right = screen right.
      const sy = Math.sin(rig.yaw);
      const cy = Math.cos(rig.yaw);
      movement.setDirection(sy * axes.forward - cy * axes.right, cy * axes.forward + sy * axes.right);
      movement.update(dt, performance.now());
      actions.update(dt);

      const pos = movement.position;
      const y = actions.seated ? CUSHION_TOP : space.groundY(pos.x, pos.z);
      self.object.position.set(pos.x, y, pos.z);
      self.object.rotation.y = pos.yaw;
      self.setMoving(movement.speed);
      self.update(dt, now());
      contacts.place(0, pos.x, y, pos.z);
      if (!fixedCamera) rig.update(dt, pos.x, y, pos.z, movement.heading);
      env.setFocus(pos.x, y, pos.z);

      selfState.position.x = pos.x;
      selfState.position.z = pos.z;
      selfState.position.yaw = pos.yaw;
      selfState.pose = self.pose;
      selfState.cushion = actions.cushion;
      selfState.asleep = actions.asleep;
    });
    const placeLabel = (id: string, _name: string, obj: Object3D, kneeling: boolean): void => {
      labels.place(id, obj.position.x, obj.position.y + labelHeight(kneeling), obj.position.z);
    };
    loop.add(
      world((dt) => {
        remotes.update(dt, serverNow());
        labels.begin(camera);
        if (selfId) {
          const o = self.object.position;
          labels.place(selfId, o.x, o.y + labelHeight(actions.seated || actions.asleep || self.pose === "beads"), o.z);
        }
        remotes.forEach(placeLabel);
        labels.end();
      }),
    );
    loop.add(world((dt) => env.update(dt, camera)));
    loop.add(world((dt, t) => scenery.update(dt, t, env.daylight, camera)));
    loop.add(quality.update);
    if (p.debug) loop.add(createDebugOverlay(perf).update);
    if (p.e2e) installE2EHooks(perf);

    window.addEventListener("resize", () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      quality.apply();
    });

    loop.onFirstFrame(() => {
      hideBoot();
      e2eState.ready = true;
      firstFrameShown = true;
      // Rest / exit may already have taken over (hidden tab); `resume` asks then. A saved session answers first.
      if (!entered && !suspended && accountChecked) askName();
    });
    loop.start();
  } catch (err) {
    renderer.domElement.remove();
    renderer.dispose();
    assets.dispose();
    throw err;
  }
}
