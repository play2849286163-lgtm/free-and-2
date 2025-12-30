
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { Shot, StyleDistillation, Asset, ProductionMode } from "./types";

const GET_DIRECTOR_PERSONA = (mode: ProductionMode) => `你是一名全球顶尖电影导演${mode === 'anime' ? '（动漫领域）' : '（真人实拍与科幻视觉）'}。
你现在拥有极致的镜头感：
1. 视觉构图：严苛把控构图美学。分镜必须包含：黄金分割、对角线构图、大远景、特写、电影级别布光。
2. 动态捕捉：描述体现动作张力、质感、光影明暗。
3. 媒介控制：${mode === 'anime' ? '强调线条与赛璐珞质感' : '强调极致写实、皮肤纹理、电影胶片感与真实物理光影'}。
4. 语言系统：输出极致美感的中文分镜，并将细节转化为高质量英文 Prompt。`;

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const errorMsg = (error.toString() || "").toLowerCase();
      if ((errorMsg.includes("429") || errorMsg.includes("quota")) && i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, 5000 * (i + 1)));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export const distillStyle = async (imageB64s: string[]): Promise<StyleDistillation> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const parts = imageB64s.map(data => ({
    inlineData: { mimeType: "image/jpeg", data: data.split(',')[1] || data }
  }));

  return await withRetry(async () => {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [ ...parts, { text: "作为美术监督，请解构这些图。判断其媒介类型（photorealistic或illustration）。输出包含：媒介类型、风格总结、核心配色方案(3-5个HEX代码)、光效质感。" } ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            keywords: { type: Type.STRING },
            technicalParams: { type: Type.STRING },
            colorPalette: { type: Type.STRING },
            hexCodes: { type: Type.ARRAY, items: { type: Type.STRING } },
            detectedMedium: { type: Type.STRING, enum: ['illustration', 'photorealistic', 'unknown'] }
          },
          required: ["summary", "keywords", "technicalParams", "colorPalette", "hexCodes", "detectedMedium"]
        }
      }
    });
    return JSON.parse(response.text) as StyleDistillation;
  });
};

export const deductStoryboard = async (script: string, style: StyleDistillation, count: number = 4, mode: ProductionMode = 'anime'): Promise<Shot[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `剧本: "${script}"\n当前视觉DNA: "${style.summary}"\n制作模式: ${mode}\n要求：推演 ${count} 个具备电影张力的分镜。`;

  return await withRetry(async () => {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        systemInstruction: GET_DIRECTOR_PERSONA(mode),
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              composition: { type: Type.STRING },
              flowLogic: { type: Type.STRING },
              chineseDescription: { type: Type.STRING },
              englishPrompt: { type: Type.STRING },
              dialogue: { type: Type.STRING },
              speaker: { type: Type.STRING },
              gender: { type: Type.STRING, enum: ['male', 'female', 'child', 'narrator'] },
              emotion: { type: Type.STRING },
              ambientSfx: { type: Type.STRING }
            },
            required: ["name", "composition", "flowLogic", "chineseDescription", "englishPrompt", "dialogue", "speaker", "gender", "emotion", "ambientSfx"]
          }
        }
      }
    });
    return JSON.parse(response.text).map((item: any, index: number) => ({ ...item, id: `shot-${Date.now()}-${index}` }));
  });
};

export const renderShot = async (
  prompt: string, 
  style: StyleDistillation, 
  aspectRatio: string = "16:9",
  charAssets: Asset[] = [],
  sceneAssets: Asset[] = [],
  mode: ProductionMode = 'anime'
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const parts: any[] = [];
  
  const getActiveImg = (asset: Asset) => asset.images.find(img => img.isActive)?.url;

  charAssets.forEach(asset => {
    const url = getActiveImg(asset);
    if (url) {
      parts.push({ inlineData: { mimeType: "image/jpeg", data: url.split(',')[1] || url } });
      parts.push({ text: `REFERENCE CHARACTER: "${asset.name}"` });
    }
  });

  sceneAssets.forEach(asset => {
    const url = getActiveImg(asset);
    if (url) {
      parts.push({ inlineData: { mimeType: "image/jpeg", data: url.split(',')[1] || url } });
      parts.push({ text: `REFERENCE SCENE: "${asset.name}"` });
    }
  });

  const mediumPrefix = mode === 'anime' ? "Masterpiece Anime Art, high quality illustration" : "Award-winning Cinematic Photography, photorealistic, 8k, highly detailed skin texture, film grain";
  const finalPromptText = `${mediumPrefix}, (Style: ${style.technicalParams}), (Colors: ${style.hexCodes.join(', ')}), ${prompt}, cinematic lighting, dramatic atmosphere --no text, logo, watermark, anime, cartoon (if cinematic)`;
  
  parts.push({ text: finalPromptText });

  return await withRetry(async () => {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts },
      config: { imageConfig: { aspectRatio: aspectRatio as any } },
    });
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
    }
    throw new Error("Render failed");
  });
};

export const removeWatermark = async (imageB64: string, maskB64?: string, customInstruction?: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  return await withRetry(async () => {
    const parts: any[] = [
      { inlineData: { data: imageB64.split(',')[1] || imageB64, mimeType: 'image/jpeg' } }
    ];
    if (maskB64) {
      parts.push({ inlineData: { data: maskB64.split(',')[1] || maskB64, mimeType: 'image/jpeg' } });
      parts.push({ text: "URGENT: Based on this white-on-black mask, completely remove and inpaint the marked area to seamlessly match the surrounding textures, lighting, and details. Ensure no traces of text or logos remain." });
    } else {
      parts.push({ text: "Purify this image: remove all visible text, watermarks, and UI elements. Reconstruct the underlying pixels naturally." });
    }
    if (customInstruction) parts.push({ text: customInstruction });
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts },
    });
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
    }
    throw new Error("Purification result missing in response parts");
  });
};
