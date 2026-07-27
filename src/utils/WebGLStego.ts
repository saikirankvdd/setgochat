export class WebGLStego {
  private gl: WebGL2RenderingContext;
  private encodeProgram: WebGLProgram;
  private decodeProgram: WebGLProgram;
  
  private coverTexture: WebGLTexture;
  private dataTexture: WebGLTexture;
  private stegoTexture: WebGLTexture;
  private fbo: WebGLFramebuffer;
  
  private width: number = 640;
  private height: number = 480;

  constructor(width: number = 640, height: number = 480) {
    this.width = width;
    this.height = height;
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL2 not supported");
    this.gl = gl;

    this.encodeProgram = this.createProgram(this.vertexShaderSource, this.encoderFragmentSource);
    this.decodeProgram = this.createProgram(this.vertexShaderSource, this.decoderFragmentSource);

    const cols = Math.floor(this.width / 8);
    const rows = Math.floor(this.height / 4);

    this.coverTexture = this.createTexture(this.width, this.height);
    this.dataTexture = this.createTexture(cols, rows);
    this.stegoTexture = this.createTexture(this.width, this.height);
    this.fbo = gl.createFramebuffer()!;
  }

  private createShader(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type)!;
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      console.error(this.gl.getShaderInfoLog(shader));
      throw new Error("Shader compile error");
    }
    return shader;
  }

  private createProgram(vsSource: string, fsSource: string): WebGLProgram {
    const vs = this.createShader(this.gl.VERTEX_SHADER, vsSource);
    const fs = this.createShader(this.gl.FRAGMENT_SHADER, fsSource);
    const program = this.gl.createProgram()!;
    this.gl.attachShader(program, vs);
    this.gl.attachShader(program, fs);
    this.gl.linkProgram(program);
    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      throw new Error("Program link error");
    }
    return program;
  }

  private createTexture(w?: number, h?: number): WebGLTexture {
    const tex = this.gl.createTexture()!;
    this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
    if (w && h) {
      this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, w, h, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, null);
    }
    return tex;
  }

  public encode(coverImageData: ImageData, bits: Uint8Array): ImageData {
    const gl = this.gl;
    const cols = Math.floor(this.width / 8);
    const rows = Math.floor(this.height / 4);

    // 1. Upload Cover Video Texture
    gl.bindTexture(gl.TEXTURE_2D, this.coverTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, coverImageData.data);

    // 2. Upload Data Texture
    const dataPixels = new Uint8Array(cols * rows * 4); // RGBA per block pair
    
    // Header (320 bits) -> packed into first 320 block pairs
    for(let i=0; i<320; i++) {
        const bit = i < bits.length ? bits[i] : 0;
        dataPixels[i*4 + 0] = bit * 255; // R
        dataPixels[i*4 + 1] = bit * 255; // G
        dataPixels[i*4 + 2] = bit * 255; // B
        dataPixels[i*4 + 3] = 255;
    }
    
    // Data region
    let bitIdx = 320;
    for(let i=320; i<cols*rows; i++) {
        dataPixels[i*4 + 0] = bitIdx < bits.length ? bits[bitIdx++] * 255 : 0; // R
        dataPixels[i*4 + 1] = bitIdx < bits.length ? bits[bitIdx++] * 255 : 0; // G
        dataPixels[i*4 + 2] = bitIdx < bits.length ? bits[bitIdx++] * 255 : 0; // B
        dataPixels[i*4 + 3] = 255;
    }

    gl.bindTexture(gl.TEXTURE_2D, this.dataTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, dataPixels);

    // 3. Render
    gl.useProgram(this.encodeProgram);
    
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.coverTexture);
    gl.uniform1i(gl.getUniformLocation(this.encodeProgram, "u_cover"), 0);
    
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.dataTexture);
    gl.uniform1i(gl.getUniformLocation(this.encodeProgram, "u_data"), 1);

    gl.uniform2f(gl.getUniformLocation(this.encodeProgram, "u_resolution"), this.width, this.height);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.stegoTexture, 0);
    
    gl.viewport(0, 0, this.width, this.height);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    const outPixels = new Uint8Array(this.width * this.height * 4);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, outPixels);
    
    return new ImageData(new Uint8ClampedArray(outPixels.buffer), this.width, this.height);
  }

  public decode(stegoImageData: ImageData): Uint8Array {
    const gl = this.gl;
    const cols = Math.floor(this.width / 8);
    const rows = Math.floor(this.height / 4);

    gl.bindTexture(gl.TEXTURE_2D, this.stegoTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, stegoImageData.data);

    gl.useProgram(this.decodeProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.stegoTexture);
    gl.uniform1i(gl.getUniformLocation(this.decodeProgram, "u_stego"), 0);
    gl.uniform2f(gl.getUniformLocation(this.decodeProgram, "u_resolution"), this.width, this.height);

    // Render extracted bits to dataTexture (cols x rows)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.dataTexture, 0);
    
    gl.viewport(0, 0, cols, rows);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.viewport(0, 0, this.width, this.height); // restore

    const extractedData = new Uint8Array(cols * rows * 4);
    gl.readPixels(0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, extractedData);
    
    // Pack RGBA back into bit array
    const maxUsable = ((cols * rows) - 320) * 3 + 320;
    const bits = new Uint8Array(maxUsable);
    
    for(let i=0; i<320; i++) {
        bits[i] = extractedData[i*4 + 1] > 127 ? 1 : 0; // G channel for header
    }
    let bitIdx = 320;
    for(let i=320; i<cols*rows; i++) {
        bits[bitIdx++] = extractedData[i*4 + 0] > 127 ? 1 : 0; // R
        bits[bitIdx++] = extractedData[i*4 + 1] > 127 ? 1 : 0; // G
        bits[bitIdx++] = extractedData[i*4 + 2] > 127 ? 1 : 0; // B
    }

    return bits;
  }

  private vertexShaderSource = `#version 300 es
    out vec2 v_texCoord;
    void main() {
        vec2 positions[6] = vec2[](
            vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0,  1.0),
            vec2(-1.0,  1.0), vec2(1.0, -1.0), vec2(1.0,  1.0)
        );
        gl_Position = vec4(positions[gl_VertexID], 0.0, 1.0);
        v_texCoord = positions[gl_VertexID] * 0.5 + 0.5;
    }
  `;

  private encoderFragmentSource = `#version 300 es
    precision highp float;
    in vec2 v_texCoord;
    uniform sampler2D u_cover;
    uniform sampler2D u_data;
    uniform vec2 u_resolution;
    out vec4 outColor;

    void main() {
        vec2 pixelCoord = floor(v_texCoord * u_resolution);
        float px = pixelCoord.x;
        float py = pixelCoord.y;
        
        float cols = u_resolution.x / 8.0;
        float rows = u_resolution.y / 4.0;
        float colIdx = floor(px / 8.0);
        float rowIdx = floor(py / 4.0);
        float blockPairIdx = rowIdx * cols + colIdx;
        
        vec2 dataTexCoord = vec2((colIdx + 0.5) / cols, (rowIdx + 0.5) / rows);
        vec4 bits = texture(u_data, dataTexCoord);
        
        vec4 sumA = vec4(0.0);
        vec4 sumB = vec4(0.0);
        
        float startXA = colIdx * 8.0;
        float startYA = rowIdx * 4.0;
        float startXB = startXA + 4.0;
        
        for(float y = 0.0; y < 4.0; y++) {
            for(float x = 0.0; x < 4.0; x++) {
                sumA += texture(u_cover, vec2(startXA + x + 0.5, startYA + y + 0.5) / u_resolution);
                sumB += texture(u_cover, vec2(startXB + x + 0.5, startYA + y + 0.5) / u_resolution);
            }
        }
        
        vec4 avgA = (sumA / 16.0) * 255.0;
        vec4 avgB = (sumB / 16.0) * 255.0;
        
        float targetDiff = 80.0;
        vec4 shiftA = vec4(0.0);

        if (blockPairIdx < 320.0) {
            // Header: 1 bit per block pair, using Luma (R+G+B)/3
            float lumaA = (avgA.r + avgA.g + avgA.b) / 3.0;
            float lumaB = (avgB.r + avgB.g + avgB.b) / 3.0;
            float diff = lumaA - lumaB;
            float targetBit = (bits.g > 0.5) ? 1.0 : 0.0; // Packed into all channels, use G
            float shift = 0.0;
            
            if (targetBit == 1.0 && diff <= targetDiff) {
                shift = ceil((targetDiff - diff) / 2.0);
            } else if (targetBit == 0.0 && diff >= -targetDiff) {
                shift = -ceil((diff + targetDiff) / 2.0);
            }
            // Apply same shift to R, G, B
            shiftA = vec4(shift, shift, shift, 0.0);
        } else {
            // Data: 3 bits per block pair (R, G, B independently)
            vec4 diff = avgA - avgB;
            
            float targetBitR = (bits.r > 0.5) ? 1.0 : 0.0;
            if(targetBitR == 1.0 && diff.r <= targetDiff) {
                shiftA.r = ceil((targetDiff - diff.r) / 2.0);
            } else if(targetBitR == 0.0 && diff.r >= -targetDiff) {
                shiftA.r = -ceil((diff.r + targetDiff) / 2.0);
            }
            
            float targetBitG = (bits.g > 0.5) ? 1.0 : 0.0;
            if(targetBitG == 1.0 && diff.g <= targetDiff) {
                shiftA.g = ceil((targetDiff - diff.g) / 2.0);
            } else if(targetBitG == 0.0 && diff.g >= -targetDiff) {
                shiftA.g = -ceil((diff.g + targetDiff) / 2.0);
            }
            
            float targetBitB = (bits.b > 0.5) ? 1.0 : 0.0;
            if(targetBitB == 1.0 && diff.b <= targetDiff) {
                shiftA.b = ceil((targetDiff - diff.b) / 2.0);
            } else if(targetBitB == 0.0 && diff.b >= -targetDiff) {
                shiftA.b = -ceil((diff.b + targetDiff) / 2.0);
            }
        }

        vec4 originalColor = texture(u_cover, v_texCoord) * 255.0;
        bool isBlockA = (px - startXA) < 4.0;
        
        vec4 finalColor;
        if(isBlockA) {
            finalColor = originalColor + shiftA;
        } else {
            finalColor = originalColor - shiftA;
        }
        
        outColor = vec4(clamp(finalColor.rgb / 255.0, 0.0, 1.0), 1.0);
    }
  `;

  private decoderFragmentSource = `#version 300 es
    precision highp float;
    in vec2 v_texCoord;
    uniform sampler2D u_stego;
    uniform vec2 u_resolution; 
    out vec4 outColor;

    void main() {
        vec2 blockCoord = floor(gl_FragCoord.xy);
        float cols = u_resolution.x / 8.0;
        float colIdx = blockCoord.x;
        float rowIdx = blockCoord.y;
        float blockPairIdx = rowIdx * cols + colIdx;
        
        float startXA = colIdx * 8.0;
        float startYA = rowIdx * 4.0;
        float startXB = startXA + 4.0;
        
        vec4 sumA = vec4(0.0);
        vec4 sumB = vec4(0.0);
        
        for(float y = 0.0; y < 4.0; y++) {
            for(float x = 0.0; x < 4.0; x++) {
                sumA += texture(u_stego, vec2(startXA + x + 0.5, startYA + y + 0.5) / u_resolution);
                sumB += texture(u_stego, vec2(startXB + x + 0.5, startYA + y + 0.5) / u_resolution);
            }
        }
        
        vec4 avgA = (sumA / 16.0) * 255.0;
        vec4 avgB = (sumB / 16.0) * 255.0;
        
        if (blockPairIdx < 320.0) {
            float lumaA = (avgA.r + avgA.g + avgA.b) / 3.0;
            float lumaB = (avgB.r + avgB.g + avgB.b) / 3.0;
            float diff = lumaA - lumaB;
            float bit = (diff > 0.0) ? 1.0 : 0.0;
            outColor = vec4(bit, bit, bit, 1.0); // Store bit in all RGB channels
        } else {
            vec4 diff = avgA - avgB;
            float bitR = (diff.r > 0.0) ? 1.0 : 0.0;
            float bitG = (diff.g > 0.0) ? 1.0 : 0.0;
            float bitB = (diff.b > 0.0) ? 1.0 : 0.0;
            outColor = vec4(bitR, bitG, bitB, 1.0);
        }
    }
  `;
}
