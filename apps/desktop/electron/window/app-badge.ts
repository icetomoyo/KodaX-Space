const BADGE_SIZE = 16;
const BADGE_BLUE = 38;
const BADGE_GREEN = 38;
const BADGE_RED = 220;

const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '+': ['000', '010', '111', '010', '000'],
};

export interface WindowsBadgeWindow<Image> {
  isDestroyed(): boolean;
  setOverlayIcon(image: Image | null, description: string): void;
}

export interface WindowsBadgeTray<Image> {
  isDestroyed(): boolean;
  setImage(image: Image): void;
}

export interface AppBadgeNativeTarget<Image> {
  platform: NodeJS.Platform;
  setApplicationBadgeCount(count: number): boolean;
  getWindow(): WindowsBadgeWindow<Image> | null;
  getTray(): WindowsBadgeTray<Image> | null;
  readonly baseTrayImage: Image;
  createWindowsOverlayImage(count: number): Image;
  createWindowsTrayImage(count: number): Image;
  onError(error: unknown): void;
}

export interface WindowsBadgeDrawInput {
  readonly width: number;
  readonly height: number;
  readonly count: number;
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

export function windowsBadgeLabel(count: number): string {
  if (count <= 0) return '';
  return count <= 9 ? String(count) : '9+';
}

export function createWindowsBadgeBitmap(count: number): Buffer {
  const bitmap = Buffer.alloc(BADGE_SIZE * BADGE_SIZE * 4);
  drawWindowsBadge(bitmap, {
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    count,
    x: 0,
    y: 0,
    size: BADGE_SIZE,
  });
  return bitmap;
}

export function drawWindowsBadge(bitmap: Buffer, input: WindowsBadgeDrawInput): void {
  assertValidBitmap(bitmap, input);
  const label = windowsBadgeLabel(input.count);
  if (label.length === 0) return;

  const radius = input.size / 2;
  const centerX = input.x + (input.size - 1) / 2;
  const centerY = input.y + (input.size - 1) / 2;
  for (let y = input.y; y < input.y + input.size; y += 1) {
    for (let x = input.x; x < input.x + input.size; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      if (dx * dx + dy * dy <= radius * radius) {
        setBgra(bitmap, input.width, x, y, BADGE_BLUE, BADGE_GREEN, BADGE_RED, 255);
      }
    }
  }
  drawLabel(bitmap, input, label);
}

function assertValidBitmap(bitmap: Buffer, input: WindowsBadgeDrawInput): void {
  const integers = [input.width, input.height, input.x, input.y, input.size];
  if (integers.some((value) => !Number.isInteger(value)) || input.size <= 0) {
    throw new RangeError('Badge bitmap dimensions must be positive integers.');
  }
  if (
    input.x < 0 ||
    input.y < 0 ||
    input.x + input.size > input.width ||
    input.y + input.size > input.height ||
    bitmap.length !== input.width * input.height * 4
  ) {
    throw new RangeError('Badge region must fit an exact BGRA bitmap.');
  }
}

function drawLabel(bitmap: Buffer, input: WindowsBadgeDrawInput, label: string): void {
  const scale = 2;
  const glyphWidth = 3 * scale;
  const spacing = scale;
  const labelWidth = label.length * glyphWidth + (label.length - 1) * spacing;
  const startX = input.x + Math.floor((input.size - labelWidth) / 2);
  const startY = input.y + Math.floor((input.size - 5 * scale) / 2);

  for (const [glyphIndex, character] of [...label].entries()) {
    const glyph = GLYPHS[character];
    if (!glyph) continue;
    for (const [row, pixels] of glyph.entries()) {
      for (const [column, pixel] of [...pixels].entries()) {
        if (pixel !== '1') continue;
        fillWhitePixel(
          bitmap,
          input.width,
          startX + glyphIndex * (glyphWidth + spacing) + column * scale,
          startY + row * scale,
          scale,
        );
      }
    }
  }
}

function fillWhitePixel(bitmap: Buffer, width: number, x: number, y: number, scale: number): void {
  for (let dy = 0; dy < scale; dy += 1) {
    for (let dx = 0; dx < scale; dx += 1) {
      setBgra(bitmap, width, x + dx, y + dy, 255, 255, 255, 255);
    }
  }
}

function setBgra(
  bitmap: Buffer,
  width: number,
  x: number,
  y: number,
  blue: number,
  green: number,
  red: number,
  alpha: number,
): void {
  const offset = (y * width + x) * 4;
  bitmap[offset] = blue;
  bitmap[offset + 1] = green;
  bitmap[offset + 2] = red;
  bitmap[offset + 3] = alpha;
}

export class AppBadgeController<Image> {
  private count = 0;

  constructor(private readonly target: AppBadgeNativeTarget<Image>) {}

  setCount(count: number): boolean {
    if (!Number.isInteger(count) || count < 0 || count > 9999) {
      throw new RangeError('App badge count must be an integer from 0 through 9999.');
    }
    this.count = count;
    return this.refresh();
  }

  refresh(): boolean {
    if (this.target.platform === 'darwin' || this.target.platform === 'linux') {
      return this.tryApply(() => this.target.setApplicationBadgeCount(this.count));
    }
    if (this.target.platform !== 'win32') return false;
    return this.refreshWindows();
  }

  private refreshWindows(): boolean {
    let applied = false;
    const win = this.target.getWindow();
    if (win && !win.isDestroyed()) {
      applied = this.tryApply(() => {
        const image = this.count > 0 ? this.target.createWindowsOverlayImage(this.count) : null;
        win.setOverlayIcon(image, attentionDescription(this.count));
        return true;
      });
    }
    const tray = this.target.getTray();
    if (tray && !tray.isDestroyed()) {
      const trayApplied = this.tryApply(() => {
        const image =
          this.count > 0
            ? this.target.createWindowsTrayImage(this.count)
            : this.target.baseTrayImage;
        tray.setImage(image);
        return true;
      });
      applied = trayApplied || applied;
    }
    return applied;
  }

  private tryApply(operation: () => boolean): boolean {
    try {
      return operation();
    } catch (error) {
      this.target.onError(error);
      return false;
    }
  }
}

function attentionDescription(count: number): string {
  if (count === 1) return 'KodaX Space: 1 Session needs attention';
  return `KodaX Space: ${count} Sessions need attention`;
}
