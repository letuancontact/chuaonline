import {
  AdditiveBlending,
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type Object3D,
} from "three";

const RIPPLE_POOL_SIZE = 4;
const RIPPLE_DURATION_S = 1.15;
/**
 * Sits 2.5 cm proud of the stone path flagstones (`0.05 m` in `garden.ts`), gravel loop (`0.02 m`),
 * and pond stone bank (`0.06 m` in `pond.ts`) so foot auras (`aura_lotus`, `aura_jade`, `aura_wheel`)
 * and woodblock soundwave ripples are never occluded by floor tiles.
 */
const AURA_BASE_Y = 0.075;

interface RippleSlot {
  mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  age: number;
  active: boolean;
}

function drawAuraTexture(kind: string): CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const cx = size / 2;
    const cy = size / 2;
    ctx.clearRect(0, 0, size, size);

    if (kind === "aura_jade") {
      const grad = ctx.createRadialGradient(cx, cy, 12, cx, cy, 118);
      grad.addColorStop(0, "rgba(130, 255, 210, 0.35)");
      grad.addColorStop(0.55, "rgba(64, 210, 165, 0.22)");
      grad.addColorStop(0.85, "rgba(40, 165, 130, 0.45)");
      grad.addColorStop(1, "rgba(20, 120, 95, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, 118, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(165, 255, 225, 0.72)";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(cx, cy, 98, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = "rgba(120, 235, 195, 0.48)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 74, 0, Math.PI * 2);
      ctx.stroke();

      const petals = 8;
      for (let i = 0; i < petals; i++) {
        const a = (i / petals) * Math.PI * 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(a);
        ctx.strokeStyle = "rgba(185, 255, 235, 0.65)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 56);
        ctx.quadraticCurveTo(16, 80, 0, 102);
        ctx.quadraticCurveTo(-16, 80, 0, 56);
        ctx.stroke();
        ctx.restore();
      }
    } else if (kind === "aura_wheel") {
      const grad = ctx.createRadialGradient(cx, cy, 10, cx, cy, 120);
      grad.addColorStop(0, "rgba(255, 230, 150, 0.42)");
      grad.addColorStop(0.5, "rgba(242, 195, 95, 0.25)");
      grad.addColorStop(0.88, "rgba(255, 215, 115, 0.55)");
      grad.addColorStop(1, "rgba(242, 185, 80, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, 120, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(255, 232, 165, 0.85)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, 104, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = "rgba(255, 215, 130, 0.65)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 42, 0, Math.PI * 2);
      ctx.stroke();

      const spokes = 8;
      for (let i = 0; i < spokes; i++) {
        const a = (i / spokes) * Math.PI * 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(a);
        ctx.strokeStyle = "rgba(255, 236, 178, 0.78)";
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(0, 42);
        ctx.lineTo(0, 104);
        ctx.stroke();

        ctx.fillStyle = "rgba(255, 244, 204, 0.85)";
        ctx.beginPath();
        ctx.arc(0, 104, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    } else {
      // Default: aura_lotus (Golden Lotus Mandala)
      const grad = ctx.createRadialGradient(cx, cy, 10, cx, cy, 118);
      grad.addColorStop(0, "rgba(255, 228, 168, 0.38)");
      grad.addColorStop(0.6, "rgba(242, 198, 122, 0.22)");
      grad.addColorStop(0.88, "rgba(245, 208, 138, 0.45)");
      grad.addColorStop(1, "rgba(242, 198, 122, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, 118, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(255, 232, 178, 0.72)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 98, 0, Math.PI * 2);
      ctx.stroke();

      const petals = 12;
      for (let i = 0; i < petals; i++) {
        const a = (i / petals) * Math.PI * 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(a);
        ctx.strokeStyle = "rgba(255, 236, 188, 0.68)";
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(0, 52);
        ctx.quadraticCurveTo(14, 78, 0, 98);
        ctx.quadraticCurveTo(-14, 78, 0, 52);
        ctx.stroke();
        ctx.restore();
      }
    }
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

function drawRippleTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const c = size / 2;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(c, c, 52, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c, c, 38, 0, Math.PI * 2);
    ctx.stroke();
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/**
 * 3D spiritual effects attached to the player's avatar root (`self.object`):
 * - Foot Aura (`aura_lotus`, `aura_jade`, `aura_wheel`)
 * - Woodblock soundwave ripples (`woodblock_crimson`, `woodblock_jade`)
 */
export class SpiritualEffects {
  private readonly root = new Group();
  private readonly planeGeo = new PlaneGeometry(1.65, 1.65);
  private readonly rippleGeo = new PlaneGeometry(1.1, 1.1);
  private readonly auraTextures = new Map<string, CanvasTexture>();
  private readonly rippleTexture: CanvasTexture;
  private readonly auraMat: MeshBasicMaterial;
  private readonly auraMesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly ripples: RippleSlot[] = [];
  private currentAura: string | null = null;
  private currentArtifact: string | null = null;
  private phase = 0;

  constructor(avatarRoot: Object3D) {
    this.root.position.y = AURA_BASE_Y;
    avatarRoot.add(this.root);

    this.auraMat = new MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -10,
      polygonOffsetUnits: -10,
      side: DoubleSide,
    });
    this.auraMesh = new Mesh(this.planeGeo, this.auraMat);
    this.auraMesh.rotation.x = -Math.PI / 2;
    this.auraMesh.renderOrder = 3;
    this.auraMesh.visible = false;
    this.root.add(this.auraMesh);

    this.rippleTexture = drawRippleTexture();
    for (let i = 0; i < RIPPLE_POOL_SIZE; i++) {
      const mat = new MeshBasicMaterial({
        map: this.rippleTexture,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -10,
        polygonOffsetUnits: -10,
        side: DoubleSide,
      });
      const mesh = new Mesh(this.rippleGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.008;
      mesh.renderOrder = 3;
      mesh.visible = false;
      this.root.add(mesh);
      this.ripples.push({ mesh, age: 0, active: false });
    }
  }

  setAura(auraId: string | null): void {
    if (this.currentAura === auraId) return;
    this.currentAura = auraId;
    if (!auraId) {
      this.auraMesh.visible = false;
      return;
    }
    let tex = this.auraTextures.get(auraId);
    if (!tex) {
      tex = drawAuraTexture(auraId);
      this.auraTextures.set(auraId, tex);
    }
    this.auraMat.map = tex;
    this.auraMat.needsUpdate = true;
    this.auraMesh.visible = true;
  }

  setArtifact(artifactId: string | null): void {
    this.currentArtifact = artifactId;
  }

  /** Spawns an expanding 3D lotus soundwave ring when tapping the woodblock. */
  triggerTap(): void {
    if (!this.currentArtifact) return;
    let slot = this.ripples.find((r) => !r.active);
    if (!slot) {
      slot = this.ripples[0];
    }
    if (!slot) return;
    slot.active = true;
    slot.age = 0;
    slot.mesh.visible = true;
    slot.mesh.scale.setScalar(0.45);
    slot.mesh.material.color.setHex(this.currentArtifact === "woodblock_jade" ? 0x64f0c8 : 0xffcf70);
    slot.mesh.material.opacity = 0.85;
  }

  update(dt: number): void {
    this.phase += dt;
    if (this.auraMesh.visible) {
      const speed = this.currentAura === "aura_wheel" ? 0.55 : 0.32;
      this.auraMesh.rotation.z = this.phase * speed;
      const pulse = 0.96 + Math.sin(this.phase * 2.2) * 0.05;
      this.auraMesh.scale.setScalar(pulse);
      this.auraMat.opacity = 0.72 + Math.sin(this.phase * 2.2) * 0.14;
    }

    for (const r of this.ripples) {
      if (!r.active) continue;
      r.age += dt;
      const t = r.age / RIPPLE_DURATION_S;
      if (t >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const scale = 0.45 + t * 1.85;
      r.mesh.scale.setScalar(scale);
      r.mesh.material.opacity = (1 - t) * (1 - t) * 0.82;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.planeGeo.dispose();
    this.rippleGeo.dispose();
    this.auraMat.dispose();
    for (const tex of this.auraTextures.values()) tex.dispose();
    this.auraTextures.clear();
    this.rippleTexture.dispose();
    for (const r of this.ripples) r.mesh.material.dispose();
  }
}
