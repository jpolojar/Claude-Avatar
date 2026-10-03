// The 3D avatar: a VRM model rendered with three.js and @pixiv/three-vrm,
// animated by app state, procedural idle motion and audio-driven lip sync.
import { VRMLoaderPlugin, VRMUtils, type VRM, type VRMHumanBoneName } from "@pixiv/three-vrm";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { AppState } from "../app";
import { peekAudio } from "../audio/context";
import { AmplitudeLipSync, approach, proceduralMouth, type MouthShape } from "../audio/lipsync";
import { Blinker, STATE_POSES, Saccades, drift } from "./motion";

/** Where the mouth movement comes from while the avatar speaks. */
export type MouthSource = "audio" | "procedural" | null;

const VOWELS = ["aa", "ih", "ou", "ee", "oh"] as const;
const POSE_TAU = 0.35; // seconds to settle into a new state pose
const EXPRESSION_TAU = 0.25;

export class Avatar {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  private readonly timer = new THREE.Timer();
  private readonly gazeTarget = new THREE.Object3D();
  private readonly focus = new THREE.Vector3(0, 1.4, 0);
  private vrm: VRM | null = null;

  private state: AppState = "idle";
  private mouthSource: MouthSource = null;
  private readonly blinker = new Blinker();
  private readonly saccades = new Saccades();
  private readonly lipSync = new AmplitudeLipSync();
  private readonly expressions = new Map<string, number>();
  private head = { x: 0, y: 0, z: 0 };
  private gaze = { x: 0, y: 0 };
  private time = 0;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.className = "avatar-canvas";
    container.append(this.renderer.domElement);

    const light = new THREE.DirectionalLight(0xffffff, Math.PI);
    light.position.set(1, 1.5, 2);
    this.scene.add(light, new THREE.AmbientLight(0xffffff, 0.6), this.gazeTarget);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.timer.connect(document); // ignores the time spent in a hidden tab
    this.renderer.setAnimationLoop((timestamp) => this.frame(timestamp));
  }

  async load(url: string): Promise<void> {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url);
    const vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm) throw new Error("Not a VRM file");

    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    VRMUtils.rotateVRM0(vrm); // VRM 0.x models face -Z; turn them toward the camera
    vrm.scene.traverse((obj) => (obj.frustumCulled = false));

    relaxArms(vrm);
    // Hair and cloth physics were initialised in the T-pose; restart them from
    // the relaxed pose, or the sleeves keep flaring out sideways.
    vrm.humanoid.update();
    vrm.nodeConstraintManager?.update();
    vrm.scene.updateMatrixWorld(true);
    vrm.springBoneManager?.reset();

    this.scene.add(vrm.scene);
    if (vrm.lookAt) vrm.lookAt.target = this.gazeTarget;
    this.vrm = vrm;

    // Frame head and shoulders.
    vrm.scene.updateMatrixWorld(true);
    vrm.humanoid.getNormalizedBoneNode("head")?.getWorldPosition(this.focus);
    this.resize();
  }

  /** Current expression weights, for debugging. */
  get expressionValues(): Record<string, number> {
    return Object.fromEntries(this.expressions);
  }

  setState(state: AppState): void {
    this.state = state;
  }

  setMouthSource(source: MouthSource): void {
    this.mouthSource = source;
    if (source !== "audio") this.lipSync.reset();
  }

  private resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // `focus` is the head bone (top of the neck). Frame from the top of the
    // head down to the chest; narrow (portrait) stages need more distance.
    const distance = this.camera.aspect < 0.8 ? 1.5 : 1.0;
    this.camera.position.set(0, this.focus.y + 0.02, distance);
    this.camera.lookAt(0, this.focus.y - 0.02, 0);
    this.camera.updateProjectionMatrix();
  }

  private frame(timestamp: number): void {
    this.timer.update(timestamp);
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.time += dt;
    const vrm = this.vrm;
    if (vrm) {
      this.animate(vrm, dt);
      vrm.update(dt);
    }
    this.renderer.render(this.scene, this.camera);
  }

  private animate(vrm: VRM, dt: number): void {
    const t = this.time;
    const pose = STATE_POSES[this.state];
    const mouth = this.mouthShape(dt);

    // Head: state pose + slow drift + a small nod with the voice.
    const k = 1 - Math.exp(-dt / POSE_TAU);
    this.head.x += (pose.head.x - this.head.x) * k;
    this.head.y += (pose.head.y - this.head.y) * k;
    this.head.z += (pose.head.z - this.head.z) * k;
    setRotation(vrm, "neck", {
      x: this.head.x * 0.4 + drift(t, 1) * 0.02 + mouth.level * 0.02,
      y: this.head.y * 0.4 + drift(t, 2) * 0.04,
      z: this.head.z * 0.4 + drift(t, 3) * 0.015,
    });
    setRotation(vrm, "head", {
      x: this.head.x * 0.6 + drift(t, 4) * 0.02,
      y: this.head.y * 0.6 + drift(t, 5) * 0.05,
      z: this.head.z * 0.6,
    });

    // Breathing: ~15 breaths per minute.
    const breath = Math.sin(t * Math.PI * 0.5);
    setRotation(vrm, "chest", { x: breath * 0.012, y: 0, z: 0 });
    setRotation(vrm, "spine", { x: breath * 0.006, y: drift(t, 6) * 0.015, z: 0 });

    // Gaze: at the camera with small glances, or away while thinking.
    const glance = this.state === "thinking" ? { x: 0, y: 0 } : this.saccades.update(t);
    this.gaze.x += (pose.gaze.x + glance.x - this.gaze.x) * k;
    this.gaze.y += (pose.gaze.y + glance.y - this.gaze.y) * k;
    this.gazeTarget.position.set(
      this.camera.position.x + this.gaze.x,
      this.camera.position.y + this.gaze.y,
      this.camera.position.z,
    );

    // Expressions: state mood, blink and vowels.
    const targets: Record<string, number> = { ...pose.expressions, blink: this.blinker.update(t) };
    const open = mouth.level;
    targets.aa = open * 0.9;
    targets.ee = open * mouth.brightness * 0.35;
    targets.ih = open * mouth.brightness * 0.2;
    targets.oh = open * (1 - mouth.brightness) * 0.35;
    targets.ou = open * (1 - mouth.brightness) * 0.2;

    const manager = vrm.expressionManager;
    if (!manager) return;
    for (const [name, target] of Object.entries(targets)) {
      // Blink and vowels are already shaped; only moods get extra smoothing.
      const instant = name === "blink" || (VOWELS as readonly string[]).includes(name);
      const current = this.expressions.get(name) ?? 0;
      const value = instant ? target : approach(current, target, dt, EXPRESSION_TAU);
      this.expressions.set(name, value);
      manager.setValue(name, value);
    }
  }

  private mouthShape(dt: number): MouthShape {
    if (this.mouthSource === "procedural") return proceduralMouth(this.time);
    const analyser = peekAudio()?.analyser;
    if (this.mouthSource === "audio" && analyser) return this.lipSync.update(analyser, dt);
    return { level: 0, brightness: 0.5 };
  }
}

/** From the T-pose to arms resting at the sides. */
function relaxArms(vrm: VRM): void {
  setRotation(vrm, "leftUpperArm", { x: 0, y: 0, z: -1.2 });
  setRotation(vrm, "rightUpperArm", { x: 0, y: 0, z: 1.2 });
  setRotation(vrm, "leftLowerArm", { x: 0, y: -0.2, z: -0.1 });
  setRotation(vrm, "rightLowerArm", { x: 0, y: 0.2, z: 0.1 });
}

function setRotation(vrm: VRM, bone: VRMHumanBoneName, r: { x: number; y: number; z: number }): void {
  vrm.humanoid.getNormalizedBoneNode(bone)?.rotation.set(r.x, r.y, r.z);
}
