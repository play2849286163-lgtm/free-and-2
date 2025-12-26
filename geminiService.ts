
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { Shot, StyleDistillation, Asset } from "./types";

const DIRECTOR_PERSONA = `你是一名获得过奥斯卡提名的顶尖动漫导演。
你现在拥有极致的镜头感：
1. 视觉构图：严苛把控构图美学。分镜必须包含：黄金分割、对角线构图、大远景、特写、低视角等电影语言。
2. 动态捕捉：描述体现角色动作张力、光影明暗。
3. 透视控制：精准运用虚化(Bokeh)、长焦感。
4. 语言系统：输出美感中文分镜，并将细节转化为高质量英文 Prompt。`;

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const errorMsg = (error.toString() || error.message || "").toLowerCase();
      const isQuotaError = 
        errorMsg.includes("429") || 
        errorMsg.includes("quota") || 
        errorMsg.includes("超出配额") ||
        errorMsg.includes("已超出") ||
        errorMsg.includes("limit") ||
        errorMsg.includes("exhausted");

      if (isQuotaError && i < maxRetries - 1) {
        const waitTime = 20000 + (Math.pow(2, i) * 5000); 
        console.warn(`[算力预警] 触发配额限制。导演正在排队，${waitTime/1000}秒后将强制重连生产线...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
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
        parts: [ ...parts, { text: "作为美术监督，请解构这些图。输出包含：线条风格、上色技术、核心配色方案(3-5个HEX代码)、材质感。请用中文总结 summary 字段。" } ]
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
            hexCodes: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["summary", "keywords", "technicalParams", "colorPalette", "hexCodes"]
        }
      }
    });
    return JSON.parse(response.text) as StyleDistillation;
  });
};

export const deductStoryboard = async (script: string, style: StyleDistillation, count: number = 4): Promise<Shot[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `剧本: "${script}"\n视觉基因: "${style.summary}"\n要求：推演 ${count} 个具备电影张力的分镜。严禁僵硬构图。必须在 englishPrompt 中加入摄影术语。`;

  return await withRetry(async () => {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        systemInstruction: DIRECTOR_PERSONA,
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
  sceneAssets: Asset[] = []
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const parts: any[] = [];
  
  // 仅提取已激活的图片
  const getActiveImg = (asset: Asset) => asset.images.find(img => img.isActive)?.url;

  charAssets.forEach(asset => {
    const url = getActiveImg(asset);
    if (url) {
      parts.push({ inlineData: { mimeType: "image/jpeg", data: url.split(',')[1] || url } });
      parts.push({ text: `IDENTITY: "${asset.name}"` });
    }
  });

  sceneAssets.forEach(asset => {
    const url = getActiveImg(asset);
    if (url) {
      parts.push({ inlineData: { mimeType: "image/jpeg", data: url.split(',')[1] || url } });
      parts.push({ text: `LOCATION: "${asset.name}"` });
    }
  });

  const finalPromptText = `Masterpiece Anime Art, (Style: ${style.technicalParams}), (Colors: ${style.hexCodes.join(', ')}), ${prompt}, high quality, cinematic lighting --no text, logo, watermark`;
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

export const removeWatermark = async (imageB64: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  return await withRetry(async () => {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          { inlineData: { data: imageB64.split(',')[1] || imageB64, mimeType: 'image/jpeg' } },
          { text: 'Purify this image: Remove all watermarks and text artifacts.' },
        ],
      },
    });
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
    }
    throw new Error("Purification failed");
  });
};
