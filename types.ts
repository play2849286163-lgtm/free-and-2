
export interface AssetImage {
  url: string;
  isActive: boolean;
}

export interface Asset {
  id: string;
  name: string;
  type: 'character' | 'scene';
  images: AssetImage[]; // 改为对象数组支持个体状态
  isActive: boolean;
}

export interface Shot {
  id: string;
  name: string;
  composition: string;
  flowLogic: string;
  chineseDescription: string;
  englishPrompt: string;
  dialogue: string;
  speaker: string;
  gender: 'male' | 'female' | 'child' | 'narrator';
  emotion: string;
  ambientSfx: string;
  imageUrl?: string;
  videoUrl?: string;
  voiceB64?: string;
  ambientB64?: string;
  isGenerating?: boolean;
  isVideoGenerating?: boolean;
  isAudioLoading?: boolean;
  isAmbientLoading?: boolean;
  groundingLinks?: { title?: string; uri?: string }[];
}

export interface StyleDistillation {
  summary: string;
  keywords: string;
  technicalParams: string;
  colorPalette: string;
  hexCodes: string[];
}

export enum AppStatus {
  IDLE = 'IDLE',
  DISTILLING = 'DISTILLING',
  DEDUCTING = 'DEDUCTING',
  ERROR = 'ERROR'
}
