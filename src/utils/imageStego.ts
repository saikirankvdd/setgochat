/**
 * Image Steganography Utility
 * Generates a 4K abstract wallpaper and hides data in the LSB of its pixels using LSB Matching (±1).
 */

class PRNG {
  private seed: number;
  constructor(seedString: string) {
    let hash = 5381;
    for (let i = 0; i < seedString.length; i++) {
      hash = ((hash << 5) + hash) ^ seedString.charCodeAt(i);
      hash |= 0;
    }
    this.seed = hash >>> 0;
  }
  next(): number {
    this.seed ^= this.seed << 13;
    this.seed ^= this.seed >>> 17;
    this.seed ^= this.seed << 5;
    this.seed = this.seed >>> 0;
    return this.seed / 4294967296;
  }
  nextByte(): number {
    return Math.floor(this.next() * 256);
  }
}

function generateScatterPattern(totalChannels: number, dataLength: number, password: string): number[] {
  const prng = new PRNG(password);
  const pool: number[] = new Array(totalChannels);
  for (let i = 0; i < totalChannels; i++) pool[i] = i;
  
  const indices: number[] = new Array(dataLength);
  for (let i = 0; i < dataLength; i++) {
    const j = i + Math.floor(prng.next() * (totalChannels - i));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
    indices[i] = pool[i];
  }
  
  indices.sort((a, b) => a - b);
  return indices;
}

function encryptLengthHeader(length: number, password: string): Uint8Array {
  const prng = new PRNG('IMG_HDR_' + password);
  const lengthBytes = new Uint8Array(4);
  lengthBytes[0] = (length >>> 24) & 0xFF;
  lengthBytes[1] = (length >>> 16) & 0xFF;
  lengthBytes[2] = (length >>> 8) & 0xFF;
  lengthBytes[3] = length & 0xFF;
  
  for (let i = 0; i < 4; i++) lengthBytes[i] ^= prng.nextByte();
  return lengthBytes;
}

function decryptLengthHeader(encBytes: Uint8Array, password: string): number {
  const prng = new PRNG('IMG_HDR_' + password);
  const decrypted = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    decrypted[i] = encBytes[i] ^ prng.nextByte();
  }
  return (decrypted[0] << 24) | (decrypted[1] << 16) | (decrypted[2] << 8) | decrypted[3];
}

/**
 * Generates a 4K abstract wallpaper to an offscreen canvas.
 * Creates organic, flowing shapes with bokeh effects to look like a premium 
 * stock wallpaper (e.g., macOS or Windows abstract backgrounds).
 */
export function generateWallpaperCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const width = 3840;
  const height = 2160;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context not supported');

  // 1. Pick a cohesive color palette
  const palettes = [
    // Dark modern
    [{r: 15, g: 23, b: 42}, {r: 88, g: 28, b: 135}, {r: 124, g: 58, b: 237}, {r: 219, g: 39, b: 119}],
    // Ocean deep
    [{r: 2, g: 6, b: 23}, {r: 14, g: 116, b: 144}, {r: 6, g: 182, b: 212}, {r: 16, g: 185, b: 129}],
    // Sunset glow
    [{r: 67, g: 20, b: 7}, {r: 190, g: 18, b: 60}, {r: 225, g: 29, b: 72}, {r: 245, g: 158, b: 11}],
    // Midnight forest
    [{r: 6, g: 24, b: 20}, {r: 4, g: 120, b: 87}, {r: 16, g: 185, b: 129}, {r: 101, g: 163, b: 13}],
  ];
  const palette = palettes[Math.floor(Math.random() * palettes.length)];

  // 2. Base Background Gradient
  const bgGradient = ctx.createLinearGradient(0, 0, width, height);
  bgGradient.addColorStop(0, `rgb(${palette[0].r}, ${palette[0].g}, ${palette[0].b})`);
  bgGradient.addColorStop(1, `rgb(${palette[1].r}, ${palette[1].g}, ${palette[1].b})`);
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, width, height);

  // 3. Draw flowing, organic abstract shapes (bezier curves/blobs)
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 5; i++) {
    const p1 = { x: Math.random() * width, y: Math.random() * height };
    const p2 = { x: Math.random() * width, y: Math.random() * height };
    const cp1 = { x: Math.random() * width, y: Math.random() * height };
    const cp2 = { x: Math.random() * width, y: Math.random() * height };
    const rad = 500 + Math.random() * 1500;

    const color = palette[2 + Math.floor(Math.random() * 2)];
    
    // Radial gradient for smooth glow
    const glow = ctx.createRadialGradient(p1.x, p1.y, 0, p1.x, p1.y, rad);
    glow.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, 0.6)`);
    glow.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
    
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.moveTo(p1.x - rad, p1.y - rad);
    ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p2.x + rad, p2.y + rad);
    ctx.bezierCurveTo(p2.x + rad, p1.y + rad, p1.x - rad, p2.y - rad, p1.x - rad, p1.y - rad);
    ctx.fill();
  }

  // 4. Add bokeh / floating light orbs
  for (let i = 0; i < 20; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const radius = 50 + Math.random() * 300;
    const color = palette[Math.floor(Math.random() * palette.length)];
    const opacity = 0.1 + Math.random() * 0.4;

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${opacity})`;
    ctx.fill();
    
    // Add subtle ring around bokeh
    ctx.lineWidth = 2 + Math.random() * 8;
    ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${opacity * 0.5})`;
    ctx.stroke();
  }
  
  // Reset composite operation
  ctx.globalCompositeOperation = 'source-over';

  // 5. Add organic film grain (Crucial for LSB steganography to look natural)
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    // Generate natural-looking noise (box-muller transform approximation for gaussian noise)
    const u = 1 - Math.random();
    const v = Math.random();
    const noise = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v) * 8;
    
    data[i] = Math.min(255, Math.max(0, data[i] + noise));
    data[i+1] = Math.min(255, Math.max(0, data[i+1] + noise));
    data[i+2] = Math.min(255, Math.max(0, data[i+2] + noise));
  }
  ctx.putImageData(imgData, 0, 0);

  return canvas;
}

/**
 * Encodes binary string data into the canvas image data using LSB Matching.
 * Returns a Blob containing the PNG file.
 */
export function encodeImageLSB(canvas: HTMLCanvasElement, dataBits: string, password: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return reject('No canvas context');

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imgData.data;
    
    // Total usable channels (R, G, B). Ignore Alpha (every 4th byte)
    const numPixels = canvas.width * canvas.height;
    const totalChannels = numPixels * 3;
    
    const totalBitsNeeded = 32 + dataBits.length;
    if (totalBitsNeeded > totalChannels) {
      return reject(new Error('Data too large for image carrier (max ~3MB)'));
    }

    // 1. Write encrypted length header to the first 32 channels (skipping Alpha)
    const encLength = encryptLengthHeader(dataBits.length, password);
    let channelIdx = 0;
    for (let i = 0; i < 32; i++) {
      // skip alpha channel (index % 4 === 3)
      if (channelIdx % 4 === 3) channelIdx++;
      
      const byteIdx = Math.floor(i / 8);
      const bitIdx = 7 - (i % 8);
      const bit = (encLength[byteIdx] >>> bitIdx) & 1;
      
      let val = pixels[channelIdx];
      if ((val & 1) !== bit) {
        if (val === 255) val -= 1;
        else if (val === 0) val += 1;
        else val += (Math.random() < 0.5 ? 1 : -1); // LSB Matching
      }
      pixels[channelIdx] = val;
      channelIdx++;
    }

    // 2. Scatter pattern for the rest
    const usableChannels = totalChannels - 32;
    const indices = generateScatterPattern(usableChannels, dataBits.length, password);

    // 3. Write scattered bits
    for (let i = 0; i < dataBits.length; i++) {
      let targetLogicalIdx = 32 + indices[i];
      // Convert logical channel index (0..totalChannels) to actual pixel array index (skipping alphas)
      let actualIdx = targetLogicalIdx + Math.floor(targetLogicalIdx / 3);
      
      const bitToEmbed = parseInt(dataBits[i]);
      let val = pixels[actualIdx];
      
      if ((val & 1) !== bitToEmbed) {
        if (val === 255) val -= 1;
        else if (val === 0) val += 1;
        else val += (Math.random() < 0.5 ? 1 : -1); // LSB Matching
      }
      pixels[actualIdx] = val;
    }

    ctx.putImageData(imgData, 0, 0);
    
    // Export to Blob
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to create Blob'));
    }, 'image/png');
  });
}

/**
 * Decodes binary string data from an Image object.
 */
export function decodeImageLSB(image: HTMLImageElement, password: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas context');

  ctx.drawImage(image, 0, 0);
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imgData.data;
  
  const numPixels = canvas.width * canvas.height;
  const totalChannels = numPixels * 3;

  // 1. Read encrypted length
  const encBytes = new Uint8Array(4);
  let channelIdx = 0;
  for (let i = 0; i < 32; i++) {
    if (channelIdx % 4 === 3) channelIdx++; // skip alpha
    
    const bit = pixels[channelIdx] & 1;
    const byteIdx = Math.floor(i / 8);
    const bitIdx = 7 - (i % 8);
    encBytes[byteIdx] |= (bit << bitIdx);
    
    channelIdx++;
  }
  
  const dataLength = decryptLengthHeader(encBytes, password);
  if (dataLength <= 0 || dataLength > totalChannels - 32) {
    throw new Error('Invalid stego image or wrong password');
  }

  // 2. Generate scatter pattern
  const usableChannels = totalChannels - 32;
  const indices = generateScatterPattern(usableChannels, dataLength, password);

  // 3. Read scattered bits
  let dataBits = '';
  for (let i = 0; i < dataLength; i++) {
    let targetLogicalIdx = 32 + indices[i];
    let actualIdx = targetLogicalIdx + Math.floor(targetLogicalIdx / 3);
    dataBits += (pixels[actualIdx] & 1).toString();
  }

  return dataBits;
}
